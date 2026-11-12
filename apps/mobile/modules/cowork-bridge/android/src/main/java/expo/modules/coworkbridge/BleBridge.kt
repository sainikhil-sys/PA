package expo.modules.coworkbridge

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.Promise

/**
 * Bluetooth LE text fallback. Every phone runs a GATT server (service 6f3d0001-...) and advertises the
 * service UUID with its display name in the scan response, and scans for others. The side that taps
 * "connect" becomes the GATT client (central): it writes chunks to RX (write with response) and gets
 * chunks back as TX notifications. Messages are at most 4 KB of opaque, already-encrypted bytes.
 *
 * Links: outgoing ones use the found id `ble:<address>`, incoming ones are `ble:c:<address>`.
 * Same HELLO / ACCEPT / REJECT / DATA rules as the LAN transport (protocol.ts): nothing is delivered
 * before both sides accept. All state lives on one HandlerThread; bytes are never logged.
 */
@SuppressLint("MissingPermission") // JS requests the Bluetooth permissions first; SecurityException is caught.
internal class BleBridge(private val context: Context, private val emit: Emit) {
  private val thread = HandlerThread("cowork-ble").apply { start() }
  private val h = Handler(thread.looper)
  private val manager: BluetoothManager? get() = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  private val adapter: BluetoothAdapter? get() = manager?.adapter

  // Everything below is touched only on `h`'s thread.
  private var myName = "Cowork user"
  private var running = false
  private var server: BluetoothGattServer? = null
  private var txChar: BluetoothGattCharacteristic? = null
  private var advertising: AdvertiseCallback? = null
  private var scanning: ScanCallback? = null
  private var startPromise: Promise? = null
  private val links = HashMap<String, BleLink>()
  private val seen = HashMap<String, Seen>()
  private val serverMtu = HashMap<String, Int>()

  private class Seen(var device: BluetoothDevice, var name: String, var lastSeen: Long)

  private val sweep = object : Runnable {
    override fun run() {
      val now = SystemClock.elapsedRealtime()
      val gone = seen.filter { (id, s) -> now - s.lastSeen > LOST_AFTER_MS && links[id] == null }.keys
      gone.forEach { id ->
        seen.remove(id)
        emit("onBleLost", mapOf("linkId" to id))
      }
      if (running) h.postDelayed(this, SWEEP_MS)
    }
  }

  /** Runs on the BLE thread; returns Unit so module functions do not leak Handler.post's Boolean. */
  private fun onBle(block: () -> Unit) = post(block)

  /**
   * Everything runs on the BLE thread. A permission revoked mid-session or Bluetooth turned off can
   * make any radio call throw; that must never crash the app's process from this thread.
   */
  private fun post(block: () -> Unit) {
    h.post {
      try {
        block()
      } catch (_: SecurityException) {
      } catch (_: IllegalStateException) {
      }
    }
  }

  // ---------- Start and stop ----------

  fun start(name: String, promise: Promise) = onBle {
    val a = adapter
    if (a == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      promise.reject("ERR_BRIDGE_BLE", "BLUETOOTH_UNSUPPORTED", null)
      return@onBle
    }
    myName = Wire.cleanName(name)
    try {
      if (!a.isEnabled) {
        promise.reject("ERR_BRIDGE_BLE", "BLUETOOTH_OFF", null)
        return@onBle
      }
      if (running || startPromise != null) {
        // Already visible: refresh the advertised name and carry on.
        if (running) restartAdvertising()
        promise.resolve(null)
        return@onBle
      }
      startPromise = promise
      // After pause() the GATT server and links are still up: only advertising and scanning restart.
      if (server != null) startAdvertising() else openServer()
    } catch (e: SecurityException) {
      if (startPromise === promise) failStart("MISSING_PERMISSION", e) else promise.reject("ERR_BRIDGE_BLE", "MISSING_PERMISSION", e)
    } catch (e: IllegalStateException) {
      // Bluetooth turned off while starting.
      if (startPromise === promise) failStart("BLUETOOTH_OFF", e) else promise.reject("ERR_BRIDGE_BLE", "BLUETOOTH_OFF", e)
    }
  }

