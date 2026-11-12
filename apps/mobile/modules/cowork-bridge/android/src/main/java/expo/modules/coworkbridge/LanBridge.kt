package expo.modules.coworkbridge

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.kotlin.Promise
import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

internal typealias Emit = (String, Map<String, Any?>) -> Unit

/**
 * Hotspot and LAN transport. The host side starts a LocalOnlyHotspot (so a phone with no shared Wi-Fi,
 * typically an iPhone, can join from a QR code), runs a TCP server and advertises it over NSD as
 * `_coworkconnect._tcp`. Any side can browse the current network for others.
 *
 * Links: outgoing ones use the found id `lan:<service name>` (or `lan:addr:<host>:<port>`); incoming
 * ones are `lan:in:<n>`. Each side sends HELLO first; nothing is delivered to JS until both sides
 * have sent ACCEPT (see protocol.ts). Bytes are opaque and never logged.
 */
internal class LanBridge(private val context: Context, private val emit: Emit) {
  private val main = Handler(Looper.getMainLooper())
  private val io: ExecutorService = Executors.newCachedThreadPool()
  private val nsd: NsdManager? get() = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
  private val instanceId = "cw-" + randomHex(5)
  private val inCounter = AtomicInteger(0)

  @Volatile private var myName = "Cowork user"
  private val links = ConcurrentHashMap<String, LanLink>()
  private val found = ConcurrentHashMap<String, Endpoint>()

  // Guarded by `this`.
  private var server: ServerSocket? = null
  private var registration: NsdManager.RegistrationListener? = null
  private var registeredAs: String? = null
  private var registeredName: String? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
  private var hostCallback: Any? = null
  private var hosting = false
  private var browsing = false

  // Resolves run one at a time: older Android versions fail a second concurrent resolve.
  private val resolveQueue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false

  private data class Endpoint(val host: InetAddress, val port: Int, val name: String)

  // ---------- Hotspot ----------

