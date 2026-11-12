package expo.modules.coworkconnect

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import com.google.android.gms.tasks.Task
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class AudioPeerRecord : Record {
  @Field val endpointId: String = ""
  @Field val recvKey: String = ""
}

class AudioStartOptions : Record {
  @Field val sendKey: String = ""
  @Field val peers: List<AudioPeerRecord> = emptyList()
  @Field val mode: String = "walkie"
}

class ServiceOptions : Record {
  @Field val kind: String = "walkie"
  @Field val title: String = ""
  @Field val body: String = ""
}

class IncomingCallOptions : Record {
  @Field val callId: String = ""
  @Field val name: String = ""
}

/**
 * Cowork Connect's Android transport: Google Nearby Connections (Bluetooth, BLE and Wi-Fi, no internet).
 * BYTES payloads carry the Noise session; FILE payloads carry files sealed with a per-file key; STREAM
 * payloads carry sealed audio frames. Keys always come from JavaScript (inside the Noise session), so
 * this layer never sees message content in the clear and never chooses a key.
 */
class CoworkConnectModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }.applicationContext

  private val client: ConnectionsClient
    get() = Nearby.getConnectionsClient(context)

  private val files by lazy { ConnectFiles(context) }
  private val audio by lazy { ConnectAudio(context, { client }, { name, body -> sendEvent(name, body) }) }
  private val worker: ExecutorService = Executors.newFixedThreadPool(2) { r -> Thread(r, "connect-files") }

  private class Outgoing(val endpointId: String, val file: File)
  private class Incoming(val endpointId: String, val payload: Payload)

  private val outgoing = ConcurrentHashMap<Long, Outgoing>()
  private val incoming = ConcurrentHashMap<Long, Incoming>()
  private val lastProgress = ConcurrentHashMap<Long, Long>()

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      if (info.serviceId != SERVICE_ID) return
      sendEvent("onEndpointFound", mapOf("endpointId" to endpointId, "name" to info.endpointName.take(MAX_NAME)))
    }

    override fun onEndpointLost(endpointId: String) {
      sendEvent("onEndpointLost", mapOf("endpointId" to endpointId))
    }
  }

  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      when (payload.type) {
        Payload.Type.BYTES -> {
          val bytes = payload.asBytes() ?: return
          sendEvent("onPayload", mapOf("endpointId" to endpointId, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
        }
        // The file arrives progressively; it is handled when its transfer update says SUCCESS.
        Payload.Type.FILE -> incoming[payload.id] = Incoming(endpointId, payload)
        Payload.Type.STREAM -> audio.onIncomingStream(endpointId, payload)
        else -> Unit
      }
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      onTransferUpdate(endpointId, update)
    }
  }

  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      // Nothing is accepted automatically: JS asks the person, then calls accept or reject.
      sendEvent(
        "onConnectionInitiated",
        mapOf(
          "endpointId" to endpointId,
          "name" to info.endpointName.take(MAX_NAME),
          "incoming" to info.isIncomingConnection,
          "authDigits" to info.authenticationDigits,
        ),
      )
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      val code = result.status.statusCode
      sendEvent(
        "onConnectionResult",
        mapOf("endpointId" to endpointId, "ok" to (code == ConnectionsStatusCodes.STATUS_OK), "status" to ConnectionsStatusCodes.getStatusCodeString(code)),
      )
    }

    override fun onDisconnected(endpointId: String) {
      dropEndpoint(endpointId)
      sendEvent("onDisconnected", mapOf("endpointId" to endpointId))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CoworkConnect")

    Events(
      "onEndpointFound", "onEndpointLost", "onConnectionInitiated", "onConnectionResult", "onDisconnected", "onPayload",
      "onTransferUpdate", "onFileReceived", "onAudioLevel", "onAudioState", "onCallAction",
    )

    OnCreate {
      CallActionBus.listener = { callId, action -> sendEvent("onCallAction", mapOf("callId" to callId, "action" to action)) }
      worker.execute { runCatching { files.cleanOutgoing() } }
    }

    OnNewIntent { intent -> handleCallIntent(intent) }
    OnActivityEntersForeground { handleCallIntent(appContext.currentActivity?.intent) }

    OnDestroy {
      CallActionBus.listener = null
      runCatching { audio.stop() }
      val ctx = appContext.reactContext?.applicationContext
      if (ctx != null) {
        runCatching { ctx.stopService(Intent(ctx, ConnectService::class.java)) }
        val nearby = runCatching { Nearby.getConnectionsClient(ctx) }.getOrNull()
        for ((id, out) in outgoing) {
          nearby?.cancelPayload(id)
          out.file.delete()
        }
        for ((id, inc) in incoming) {
          nearby?.cancelPayload(id)
          runCatching { discardIncoming(inc) }
        }
      }
      outgoing.clear()
      incoming.clear()
      worker.shutdown()
    }

    // region Nearby (C1)

    AsyncFunction("startAdvertising") { name: String, promise: Promise ->
      val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
      client.startAdvertising(cleanName(name), SERVICE_ID, lifecycle, options).settle(promise, ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING)
    }

    AsyncFunction("startDiscovery") { promise: Promise ->
      val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
      client.startDiscovery(SERVICE_ID, discovery, options).settle(promise, ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING)
    }

    Function("stopAdvertising") { client.stopAdvertising() }
    Function("stopDiscovery") { client.stopDiscovery() }

    /** Stops advertising and discovery and drops every connection. */
    Function("stopAll") {
      client.stopAdvertising()
      client.stopDiscovery()
      client.stopAllEndpoints()
      // Nearby does not report onDisconnected for connections this phone ends itself.
      val endpoints = outgoing.values.map { it.endpointId } + incoming.values.map { it.endpointId }
      for (endpointId in endpoints.toSet()) dropEndpoint(endpointId)
    }

    AsyncFunction("requestConnection") { name: String, endpointId: String, promise: Promise ->
      client.requestConnection(cleanName(name), endpointId, lifecycle).settle(promise, ConnectionsStatusCodes.STATUS_ALREADY_CONNECTED_TO_ENDPOINT)
    }

    AsyncFunction("acceptConnection") { endpointId: String, promise: Promise ->
      client.acceptConnection(endpointId, payloads).settle(promise, ConnectionsStatusCodes.STATUS_ALREADY_CONNECTED_TO_ENDPOINT)
    }

    AsyncFunction("rejectConnection") { endpointId: String, promise: Promise ->
      client.rejectConnection(endpointId).settle(promise, null)
    }

    AsyncFunction("sendBytes") { endpointId: String, base64: String, promise: Promise ->
      val bytes = try {
        Base64.decode(base64, Base64.NO_WRAP)
      } catch (e: IllegalArgumentException) {
        promise.reject(CodedException("ERR_CONNECT_PAYLOAD", "Payload is not valid base64", e))
        return@AsyncFunction
      }
      if (bytes.size > MAX_BYTES) {
        promise.reject(CodedException("ERR_CONNECT_PAYLOAD", "Payload is larger than ${MAX_BYTES} bytes", null))
        return@AsyncFunction
      }
      client.sendPayload(endpointId, Payload.fromBytes(bytes)).settle(promise, null)
    }

    Function("disconnect") { endpointId: String ->
      client.disconnectFromEndpoint(endpointId)
      // Nearby does not report onDisconnected for this side.
      dropEndpoint(endpointId)
    }

    // endregion

    // region Files (C2)

    AsyncFunction("sha256File") { uri: String, promise: Promise ->
      worker.execute {
        try {
          promise.resolve(files.sha256(uri))
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_CONNECT_FILE", "Could not read the file", e))
        }
      }
    }

    AsyncFunction("sendFile") { endpointId: String, uri: String, keyB64: String, promise: Promise ->
      val key = decodeKeyOrReject(keyB64, promise) ?: return@AsyncFunction
      worker.execute { sendFileNow(endpointId, uri, key, promise) }
    }

    Function("cancelPayload") { payloadId: String ->
      val id = payloadId.toLongOrNull() ?: return@Function
      client.cancelPayload(id)
      lastProgress.remove(id)
      outgoing.remove(id)?.let {
        it.file.delete()
        emitTransfer(it.endpointId, id, false, 0, 0, PayloadTransferUpdate.Status.CANCELED)
      }
      incoming.remove(id)?.let {
        discardIncoming(it)
        emitTransfer(it.endpointId, id, true, 0, 0, PayloadTransferUpdate.Status.CANCELED)
      }
    }

    AsyncFunction("decryptFile") { path: String, keyB64: String, fileName: String, promise: Promise ->
      val key = decodeKeyOrReject(keyB64, promise) ?: return@AsyncFunction
      worker.execute {
        try {
          val result = files.decrypt(path, key, fileName)
          promise.resolve(
            mapOf(
              "uri" to Uri.fromFile(result.file).toString(),
              "size" to result.size.toDouble(),
              "sha256" to result.sha256,
            ),
          )
        } catch (e: ConnectFiles.DecryptError) {
          promise.reject(CodedException("ERR_CONNECT_DECRYPT", e.message ?: "File failed the integrity check", null))
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_CONNECT_FILE", "Could not save the file", e))
        } finally {
          key.fill(0)
        }
      }
    }

    Function("deleteFile") { uri: String ->
      try {
        files.delete(uri)
      } catch (e: SecurityException) {
        throw CodedException("ERR_CONNECT_FILE", "Only Connect files can be deleted", null)
      }
    }

    // endregion

    // region Audio (C3, C4)

    AsyncFunction("audioStart") { options: AudioStartOptions ->
      val sendKey = decodeKey(options.sendKey)
      val peers = options.peers.map { it.endpointId to decodeKey(it.recvKey) }
      try {
        audio.start(sendKey, peers, options.mode)
      } catch (e: Exception) {
        throw CodedException("ERR_CONNECT_AUDIO", "Audio could not start", e)
      } finally {
        sendKey.fill(0)
        peers.forEach { it.second.fill(0) }
      }
    }

    // Sync or async to match the iOS module, so one JS wrapper fits both platforms.

    /** Ignored when audio is not active (same as iOS). */
    Function("audioAddPeer") { endpointId: String, recvKey: String ->
      val key = decodeKey(recvKey)
      try {
        audio.addPeer(endpointId, key)
      } finally {
        key.fill(0)
      }
    }

    Function("audioRemovePeer") { endpointId: String -> audio.removePeer(endpointId) }

    /** Resolves true, or false when microphone permission is off (an onAudioState error follows). */
    AsyncFunction("audioTransmit") { on: Boolean ->
      try {
        audio.transmit(on)
      } catch (e: IllegalStateException) {
        throw CodedException("ERR_CONNECT_AUDIO", "Audio is not active", null)
      }
    }

    Function("audioSetMuted") { muted: Boolean -> audio.setMuted(muted) }
    Function("audioSetSpeaker") { on: Boolean -> audio.setSpeaker(on) }
    Function("audioStop") { audio.stop() }

    // endregion

    // region Foreground service and incoming calls (C3, C4)

    AsyncFunction("startService") { options: ServiceOptions ->
      val intent = Intent(context, ConnectService::class.java)
        .putExtra(ConnectService.EXTRA_KIND, options.kind)
        .putExtra(ConnectService.EXTRA_TITLE, options.title)
        .putExtra(ConnectService.EXTRA_BODY, options.body)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException (Android 12+): the app is in the background.
        throw CodedException("ERR_CONNECT_SERVICE", "Connect can only start this while the app is open", e)
      } catch (e: SecurityException) {
        throw CodedException("ERR_CONNECT_SERVICE", "Connect is not allowed to run in the background", e)
      }
    }

    Function("stopService") {
      context.stopService(Intent(context, ConnectService::class.java))
    }

    /** Resolves false when the notification could not be shown (notifications off), so JS shows the call in the app. */
    AsyncFunction("showIncomingCall") { options: IncomingCallOptions ->
      if (options.callId.isEmpty()) {
        false
      } else {
        ConnectNotifications.showIncomingCall(context, options.callId, options.name)
      }
    }

    Function("clearIncomingCall") { callId: String ->
      ConnectNotifications.clearIncomingCall(context, callId)
    }

    // endregion
  }

  // region Transfers

  private fun sendFileNow(endpointId: String, uri: String, key: ByteArray, promise: Promise) {
    val encrypted = try {
      files.encryptToTemp(uri, key)
    } catch (e: Exception) {
      promise.reject(CodedException("ERR_CONNECT_FILE", "Could not read the file", e))
      return
    } finally {
      key.fill(0)
    }
    val payload = try {
      Payload.fromFile(encrypted)
    } catch (e: Exception) {
      encrypted.delete()
      promise.reject(CodedException("ERR_CONNECT_FILE", "Could not prepare the file", e))
      return
    }
    val id = payload.id
    outgoing[id] = Outgoing(endpointId, encrypted)
    client.sendPayload(endpointId, payload)
      .addOnSuccessListener { promise.resolve(id.toString()) }
      .addOnFailureListener { e ->
        outgoing.remove(id)
        runCatching { payload.close() }
        encrypted.delete()
        promise.reject(nearbyError(e))
      }
  }

  private fun onTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
    val id = update.payloadId
    val status = update.status
    val terminal = status != PayloadTransferUpdate.Status.IN_PROGRESS

    val out = outgoing[id]
    if (out != null) {
      if (terminal) {
        outgoing.remove(id)
        lastProgress.remove(id)
        out.file.delete()
        emitTransfer(endpointId, id, false, update.bytesTransferred, update.totalBytes, status)
      } else if (shouldEmitProgress(id)) {
        emitTransfer(endpointId, id, false, update.bytesTransferred, update.totalBytes, status)
      }
      return
    }

    val inc = incoming[id]
    if (inc != null) {
      when (status) {
        PayloadTransferUpdate.Status.IN_PROGRESS -> {
          if (shouldEmitProgress(id)) emitTransfer(endpointId, id, true, update.bytesTransferred, update.totalBytes, status)
        }
        PayloadTransferUpdate.Status.SUCCESS -> {
          incoming.remove(id)
          lastProgress.remove(id)
          val total = update.totalBytes
          worker.execute {
            try {
              val stored = storeIncoming(id, inc.payload)
              emitTransfer(endpointId, id, true, total, total, PayloadTransferUpdate.Status.SUCCESS)
              sendEvent("onFileReceived", mapOf("endpointId" to endpointId, "payloadId" to id.toString(), "path" to stored.absolutePath))
            } catch (e: Exception) {
              Log.w(TAG, "A received file could not be stored")
              runCatching { discardIncoming(inc) }
              emitTransfer(endpointId, id, true, 0, total, PayloadTransferUpdate.Status.FAILURE)
            }
          }
        }
        else -> {
          incoming.remove(id)
          lastProgress.remove(id)
          discardIncoming(inc)
          emitTransfer(endpointId, id, true, update.bytesTransferred, update.totalBytes, status)
        }
      }
      return
    }

    // Audio streams report constant progress; only their end matters. BYTES updates are not surfaced.
    if (terminal && audio.isStreamPayload(id)) audio.onStreamFinished(id)
  }

  /** Moves a completed Nearby FILE payload to cache/connect/incoming/<payloadId>.enc. */
  private fun storeIncoming(id: Long, payload: Payload): File {
    val file = payload.asFile() ?: throw IllegalStateException("Not a file payload")
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Android 10+: Nearby hands over a content uri; copy it, then delete Nearby's copy.
        val uri = file.asUri()
        if (uri != null) {
          val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Cannot open the received file")
          val stored = files.storeIncoming(id, input)
          runCatching { context.contentResolver.delete(uri, null, null) }
          return stored
        }
      } else {
        @Suppress("DEPRECATION")
        val javaFile = file.asJavaFile()
        if (javaFile != null && javaFile.exists()) return files.moveIncoming(id, javaFile)
      }
      val pfd = file.asParcelFileDescriptor() ?: throw IllegalStateException("The received file is not readable")
      return files.storeIncoming(id, ParcelFileDescriptor.AutoCloseInputStream(pfd))
    } finally {
      runCatching { payload.close() }
    }
  }

  /** Best effort removal of a partial or failed incoming file held by Nearby. */
  private fun discardIncoming(inc: Incoming) {
    val file = inc.payload.asFile() ?: return
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        file.asUri()?.let { context.contentResolver.delete(it, null, null) }
      } else {
        @Suppress("DEPRECATION")
        file.asJavaFile()?.delete()
      }
    }
    runCatching { inc.payload.close() }
  }

  /** Fails transfers and drops audio streams for an endpoint that is gone. */
  private fun dropEndpoint(endpointId: String) {
    for ((id, out) in outgoing) {
      if (out.endpointId != endpointId || outgoing.remove(id) == null) continue
      lastProgress.remove(id)
      out.file.delete()
      emitTransfer(endpointId, id, false, 0, 0, PayloadTransferUpdate.Status.FAILURE)
    }
    for ((id, inc) in incoming) {
      if (inc.endpointId != endpointId || incoming.remove(id) == null) continue
      lastProgress.remove(id)
      discardIncoming(inc)
      emitTransfer(endpointId, id, true, 0, 0, PayloadTransferUpdate.Status.FAILURE)
    }
    runCatching { audio.onEndpointGone(endpointId) }
  }

  private fun shouldEmitProgress(id: Long): Boolean {
    val now = SystemClock.elapsedRealtime()
    val last = lastProgress[id]
    if (last != null && now - last < PROGRESS_MS) return false
    lastProgress[id] = now
    return true
  }

  private fun emitTransfer(endpointId: String, id: Long, isIncoming: Boolean, transferred: Long, total: Long, status: Int) {
    val name = when (status) {
      PayloadTransferUpdate.Status.SUCCESS -> "success"
      PayloadTransferUpdate.Status.FAILURE -> "failure"
      PayloadTransferUpdate.Status.CANCELED -> "canceled"
      else -> "in_progress"
    }
    sendEvent(
      "onTransferUpdate",
      mapOf(
        "endpointId" to endpointId,
        "payloadId" to id.toString(),
        "incoming" to isIncoming,
        "bytesTransferred" to transferred.toDouble(),
        "totalBytes" to total.toDouble(),
        "status" to name,
      ),
    )
  }

  // endregion

  private fun handleCallIntent(intent: Intent?) {
    val (callId, action) = ConnectNotifications.takeCallAction(intent) ?: return
    ConnectNotifications.clearIncomingCall(context, callId)
    sendEvent("onCallAction", mapOf("callId" to callId, "action" to action))
  }

  private fun decodeKey(b64: String): ByteArray = try {
    CounterAead.decodeKey(b64)
  } catch (e: IllegalArgumentException) {
    throw CodedException("ERR_CONNECT_KEY", "Key must be 32 bytes of base64", null)
  }

  private fun decodeKeyOrReject(b64: String, promise: Promise): ByteArray? = try {
    CounterAead.decodeKey(b64)
  } catch (e: IllegalArgumentException) {
    promise.reject(CodedException("ERR_CONNECT_KEY", "Key must be 32 bytes of base64", null))
    null
  }

  private fun nearbyError(e: Exception): CodedException {
    val code = (e as? ApiException)?.statusCode
    val name = code?.let { ConnectionsStatusCodes.getStatusCodeString(it) } ?: "UNKNOWN"
    return CodedException("ERR_CONNECT_$name", e.message ?: name, e)
  }

  /** Resolves on success (or on an "already" status, which means the wanted state holds), else rejects with a readable code. */
  private fun Task<Void>.settle(promise: Promise, alreadyOk: Int?) {
    addOnSuccessListener { promise.resolve(null) }
    addOnFailureListener { e ->
      val code = (e as? ApiException)?.statusCode
      if (code != null && code == alreadyOk) {
        promise.resolve(null)
      } else {
        promise.reject(nearbyError(e))
      }
    }
  }

  private fun cleanName(name: String) = name.trim().take(MAX_NAME).ifEmpty { "Cowork" }

  private companion object {
    const val TAG = "CoworkConnect"
    const val SERVICE_ID = "me.antropic.cowork.connect"
    // M-to-N topology: everyone can connect to everyone nearby (groups come later).
    val STRATEGY: Strategy = Strategy.P2P_CLUSTER
    // Nearby limits byte payloads to 32 KB.
    const val MAX_BYTES = 32 * 1024
    const val MAX_NAME = 40
    const val PROGRESS_MS = 150L
  }
}