  fun stop() = onBle { stopNow() }

  /**
   * App in the background: stop advertising and scanning, but keep the GATT server and every link so
   * connected people stay connected. New incoming links are refused until start() runs again.
   */
  fun pause() = onBle {
    running = false
    h.removeCallbacks(sweep)
    startPromise?.reject("ERR_BRIDGE_BLE", "Stopped", null)
    startPromise = null
    try {
      scanning?.let { adapter?.bluetoothLeScanner?.stopScan(it) }
      advertising?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
    } catch (_: SecurityException) {
    } catch (_: IllegalStateException) {
      // Bluetooth turned off meanwhile.
    }
    scanning = null
    advertising = null
    seen.keys.retainAll(links.keys)
  }

  private fun stopNow() {
    running = false
    h.removeCallbacks(sweep)
    startPromise?.reject("ERR_BRIDGE_BLE", "Stopped", null)
    startPromise = null
    try {
      scanning?.let { adapter?.bluetoothLeScanner?.stopScan(it) }
      advertising?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
    } catch (_: SecurityException) {
    } catch (_: IllegalStateException) {
      // Bluetooth turned off meanwhile.
    }
    scanning = null
    advertising = null
    links.values.toList().forEach { it.close(notify = false, failure = null) }
    links.clear()
    seen.clear()
    serverMtu.clear()
    try {
      server?.close()
    } catch (_: SecurityException) {
    }
    server = null
    txChar = null
  }

  fun destroy() {
    post {
      stopNow()
      thread.quitSafely()
    }
  }

  private fun failStart(status: String, cause: Throwable?) {
    val p = startPromise
    startPromise = null
    stopNow()
    p?.reject("ERR_BRIDGE_BLE", status, cause)
  }

  private fun openServer() {
    val m = manager ?: return failStart("BLUETOOTH_UNSUPPORTED", null)
    val s = m.openGattServer(context, serverCallback) ?: return failStart("BLUETOOTH_UNSUPPORTED", null)
    server = s
    val service = BluetoothGattService(Wire.BLE_SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val rx = BluetoothGattCharacteristic(Wire.BLE_RX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE)
    val tx = BluetoothGattCharacteristic(Wire.BLE_TX, BluetoothGattCharacteristic.PROPERTY_NOTIFY, 0)
    tx.addDescriptor(BluetoothGattDescriptor(Wire.CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    service.addCharacteristic(rx)
    service.addCharacteristic(tx)
    txChar = tx
    // Advertising starts once the service is added (onServiceAdded).
    if (!s.addService(service)) failStart("BLUETOOTH_GATT_FAILED", null)
  }

  private fun advertiseSettings() = AdvertiseSettings.Builder()
    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
    .setConnectable(true)
    .setTimeout(0)
    .build()

  private fun startAdvertising() {
    val adv = adapter?.bluetoothLeAdvertiser
    if (adv == null) {
      // No peripheral mode on this phone: it can still find others and connect to them.
      startScanning()
      return
    }
    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(Wire.BLE_SERVICE))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()
    // The display name is the only personal thing advertised (24 bytes fit in the scan response).
    val response = AdvertiseData.Builder()
      .addManufacturerData(Wire.ADV_COMPANY_ID, Wire.truncateUtf8(myName, Wire.MAX_ADV_NAME_BYTES))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()
    val cb = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
        post { if (startPromise != null) startScanning() }
      }

      override fun onStartFailure(errorCode: Int) {
        post {
          if (errorCode != ADVERTISE_FAILED_ALREADY_STARTED && advertising === this) advertising = null
          if (startPromise != null) startScanning()
        }
      }
    }
    advertising = cb
    adv.startAdvertising(advertiseSettings(), data, response, cb)
  }