  fun hostStart(name: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.reject("ERR_BRIDGE_UNSUPPORTED", "Hosting a hotspot needs Android 8 or later", null)
      return
    }
    myName = Wire.cleanName(name)
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    if (wifi == null) {
      promise.reject("ERR_BRIDGE_WIFI", "WIFI_UNAVAILABLE", null)
      return
    }
    synchronized(this) {
      val existing = reservation
      if (existing != null) {
        settleHotspot(existing, promise)
        return
      }
    }
    val settled = AtomicBoolean(false)
    val callback = object : WifiManager.LocalOnlyHotspotCallback() {
      override fun onStarted(r: WifiManager.LocalOnlyHotspotReservation) {
        synchronized(this@LanBridge) { reservation = r }
        if (settled.compareAndSet(false, true)) settleHotspot(r, promise) else r.close()
      }

      override fun onStopped() {
        val wasHosting = synchronized(this@LanBridge) {
          reservation = null
          hostCallback = null
          hosting.also { hosting = false }
        }
        if (wasHosting) {
          stopServerIfIdle()
          emit("onLanHostStopped", mapOf("reason" to "STOPPED"))
        }
      }

      override fun onFailed(reason: Int) {
        synchronized(this@LanBridge) { hostCallback = null }
        if (!settled.compareAndSet(false, true)) return
        val status = when (reason) {
          WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL -> "WIFI_NO_CHANNEL"
          WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE -> "WIFI_INCOMPATIBLE_MODE"
          WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED -> "WIFI_TETHERING_DISALLOWED"
          else -> "WIFI_HOTSPOT_FAILED"
        }
        promise.reject("ERR_BRIDGE_HOTSPOT", status, null)
      }
    }
    try {
      synchronized(this) { hostCallback = callback }
      wifi.startLocalOnlyHotspot(callback, main)
    } catch (e: SecurityException) {
      synchronized(this) { hostCallback = null }
      // Fine location (API 26-32) or NEARBY_WIFI_DEVICES (API 33+) is missing, or location is off.
      if (settled.compareAndSet(false, true)) promise.reject("ERR_BRIDGE_PERMISSION", "MISSING_PERMISSION", e)
    } catch (e: IllegalStateException) {
      synchronized(this) { hostCallback = null }
      // "Caller already has an active LocalOnlyHotspot request", or Wi-Fi is in an incompatible state.
      if (settled.compareAndSet(false, true)) promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_HOTSPOT_BUSY", e)
    }
  }

  private fun settleHotspot(r: WifiManager.LocalOnlyHotspotReservation, promise: Promise) {
    val (ssid, passphrase) = credentials(r)
    if (ssid.isNullOrEmpty() || passphrase.isNullOrEmpty()) {
      // An open hotspot (no passphrase) is never offered: close it and fail.
      synchronized(this) { reservation = null }
      r.close()
      promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_HOTSPOT_NO_CREDENTIALS", null)
      return
    }
    try {
      val port = ensureServer()
      synchronized(this) { hosting = true }
      register(port)
      promise.resolve(mapOf("ssid" to ssid, "passphrase" to passphrase, "port" to port, "host" to hotspotAddress()))
    } catch (e: IOException) {
      hostStop()
      promise.reject("ERR_BRIDGE_SERVER", "Could not open the local server", e)
    }
  }

  @Suppress("DEPRECATION")
  private fun credentials(r: WifiManager.LocalOnlyHotspotReservation): Pair<String?, String?> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val c = r.softApConfiguration
      val ssid = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) c.wifiSsid?.toString() else c.ssid
      return ssid?.removeSurrounding("\"") to c.passphrase
    }
    val c = r.wifiConfiguration ?: return null to null
    return c.SSID?.removeSurrounding("\"") to c.preSharedKey?.removeSurrounding("\"")
  }

  fun hostStop() {
    val r = synchronized(this) {
      hosting = false
      hostCallback = null
      reservation.also { reservation = null }
    }
    try {
      r?.close()
    } catch (_: Exception) {
    }
    stopServerIfIdle()
  }

  /** Best-effort IPv4 address of the soft AP interface (names differ by vendor). */
  private fun hotspotAddress(): String? = try {
    val ifaces = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().filter { it.isUp && !it.isLoopback }
    val preferred = listOf("swlan", "softap", "ap", "wlan1", "wigig")
    val ordered = ifaces.sortedBy { i -> preferred.indexOfFirst { i.name.startsWith(it) }.let { if (it < 0) Int.MAX_VALUE else it } }
    ordered.firstNotNullOfOrNull { i ->
      if (preferred.none { i.name.startsWith(it) }) null
      else i.inetAddresses.toList().firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress
    }
  } catch (_: Exception) {
    null
  }

  // ---------- Browse (and be found) on the current network ----------

  fun browseStart(name: String, promise: Promise) {
    myName = Wire.cleanName(name)
    val manager = nsd
    if (manager == null) {
      promise.reject("ERR_BRIDGE_WIFI", "WIFI_UNAVAILABLE", null)
      return
    }
    try {
      val port = ensureServer()
      synchronized(this) { browsing = true }
      register(port)
      synchronized(this) {
        if (discovery == null) {
          val listener = discoveryListener()
          discovery = listener
          manager.discoverServices(Wire.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        }
      }
      promise.resolve(null)
    } catch (e: IOException) {
      browseStop()
      promise.reject("ERR_BRIDGE_SERVER", "Could not open the local server", e)
    } catch (e: SecurityException) {
      browseStop()
      promise.reject("ERR_BRIDGE_PERMISSION", "MISSING_PERMISSION", e)
    } catch (e: IllegalArgumentException) {
      browseStop()
      promise.reject("ERR_BRIDGE_NSD", "Network service discovery failed", e)
    }
  }

  fun browseStop() {
    val listener = synchronized(this) {
      browsing = false
      resolveQueue.clear()
      discovery.also { discovery = null }
    }
    if (listener != null) {
      try {
        nsd?.stopServiceDiscovery(listener)
      } catch (_: IllegalArgumentException) {
      }
    }
    found.clear()
    stopServerIfIdle()
  }

  /**
   * App in the background: stop finding others and being found, but keep the server and every link
   * (and a hosted hotspot) so connected people stay connected. browseStart resumes.
   */
  fun browsePause() {
    val (listener, reg) = synchronized(this) {
      resolveQueue.clear()
      val l = discovery
      val r = registration
      discovery = null
      registration = null
      registeredAs = null
      registeredName = null
      l to r
    }
    if (listener != null) {
      try {
        nsd?.stopServiceDiscovery(listener)
      } catch (_: IllegalArgumentException) {
      }
    }
    if (reg != null) {
      try {
        nsd?.unregisterService(reg)
      } catch (_: IllegalArgumentException) {
      }
    }
    found.clear()
  }

  private fun discoveryListener() = object : NsdManager.DiscoveryListener {
    override fun onDiscoveryStarted(serviceType: String) = Unit
    override fun onDiscoveryStopped(serviceType: String) = Unit

    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
      synchronized(this@LanBridge) { if (discovery === this) discovery = null }
    }

    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

    override fun onServiceFound(info: NsdServiceInfo) {
      if (isSelf(info.serviceName)) return
      synchronized(this@LanBridge) {
        if (discovery !== this) return
        if (resolveQueue.none { it.serviceName == info.serviceName }) resolveQueue.addLast(info)
      }
      resolveNext()
    }

    override fun onServiceLost(info: NsdServiceInfo) {
      val id = linkIdFor(info.serviceName)
      if (found.remove(id) != null) emit("onLanLost", mapOf("linkId" to id))
    }
  }

  private fun isSelf(serviceName: String?) = serviceName == instanceId || serviceName == registeredAs

  private fun linkIdFor(serviceName: String) = "lan:" + serviceName.take(63)

  @Suppress("DEPRECATION")
  private fun resolveNext() {
    val manager = nsd ?: return
    val next = synchronized(this) {
      if (resolving || discovery == null) return
      resolveQueue.removeFirstOrNull()?.also { resolving = true }
    } ?: return
    try {
      manager.resolveService(next, object : NsdManager.ResolveListener {
        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
          synchronized(this@LanBridge) {
            resolving = false
            if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE && discovery != null) resolveQueue.addLast(next)
          }
          if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE) main.postDelayed({ resolveNext() }, 300) else resolveNext()
        }

        override fun onServiceResolved(info: NsdServiceInfo) {
          synchronized(this@LanBridge) { resolving = false }
          val host = info.host
          if (host != null && info.port in 1..65535 && !isSelf(info.serviceName)) {
            val raw = info.attributes["n"]?.let { String(it, Charsets.UTF_8) } ?: "Cowork user"
            val name = Wire.cleanName(raw)
            val id = linkIdFor(info.serviceName)
            found[id] = Endpoint(host, info.port, name)
            emit("onLanFound", mapOf("linkId" to id, "name" to name))
          }
          resolveNext()
        }
      })
    } catch (e: IllegalArgumentException) {
      synchronized(this) { resolving = false }
      resolveNext()
    }
  }

  private fun register(port: Int) {
    val manager = nsd ?: return
    val oldListener: NsdManager.RegistrationListener?
    synchronized(this) {
      if (registration != null && registeredName == myName) return
      oldListener = registration
      registration = null
      registeredAs = null
    }
    if (oldListener != null) {
      try {
        manager.unregisterService(oldListener)
      } catch (_: IllegalArgumentException) {
      }
    }
    val info = NsdServiceInfo().apply {
      serviceName = instanceId
      serviceType = Wire.SERVICE_TYPE
      this.port = port
      // The display name is the only personal thing advertised. TXT values are capped at 255 bytes.
      setAttribute("n", String(Wire.truncateUtf8(myName, 160), Charsets.UTF_8))
      setAttribute("v", "1")
    }
    val listener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(info: NsdServiceInfo) {
        synchronized(this@LanBridge) { if (registration === this) registeredAs = info.serviceName }
      }

      override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
        synchronized(this@LanBridge) { if (registration === this) registration = null }
      }

      override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
      override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) = Unit
    }
    synchronized(this) {
      registration = listener
      registeredName = myName
    }
    manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
  }

  // ---------- TCP server ----------

  @Throws(IOException::class)
  private fun ensureServer(): Int {
    synchronized(this) {
      server?.takeIf { !it.isClosed }?.let { return it.localPort }
      val s = ServerSocket()
      s.reuseAddress = true
      s.bind(InetSocketAddress(0), 16)
      server = s
      io.execute { acceptLoop(s) }
      return s.localPort
    }
  }

  private fun acceptLoop(s: ServerSocket) {
    while (!s.isClosed) {
      val socket = try {
        s.accept()
      } catch (_: IOException) {
        break
      }
      val pending = links.values.count { it.incoming && !it.connected }
      if (pending >= MAX_PENDING_INCOMING) {
        closeQuietly(socket)
        continue
      }
      val link = LanLink("lan:in:" + inCounter.incrementAndGet(), incoming = true)
      links[link.id] = link
      link.socket = socket
      try {
        io.execute { link.run() }
      } catch (_: RejectedExecutionException) {
        link.close(notify = false, failure = null)
      }
    }
  }

  /** Closes the server, registration and every link once neither hosting nor browsing needs them. */
  private fun stopServerIfIdle() {
    val (s, reg) = synchronized(this) {
      if (hosting || browsing) return
      val s = server
      val reg = registration
      server = null
      registration = null
      registeredAs = null
      registeredName = null
      s to reg
    }
    if (reg != null) {
      try {
        nsd?.unregisterService(reg)
      } catch (_: IllegalArgumentException) {
      }
    }
    try {
      s?.close()
    } catch (_: IOException) {
    }
    links.values.toList().forEach { it.close(notify = false, failure = null) }
  }

  // ---------- Links ----------

  fun connect(linkId: String, promise: Promise) {
    val ep = found[linkId]
    if (ep == null) {
      promise.reject("ERR_BRIDGE_LINK", "NOT_FOUND", null)
      return
    }
    open(linkId, InetSocketAddress(ep.host, ep.port), promise, resolveWith = null)
  }

  fun connectAddress(host: String, port: Int, promise: Promise) {
    if (port !in 1..65535 || host.isBlank() || host.length > 253) {
      promise.reject("ERR_BRIDGE_LINK", "Bad address", null)
      return
    }
    val id = "lan:addr:$host:$port"
    io.execute {
      val address = try {
        InetSocketAddress(InetAddress.getByName(host), port)
      } catch (e: IOException) {
        promise.reject("ERR_BRIDGE_LINK", "NOT_FOUND", e)
        return@execute
      }
      open(id, address, promise, resolveWith = id)
    }
  }

  private fun open(id: String, address: InetSocketAddress, promise: Promise, resolveWith: String?) {
    val existing = links[id]
    if (existing != null && !existing.closed) {
      promise.resolve(resolveWith)
      return
    }
    val link = LanLink(id, incoming = false)
    links[id] = link
    try {
      io.execute {
        val socket = Socket()
        try {
          socket.connect(address, CONNECT_TIMEOUT_MS)
        } catch (e: IOException) {
          closeQuietly(socket)
          links.remove(id, link)
          promise.reject("ERR_BRIDGE_LINK", if (e is SocketTimeoutException) "TIMEOUT" else "NOT_CONNECTED", e)
          return@execute
        }
        if (link.closed) {
          closeQuietly(socket)
          promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null)
          return@execute
        }
        link.socket = socket
        promise.resolve(resolveWith)
        link.run()
      }
    } catch (e: RejectedExecutionException) {
      links.remove(id, link)
      promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", e)
    }
  }

  fun accept(linkId: String, promise: Promise) {
    val link = links[linkId]
    if (link == null || link.closed) {
      promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null)
      return
    }
    link.acceptLocal(promise)
  }

  fun reject(linkId: String, promise: Promise) {
    val link = links[linkId]
    if (link == null || link.closed) {
      promise.resolve(null)
      return
    }
    link.rejectLocal(promise)
  }

  fun send(linkId: String, base64: String, promise: Promise) {
    val link = links[linkId]
    if (link == null || !link.connected || link.closed) {
      promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null)
      return
    }
    val bytes = try {
      Base64.decode(base64, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload is not valid base64", e)
      return
    }
    if (bytes.isEmpty() || bytes.size > Wire.MAX_LAN_DATA) {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload must be 1 to ${Wire.MAX_LAN_DATA} bytes", null)
      return
    }
    link.write(Wire.body(Wire.DATA, bytes), promise)
  }

  fun disconnect(linkId: String) {
    links[linkId]?.close(notify = false, failure = null)
  }

  fun destroy() {
    hostStop()
    browseStop()
    synchronized(this) {
      hosting = false
      browsing = false
    }
    stopServerIfIdle()
    io.shutdownNow()
  }

  private inner class LanLink(val id: String, val incoming: Boolean) {
    @Volatile var socket: Socket? = null
    @Volatile var closed = false
    @Volatile var connected = false
    @Volatile private var peerName: String? = null
    @Volatile private var localAccepted = false
    @Volatile private var remoteAccepted = false
    private val stateLock = Any()
    // One writer thread per link keeps frames in order (the Noise counter depends on it).
    private val writer: ExecutorService = Executors.newSingleThreadExecutor()
    private val timeout = Runnable {
      // Socket work stays off the main thread.
      try {
        io.execute { close(notify = true, failure = "TIMEOUT") }
      } catch (_: RejectedExecutionException) {
        close(notify = false, failure = null)
      }
    }

    /** Reads until the socket closes. Runs on an io thread. */
    fun run() {
      val s = socket ?: return
      main.postDelayed(timeout, DECIDE_TIMEOUT_MS)
      try {
        s.tcpNoDelay = true
        s.soTimeout = HELLO_TIMEOUT_MS
        write(Wire.hello(myName), null)
        val input = DataInputStream(s.getInputStream().buffered())
        while (!closed) {
          val len = input.readInt()
          if (len < 1 || len > Wire.MAX_LAN_BODY) throw ProtocolException("Bad frame length")
          val body = ByteArray(len)
          input.readFully(body)
          handle(body)
        }
      } catch (e: ProtocolException) {
        close(notify = true, failure = "PROTOCOL_ERROR")
      } catch (e: SocketTimeoutException) {
        close(notify = true, failure = "TIMEOUT")
      } catch (e: EOFException) {
        close(notify = true, failure = "CONNECTION_LOST")
      } catch (e: IOException) {
        close(notify = true, failure = "CONNECTION_LOST")
      }
    }

    private fun handle(body: ByteArray) {
      when (Wire.kindOf(body)) {
        Wire.HELLO -> {
          if (peerName != null) throw ProtocolException("Second hello")
          val name = Wire.nameFromHello(body)
          peerName = name
          socket?.soTimeout = 0
          emit("onLanRequest", mapOf("linkId" to id, "name" to name, "incoming" to incoming))
        }
        Wire.ACCEPT -> {
          if (peerName == null || remoteAccepted) throw ProtocolException("Unexpected accept")
          remoteAccepted = true
          maybeConnected()
        }
        Wire.REJECT -> close(notify = true, failure = "REJECTED")
        Wire.DATA -> {
          // Nothing is delivered before both sides accepted.
          if (!connected) throw ProtocolException("Data before accept")
          emit("onLanPayload", mapOf("linkId" to id, "data" to Base64.encodeToString(body, 1, body.size - 1, Base64.NO_WRAP)))
        }
      }
    }

    private fun maybeConnected() {
      val now = synchronized(stateLock) {
        if (localAccepted && remoteAccepted && !connected && !closed) {
          connected = true
          true
        } else {
          false
        }
      }
      if (now) {
        main.removeCallbacks(timeout)
        emit("onLanConnected", mapOf("linkId" to id, "ok" to true, "status" to "OK"))
      }
    }

    fun acceptLocal(promise: Promise) {
      if (peerName == null) {
        promise.reject("ERR_BRIDGE_LINK", "Nothing to accept yet", null)
        return
      }
      if (localAccepted) {
        promise.resolve(null)
        return
      }
      localAccepted = true
      write(Wire.body(Wire.ACCEPT), promise)
      maybeConnected()
    }

    fun rejectLocal(promise: Promise) {
      try {
        writer.execute {
          try {
            socket?.getOutputStream()?.let { out ->
              out.write(Wire.lanFrame(Wire.body(Wire.REJECT)))
              out.flush()
            }
          } catch (_: IOException) {
          }
          close(notify = false, failure = null)
          promise.resolve(null)
        }
      } catch (_: RejectedExecutionException) {
        close(notify = false, failure = null)
        promise.resolve(null)
      }
    }

    fun write(body: ByteArray, promise: Promise?) {
      val frame = Wire.lanFrame(body)
      try {
        writer.execute {
          val out: OutputStream? = socket?.getOutputStream()
          if (closed || out == null) {
            promise?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null)
            return@execute
          }
          try {
            out.write(frame)
            out.flush()
            promise?.resolve(null)
          } catch (e: IOException) {
            promise?.reject("ERR_BRIDGE_LINK", "ENDPOINT_IO_ERROR", e)
            close(notify = true, failure = "CONNECTION_LOST")
          }
        }
      } catch (_: RejectedExecutionException) {
        promise?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null)
      }
    }

    /**
     * Idempotent. `notify` emits onLanDisconnected (if connected) or onLanConnected ok=false with
     * `failure` (if not); JS-initiated closes pass notify=false, like Nearby's disconnect.
     */
    fun close(notify: Boolean, failure: String?) {
      val wasConnected = synchronized(stateLock) {
        if (closed) return
        closed = true
        connected
      }
      links.remove(id, this)
      main.removeCallbacks(timeout)
      socket?.let { closeQuietly(it) }
      writer.shutdown()
      if (!notify) return
      if (wasConnected) {
        emit("onLanDisconnected", mapOf("linkId" to id))
      } else if (peerName != null || !incoming) {
        // An incoming socket that never said hello was never shown to JS: drop it silently.
        emit("onLanConnected", mapOf("linkId" to id, "ok" to false, "status" to (failure ?: "CONNECTION_LOST")))
      }
    }
  }

  private fun closeQuietly(s: Socket) {
    try {
      s.close()
    } catch (_: IOException) {
    }
  }

  private companion object {
    const val CONNECT_TIMEOUT_MS = 10_000
    const val HELLO_TIMEOUT_MS = 15_000
    /** How long a request may wait for both people to accept. */
    const val DECIDE_TIMEOUT_MS = 120_000L
    const val MAX_PENDING_INCOMING = 5

    fun randomHex(bytes: Int): String {
      val b = ByteArray(bytes)
      SecureRandom().nextBytes(b)
      return b.joinToString("") { "%02x".format(it) }
    }
  }
}