  private fun restartAdvertising() {
    try {
      advertising?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
    } catch (_: IllegalStateException) {
    }
    advertising = null
    val adv = adapter?.bluetoothLeAdvertiser ?: return
    val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(Wire.BLE_SERVICE)).setIncludeDeviceName(false).build()
    val response = AdvertiseData.Builder().addManufacturerData(Wire.ADV_COMPANY_ID, Wire.truncateUtf8(myName, Wire.MAX_ADV_NAME_BYTES)).setIncludeDeviceName(false).build()
    val cb = object : AdvertiseCallback() {}
    advertising = cb
    adv.startAdvertising(advertiseSettings(), data, response, cb)
  }

  private fun startScanning() {
    val scanner = adapter?.bluetoothLeScanner ?: return failStart("BLUETOOTH_OFF", null)
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        post { onSeen(result) }
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        val copy = results.toList()
        post { copy.forEach { onSeen(it) } }
      }

      override fun onScanFailed(errorCode: Int) = Unit
    }
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(Wire.BLE_SERVICE)).build())
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    try {
      scanner.startScan(filters, settings, cb)
    } catch (e: SecurityException) {
      return failStart("MISSING_PERMISSION", e)
    }
    scanning = cb
    running = true
    h.removeCallbacks(sweep)
    h.postDelayed(sweep, SWEEP_MS)
    startPromise?.resolve(null)
    startPromise = null
  }

  private fun onSeen(result: ScanResult) {
    if (!running) return
    val id = "ble:" + result.device.address
    val record = result.scanRecord
    // Android peers put the name in manufacturer data; iPhones in the local name.
    val raw = record?.getManufacturerSpecificData(Wire.ADV_COMPANY_ID)?.let { String(it, Charsets.UTF_8) } ?: record?.deviceName
    val now = SystemClock.elapsedRealtime()
    val known = seen[id]
    if (known == null) {
      val name = Wire.cleanName(raw ?: "")
      seen[id] = Seen(result.device, name, now)
      emit("onBleFound", mapOf("linkId" to id, "name" to name))
      return
    }
    known.lastSeen = now
    known.device = result.device
    if (raw != null) {
      val name = Wire.cleanName(raw)
      if (name != known.name) {
        // The scan response (with the name) can arrive after the first advertisement.
        known.name = name
        emit("onBleFound", mapOf("linkId" to id, "name" to name))
      }
    }
  }

  // ---------- Public link calls (any thread) ----------

  fun connect(linkId: String, promise: Promise) = onBle {
    val s = seen[linkId]
    if (!running || s == null) {
      promise.reject("ERR_BRIDGE_LINK", "NOT_FOUND", null)
      return@onBle
    }
    if (links[linkId]?.closed == false) {
      promise.resolve(null)
      return@onBle
    }
    val link = BleLink(linkId, s.device, central = true)
    links[linkId] = link
    link.connectPromise = promise
    h.postDelayed(link.connectTimeout, CONNECT_TIMEOUT_MS)
    h.postDelayed(link.decideTimeout, DECIDE_TIMEOUT_MS)
    try {
      link.gatt = s.device.connectGatt(context, false, link.gattCallback, BluetoothDevice.TRANSPORT_LE)
      if (link.gatt == null) link.close(notify = true, failure = "NOT_CONNECTED")
    } catch (e: SecurityException) {
      link.close(notify = true, failure = "MISSING_PERMISSION")
    }
  }

  fun accept(linkId: String, promise: Promise) = onBle {
    val link = links[linkId]
    if (link == null || link.closed) promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null) else link.acceptLocal(promise)
  }

  fun reject(linkId: String, promise: Promise) = onBle {
    links[linkId]?.rejectLocal()
    promise.resolve(null)
  }

  fun send(linkId: String, base64: String, promise: Promise) {
    val bytes = try {
      Base64.decode(base64, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload is not valid base64", e)
      return
    }
    if (bytes.isEmpty() || bytes.size > Wire.MAX_BLE_DATA) {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload must be 1 to ${Wire.MAX_BLE_DATA} bytes", null)
      return
    }
    post {
      val link = links[linkId]
      if (link == null || !link.connected || link.closed) promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null)
      else link.enqueue(Wire.body(Wire.DATA, bytes), promise)
    }
  }

  fun disconnect(linkId: String) = onBle { links[linkId]?.close(notify = false, failure = null) }

  // ---------- GATT server (we are the peripheral) ----------

  private fun peripheralLink(device: BluetoothDevice): BleLink? {
    val id = "ble:c:" + device.address
    links[id]?.let { return if (it.closed) null else it }
    if (!running) return null
    val pending = links.values.count { !it.central && !it.connected }
    if (pending >= MAX_PENDING_INCOMING) return null
    val link = BleLink(id, device, central = false)
    link.chunkSize = chunkFor(serverMtu[device.address] ?: DEFAULT_MTU)
    links[id] = link
    h.postDelayed(link.decideTimeout, DECIDE_TIMEOUT_MS)
    return link
  }

  private fun respond(device: BluetoothDevice, requestId: Int, ok: Boolean, value: ByteArray? = null) {
    try {
      server?.sendResponse(device, requestId, if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_FAILURE, 0, value)
    } catch (_: SecurityException) {
    }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) {
      post {
        if (startPromise == null) return@post
        if (status == BluetoothGatt.GATT_SUCCESS) startAdvertising() else failStart("BLUETOOTH_GATT_FAILED", null)
      }
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      // Android also reports connections this phone made as a central here, so links are only
      // created on the first subscribe or write, never on connect.
      if (newState != BluetoothProfile.STATE_DISCONNECTED) return
      post {
        serverMtu.remove(device.address)
        links["ble:c:" + device.address]?.close(notify = true, failure = "CONNECTION_LOST")
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      post {
        serverMtu[device.address] = mtu
        links["ble:c:" + device.address]?.chunkSize = chunkFor(mtu)
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      val v = value?.copyOf()
      val uuid = characteristic.uuid
      post {
        if (uuid != Wire.BLE_RX || preparedWrite || offset != 0 || v == null) {
          if (responseNeeded) respond(device, requestId, false)
          return@post
        }
        val link = peripheralLink(device)
        if (link == null) {
          if (responseNeeded) respond(device, requestId, false)
          return@post
        }
        if (responseNeeded) respond(device, requestId, true)
        link.onChunk(v)
      }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      val v = value?.copyOf()
      val isCccd = descriptor.uuid == Wire.CCCD && descriptor.characteristic?.uuid == Wire.BLE_TX
      post {
        if (!isCccd || preparedWrite || offset != 0 || v == null) {
          if (responseNeeded) respond(device, requestId, false)
          return@post
        }
        val enable = v.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        val link = if (enable) peripheralLink(device) else links["ble:c:" + device.address]
        if (link == null) {
          if (responseNeeded) respond(device, requestId, !enable)
          return@post
        }
        if (responseNeeded) respond(device, requestId, true)
        link.setReady(enable)
      }
    }

    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) {
      post {
        val on = links["ble:c:" + device.address]?.ready == true
        respond(device, requestId, true, if (on) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
      }
    }

    override fun onExecuteWrite(device: BluetoothDevice, requestId: Int, execute: Boolean) {
      post { respond(device, requestId, false) }
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      post { links["ble:c:" + device.address]?.onSent(status == BluetoothGatt.GATT_SUCCESS) }
    }
  }

  // ---------- One link ----------

  private inner class BleLink(val id: String, val device: BluetoothDevice, val central: Boolean) {
    var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    var chunkSize = chunkFor(DEFAULT_MTU)
    var ready = false
      private set
    private var helloSent = false
    private var peerName: String? = null
    private var localAccepted = false
    private var remoteAccepted = false
    var connected = false
      private set
    var closed = false
      private set
    private var closeWhenFlushed = false
    var connectPromise: Promise? = null
    private val reassembler = BleReassembler()
    private val queue = ArrayDeque<Pair<ByteArray, Promise?>>()
    private var inFlight = false

    val decideTimeout = Runnable { close(notify = true, failure = "TIMEOUT") }
    val connectTimeout = Runnable { close(notify = true, failure = "TIMEOUT") }

    val gattCallback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
        post { onCentralState(g, status, newState) }
      }

      override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
        post {
          if (closed) return@post
          chunkSize = chunkFor(if (status == BluetoothGatt.GATT_SUCCESS) mtu else DEFAULT_MTU)
          if (!g.discoverServices()) close(notify = true, failure = "NOT_CONNECTED")
        }
      }

      override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
        post { onCentralServices(g, status) }
      }

      override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
        post {
          if (closed) return@post
          if (status != BluetoothGatt.GATT_SUCCESS) return@post close(notify = true, failure = "NOT_CONNECTED")
          h.removeCallbacks(connectTimeout)
          connectPromise?.resolve(null)
          connectPromise = null
          setReady(true)
        }
      }

      override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        post { onSent(status == BluetoothGatt.GATT_SUCCESS) }
      }

      // Android 13+.
      override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        if (characteristic.uuid != Wire.BLE_TX) return
        val v = value.copyOf()
        post { onChunk(v) }
      }

      // Android 12 and earlier. Android 13+ may also call this one; it is ignored there.
      @Deprecated("Replaced by the overload with a value on Android 13")
      @Suppress("DEPRECATION")
      override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU || characteristic.uuid != Wire.BLE_TX) return
        val v = characteristic.value?.copyOf() ?: return
        post { onChunk(v) }
      }
    }

    private fun onCentralState(g: BluetoothGatt, status: Int, newState: Int) {
      if (closed) return
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        // Ask for a large MTU; discovery continues in onMtuChanged.
        if (!g.requestMtu(REQUEST_MTU) && !g.discoverServices()) close(notify = true, failure = "NOT_CONNECTED")
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
        close(notify = true, failure = "CONNECTION_LOST")
      }
    }

    @Suppress("DEPRECATION")
    private fun onCentralServices(g: BluetoothGatt, status: Int) {
      if (closed) return
      val service = if (status == BluetoothGatt.GATT_SUCCESS) g.getService(Wire.BLE_SERVICE) else null
      val rxc = service?.getCharacteristic(Wire.BLE_RX)
      val txc = service?.getCharacteristic(Wire.BLE_TX)
      val cccd = txc?.getDescriptor(Wire.CCCD)
      if (rxc == null || txc == null || cccd == null) return close(notify = true, failure = "NOT_COWORK")
      rx = rxc
      if (!g.setCharacteristicNotification(txc, true)) return close(notify = true, failure = "NOT_CONNECTED")
      val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
      } else {
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        g.writeDescriptor(cccd)
      }
      if (!ok) close(notify = true, failure = "NOT_CONNECTED")
    }

    fun setReady(on: Boolean) {
      ready = on
      if (on && !helloSent) {
        helloSent = true
        enqueue(Wire.hello(myName), null)
      }
      pump()
    }

    fun onChunk(chunk: ByteArray) {
      if (closed) return
      try {
        val body = reassembler.push(chunk) ?: return
        handle(body)
      } catch (_: ProtocolException) {
        close(notify = true, failure = "PROTOCOL_ERROR")
      }
    }

    private fun handle(body: ByteArray) {
      when (Wire.kindOf(body)) {
        Wire.HELLO -> {
          if (peerName != null) throw ProtocolException("Second hello")
          val name = Wire.nameFromHello(body)
          peerName = name
          emit("onBleRequest", mapOf("linkId" to id, "name" to name, "incoming" to !central))
        }
        Wire.ACCEPT -> {
          if (peerName == null || remoteAccepted) throw ProtocolException("Unexpected accept")
          remoteAccepted = true
          maybeConnected()
        }
        Wire.REJECT -> close(notify = true, failure = "REJECTED")
        Wire.DATA -> {
          if (!connected) throw ProtocolException("Data before accept")
          emit("onBlePayload", mapOf("linkId" to id, "data" to Base64.encodeToString(body, 1, body.size - 1, Base64.NO_WRAP)))
        }
      }
    }

    private fun maybeConnected() {
      if (localAccepted && remoteAccepted && !connected && !closed) {
        connected = true
        h.removeCallbacks(decideTimeout)
        emit("onBleConnected", mapOf("linkId" to id, "ok" to true, "status" to "OK"))
      }
    }

    fun acceptLocal(promise: Promise) {
      if (peerName == null) return promise.reject("ERR_BRIDGE_LINK", "Nothing to accept yet", null)
      if (localAccepted) return promise.resolve(null)
      localAccepted = true
      enqueue(Wire.body(Wire.ACCEPT), promise)
      maybeConnected()
    }

    fun rejectLocal() {
      if (closed) return
      if (!ready) return close(notify = false, failure = null)
      enqueue(Wire.body(Wire.REJECT), null)
      closeWhenFlushed = true
      // If the other phone stops acknowledging, close anyway.
      h.postDelayed({ close(notify = false, failure = null) }, 2_000)
    }

    fun enqueue(body: ByteArray, promise: Promise?) {
      if (closed) return promise?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null) ?: Unit
      val chunks = Wire.bleChunks(body, chunkSize)
      chunks.forEachIndexed { i, c -> queue.addLast(c to if (i == chunks.lastIndex) promise else null) }
      pump()
    }

    private fun pump() {
      if (inFlight || !ready || closed) return
      val chunk = queue.firstOrNull()?.first ?: return
      val ok = try {
        if (central) writeChunk(chunk) else notifyChunk(chunk)
      } catch (_: SecurityException) {
        false
      }
      if (ok) inFlight = true else close(notify = true, failure = "CONNECTION_LOST")
    }

    @Suppress("DEPRECATION")
    private fun writeChunk(chunk: ByteArray): Boolean {
      val g = gatt ?: return false
      val c = rx ?: return false
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        g.writeCharacteristic(c, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
      } else {
        c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        c.value = chunk
        g.writeCharacteristic(c)
      }
    }

    @Suppress("DEPRECATION")
    private fun notifyChunk(chunk: ByteArray): Boolean {
      val s = server ?: return false
      val c = txChar ?: return false
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        s.notifyCharacteristicChanged(device, c, false, chunk) == BluetoothStatusCodes.SUCCESS
      } else {
        // Safe: every link runs on this one thread, so the shared value cannot change underneath.
        c.value = chunk
        s.notifyCharacteristicChanged(device, c, false)
      }
    }

    fun onSent(success: Boolean) {
      if (closed || !inFlight) return
      inFlight = false
      val (_, promise) = queue.removeFirstOrNull() ?: return
      if (!success) {
        promise?.reject("ERR_BRIDGE_LINK", "ENDPOINT_IO_ERROR", null)
        return close(notify = true, failure = "CONNECTION_LOST")
      }
      promise?.resolve(null)
      if (queue.isEmpty() && closeWhenFlushed) return close(notify = false, failure = null)
      pump()
    }

    /** Idempotent. Same notify rules as the LAN link. */
    fun close(notify: Boolean, failure: String?) {
      if (closed) return
      closed = true
      if (links[id] === this) links.remove(id)
      h.removeCallbacks(decideTimeout)
      h.removeCallbacks(connectTimeout)
      queue.forEach { it.second?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED", null) }
      queue.clear()
      val pendingConnect = connectPromise
      connectPromise = null
      try {
        if (central) {
          gatt?.disconnect()
          gatt?.close()
        } else {
          server?.cancelConnection(device)
        }
      } catch (_: SecurityException) {
      }
      gatt = null
      if (pendingConnect != null) {
        // The connect call itself fails; JS never saw a request, so no event.
        pendingConnect.reject("ERR_BRIDGE_LINK", failure ?: "NOT_CONNECTED", null)
        return
      }
      if (!notify) return
      if (connected) {
        emit("onBleDisconnected", mapOf("linkId" to id))
      } else if (peerName != null || central) {
        emit("onBleConnected", mapOf("linkId" to id, "ok" to false, "status" to (failure ?: "CONNECTION_LOST")))
      }
    }
  }

  private companion object {
    const val DEFAULT_MTU = 23
    const val REQUEST_MTU = 517
    /** ATT payload is MTU - 3; a write with response carries at most 512 bytes. */
    fun chunkFor(mtu: Int) = minOf(mtu - 3, 512).coerceAtLeast(20)
    const val CONNECT_TIMEOUT_MS = 20_000L
    const val DECIDE_TIMEOUT_MS = 120_000L
    const val SWEEP_MS = 10_000L
    const val LOST_AFTER_MS = 30_000L
    const val MAX_PENDING_INCOMING = 5
  }
}
