// UNVERIFIED: written on Windows without Xcode; never compiled or run. Review and build on a Mac
// (CoreBluetooth) before shipping. Same GATT layout, chunking and events as BleBridge.kt.

import CoreBluetooth
import ExpoModulesCore
import Foundation

/// Bluetooth LE text fallback for iPhone: a GATT peripheral (service 6f3d0001-..., RX written by the
/// other phone, TX notified to it) plus a central that scans for the same service. The side that taps
/// "connect" is the central. Messages are at most 4 KB of opaque bytes, chunked as in protocol.ts.
/// All CoreBluetooth work runs on one serial queue. Bytes are never logged.
final class BleBridge: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
  private let emit: BridgeEmit
  fileprivate let q = DispatchQueue(label: "cowork.bridge.ble")
  private let serviceUUID = CBUUID(string: Wire.bleService)
  private let rxUUID = CBUUID(string: Wire.bleRx)
  private let txUUID = CBUUID(string: Wire.bleTx)

  // All below on `q`.
  private var myName = "Cowork user"
  private var running = false
  private var startPromise: Promise?
  private var startTimer: DispatchWorkItem?
  private var centralManager: CBCentralManager?
  fileprivate var peripheralManager: CBPeripheralManager?
  fileprivate var txChar: CBMutableCharacteristic?
  private var serviceState: ServiceState = .none
  private var links: [String: BleLink] = [:]
  private var seen: [String: Seen] = [:]
  /// Centrals this phone closed: iOS cannot disconnect a central, so their writes are ignored until they unsubscribe.
  private var closedCentrals = Set<UUID>()
  private var sweepTimer: DispatchSourceTimer?

  private enum ServiceState { case none, adding, added }

  private final class Seen {
    let peripheral: CBPeripheral
    var name: String
    var lastSeen: Date
    init(peripheral: CBPeripheral, name: String, lastSeen: Date) {
      self.peripheral = peripheral
      self.name = name
      self.lastSeen = lastSeen
    }
  }

  private static let connectTimeout: TimeInterval = 20
  private static let decideTimeout: TimeInterval = 120
  private static let lostAfter: TimeInterval = 30
  private static let maxPendingIncoming = 5

  init(emit: @escaping BridgeEmit) {
    self.emit = emit
    super.init()
  }

  // MARK: Start and stop

  func start(name: String, promise: Promise) {
    q.async {
      self.myName = Wire.cleanName(name)
      if self.running {
        self.advertise()
        promise.resolve()
        return
      }
      if self.startPromise != nil {
        promise.reject("ERR_BRIDGE_BLE", "Already starting")
        return
      }
      self.startPromise = promise
      let timer = DispatchWorkItem { [weak self] in self?.failStart("BLUETOOTH_TIMEOUT") }
      self.startTimer = timer
      self.q.asyncAfter(deadline: .now() + 10, execute: timer)
      if self.centralManager == nil {
        // Creating the managers shows the Bluetooth permission prompt the first time.
        self.centralManager = CBCentralManager(delegate: self, queue: self.q, options: [CBCentralManagerOptionShowPowerAlertKey: true])
      }
      if self.peripheralManager == nil {
        self.peripheralManager = CBPeripheralManager(delegate: self, queue: self.q, options: nil)
      }
      self.continueStart()
    }
  }

  func stop() {
    q.async { self.stopNow() }
  }

  /// App in the background: stop scanning and advertising, keep the GATT service and every link.
  /// New incoming links are refused until start runs again.
  func pause() {
    q.async {
      self.running = false
      self.sweepTimer?.cancel()
      self.sweepTimer = nil
      self.startTimer?.cancel()
      self.startTimer = nil
      if let p = self.startPromise {
        self.startPromise = nil
        p.reject("ERR_BRIDGE_BLE", "Stopped")
      }
      if self.centralManager?.state == .poweredOn { self.centralManager?.stopScan() }
      if self.peripheralManager?.state == .poweredOn { self.peripheralManager?.stopAdvertising() }
      self.seen = self.seen.filter { self.links[$0.key] != nil }
    }
  }

  func destroy() {
    q.async { self.stopNow() }
  }

  private func stopNow() {
    running = false
    sweepTimer?.cancel()
    sweepTimer = nil
    startTimer?.cancel()
    startTimer = nil
    if let p = startPromise {
      startPromise = nil
      p.reject("ERR_BRIDGE_BLE", "Stopped")
    }
    if centralManager?.state == .poweredOn { centralManager?.stopScan() }
    if peripheralManager?.state == .poweredOn {
      peripheralManager?.stopAdvertising()
      peripheralManager?.removeAllServices()
    }
    serviceState = .none
    txChar = nil
    for link in Array(links.values) { link.close(notify: false, failure: nil) }
    links.removeAll()
    seen.removeAll()
    closedCentrals.removeAll()
  }

  private func failStart(_ status: String) {
    let p = startPromise
    startPromise = nil
    stopNow()
    p?.reject("ERR_BRIDGE_BLE", status)
  }

  private func continueStart() {
    guard startPromise != nil, let c = centralManager, let pm = peripheralManager else { return }
    if c.state == .unauthorized || pm.state == .unauthorized { return failStart("MISSING_PERMISSION") }
    if c.state == .unsupported { return failStart("BLUETOOTH_UNSUPPORTED") }
    if c.state == .poweredOff { return failStart("BLUETOOTH_OFF") }
    // .unknown and .resetting: wait for the next state update.
    guard c.state == .poweredOn else { return }
    // A phone without peripheral support can still find others and connect to them.
    if pm.state == .poweredOn {
      switch serviceState {
      case .none:
        addService(pm)
        return
      case .adding:
        return
      case .added:
        advertise()
      }
    } else if pm.state == .unknown || pm.state == .resetting {
      return
    }
    c.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    running = true
    startSweep()
    startTimer?.cancel()
    startTimer = nil
    let p = startPromise
    startPromise = nil
    p?.resolve()
  }

  private func addService(_ pm: CBPeripheralManager) {
    let rx = CBMutableCharacteristic(type: rxUUID, properties: [.write], value: nil, permissions: [.writeable])
    let tx = CBMutableCharacteristic(type: txUUID, properties: [.notify], value: nil, permissions: [.readable])
    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [rx, tx]
    txChar = tx
    serviceState = .adding
    pm.add(service)
  }

  private func advertise() {
    guard let pm = peripheralManager, pm.state == .poweredOn, serviceState == .added else { return }
    if pm.isAdvertising { pm.stopAdvertising() }
    // The display name is the only personal thing advertised.
    let shortName = String(decoding: Wire.truncateUtf8(myName, maxBytes: Wire.maxAdvNameBytes), as: UTF8.self)
    pm.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID], CBAdvertisementDataLocalNameKey: shortName])
  }

  private func startSweep() {
    sweepTimer?.cancel()
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + 10, repeating: 10)
    t.setEventHandler { [weak self] in
      guard let self else { return }
      let now = Date()
      for (id, s) in self.seen where now.timeIntervalSince(s.lastSeen) > BleBridge.lostAfter && self.links[id] == nil {
        self.seen.removeValue(forKey: id)
        self.emit("onBleLost", ["linkId": id])
      }
    }
    sweepTimer = t
    t.resume()
  }

  // MARK: CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if startPromise != nil { return continueStart() }
    if central.state != .poweredOn && running {
      // Bluetooth went off: every central-role link is gone.
      for link in Array(links.values) where link.isCentralRole { link.close(notify: true, failure: "CONNECTION_LOST") }
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard running else { return }
    let id = "ble:" + peripheral.identifier.uuidString
    var raw: String?
    // Android peers put the name in manufacturer data under company 0xFFFF; iPhones in the local name.
    if let mfr = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
      let b = [UInt8](mfr)
      if b.count > 2 && b[0] == 0xFF && b[1] == 0xFF { raw = String(decoding: b[2...], as: UTF8.self) }
    }
    if raw == nil { raw = advertisementData[CBAdvertisementDataLocalNameKey] as? String }
    if let known = seen[id] {
      known.lastSeen = Date()
      if let raw {
        let name = Wire.cleanName(raw)
        if name != known.name {
          known.name = name
          emit("onBleFound", ["linkId": id, "name": name])
        }
      }
      return
    }
    let name = Wire.cleanName(raw ?? "")
    seen[id] = Seen(peripheral: peripheral, name: name, lastSeen: Date())
    emit("onBleFound", ["linkId": id, "name": name])
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard let link = links["ble:" + peripheral.identifier.uuidString], !link.closed else { return }
    peripheral.delegate = self
    peripheral.discoverServices([serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    links["ble:" + peripheral.identifier.uuidString]?.close(notify: true, failure: "NOT_CONNECTED")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    links["ble:" + peripheral.identifier.uuidString]?.close(notify: true, failure: "CONNECTION_LOST")
  }

  // MARK: CBPeripheralDelegate (we are the central)

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let link = links["ble:" + peripheral.identifier.uuidString], !link.closed else { return }
    guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == serviceUUID }) else {
      return link.close(notify: true, failure: "NOT_COWORK")
    }
    peripheral.discoverCharacteristics([rxUUID, txUUID], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let link = links["ble:" + peripheral.identifier.uuidString], !link.closed else { return }
    let rx = service.characteristics?.first(where: { $0.uuid == rxUUID })
    let tx = service.characteristics?.first(where: { $0.uuid == txUUID })
    guard error == nil, let rx, let tx else { return link.close(notify: true, failure: "NOT_COWORK") }
    link.rx = rx
    peripheral.setNotifyValue(true, for: tx)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard let link = links["ble:" + peripheral.identifier.uuidString], !link.closed, characteristic.uuid == txUUID else { return }
    guard error == nil, characteristic.isNotifying else { return link.close(notify: true, failure: "NOT_CONNECTED") }
    link.chunkSize = max(20, min(peripheral.maximumWriteValueLength(for: .withResponse), 512))
    link.connectTimer?.cancel()
    if let p = link.connectPromise {
      link.connectPromise = nil
      p.resolve()
    }
    link.setReady(true)
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    links["ble:" + peripheral.identifier.uuidString]?.onSent(success: error == nil)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == txUUID, error == nil, let value = characteristic.value else { return }
    links["ble:" + peripheral.identifier.uuidString]?.onChunk(Data(value))
  }

  // MARK: CBPeripheralManagerDelegate (we are the peripheral)

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state != .poweredOn {
      serviceState = .none
      for link in Array(links.values) where !link.isCentralRole { link.close(notify: true, failure: "CONNECTION_LOST") }
    }
    if startPromise != nil { return continueStart() }
    if running && peripheral.state == .poweredOn && serviceState == .none { addService(peripheral) }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if error != nil {
      serviceState = .none
      if startPromise != nil { failStart("BLUETOOTH_GATT_FAILED") }
      return
    }
    serviceState = .added
    if startPromise != nil { continueStart() } else if running { advertise() }
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    // A failure leaves this phone able to connect out, just not to be found.
  }

  private func peripheralLink(_ central: CBCentral) -> BleLink? {
    let id = "ble:c:" + central.identifier.uuidString
    if let link = links[id] { return link.closed ? nil : link }
    if !running || closedCentrals.contains(central.identifier) { return nil }
    let pending = links.values.filter { !$0.isCentralRole && !$0.handshake.connected }.count
    if pending >= BleBridge.maxPendingIncoming { return nil }
    let link = BleLink(id: id, bridge: self, peripheral: nil, remoteCentral: central)
    link.chunkSize = max(20, min(central.maximumUpdateValueLength, 512))
    links[id] = link
    link.armDecideTimer()
    return link
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    guard characteristic.uuid == txUUID, let link = peripheralLink(central) else { return }
    link.setReady(true)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    // iOS gives no disconnect callback for a central; unsubscribing is the signal.
    closedCentrals.remove(central.identifier)
    links["ble:c:" + central.identifier.uuidString]?.close(notify: true, failure: "CONNECTION_LOST")
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    guard let first = requests.first else { return }
    var ok = true
    for r in requests {
      guard r.characteristic.uuid == rxUUID, r.offset == 0, let value = r.value, let link = peripheralLink(r.central) else {
        ok = false
        continue
      }
      link.onChunk(Data(value))
    }
    // iOS: respond once, to the first request, for the whole batch.
    peripheral.respond(to: first, withResult: ok ? .success : .unlikelyError)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    for link in Array(links.values) where !link.isCentralRole { link.pump() }
  }

  // MARK: Public link calls

  func connect(linkId: String, promise: Promise) {
    q.async {
      guard self.running, let s = self.seen[linkId], let c = self.centralManager, c.state == .poweredOn else {
        promise.reject("ERR_BRIDGE_LINK", "NOT_FOUND")
        return
      }
      if let existing = self.links[linkId], !existing.closed {
        promise.resolve()
        return
      }
      let link = BleLink(id: linkId, bridge: self, peripheral: s.peripheral, remoteCentral: nil)
      link.connectPromise = promise
      self.links[linkId] = link
      link.armDecideTimer()
      let timer = DispatchWorkItem { [weak link] in link?.close(notify: true, failure: "TIMEOUT") }
      link.connectTimer = timer
      self.q.asyncAfter(deadline: .now() + BleBridge.connectTimeout, execute: timer)
      c.connect(s.peripheral, options: nil)
    }
  }

  func accept(linkId: String, promise: Promise) {
    q.async {
      guard let link = self.links[linkId], !link.closed else {
        promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED")
        return
      }
      link.acceptLocal(promise: promise)
    }
  }

  func reject(linkId: String, promise: Promise) {
    q.async {
      self.links[linkId]?.rejectLocal()
      promise.resolve()
    }
  }

  func send(linkId: String, base64: String, promise: Promise) {
    guard let bytes = Data(base64Encoded: base64) else {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload is not valid base64")
      return
    }
    guard bytes.count >= 1, bytes.count <= Wire.maxBleData else {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload must be 1 to \(Wire.maxBleData) bytes")
      return
    }
    q.async {
      guard let link = self.links[linkId], link.handshake.connected, !link.closed else {
        promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED")
        return
      }
      link.enqueue(Wire.body(Wire.data, bytes), promise: promise)
    }
  }

  func disconnect(linkId: String) {
    q.async { self.links[linkId]?.close(notify: false, failure: nil) }
  }

  // MARK: One link (runs on `q`)

  fileprivate final class BleLink {
    let id: String
    unowned let bridge: BleBridge
    /// Set when this phone is the central (it asked to connect).
    let peripheral: CBPeripheral?
    /// Set when this phone is the peripheral (the other phone asked).
    let remoteCentral: CBCentral?
    var isCentralRole: Bool { peripheral != nil }
    var rx: CBCharacteristic?
    var chunkSize = 20
    let handshake = Handshake()
    private let reassembler = BleReassembler()
    private var queue: [(Data, Promise?)] = []
    private var inFlight = false
    private var ready = false
    private var helloSent = false
    private var closeWhenFlushed = false
    private(set) var closed = false
    var connectPromise: Promise?
    var connectTimer: DispatchWorkItem?
    private var decideTimer: DispatchWorkItem?

    init(id: String, bridge: BleBridge, peripheral: CBPeripheral?, remoteCentral: CBCentral?) {
      self.id = id
      self.bridge = bridge
      self.peripheral = peripheral
      self.remoteCentral = remoteCentral
    }

    func armDecideTimer() {
      let t = DispatchWorkItem { [weak self] in self?.close(notify: true, failure: "TIMEOUT") }
      decideTimer = t
      bridge.q.asyncAfter(deadline: .now() + BleBridge.decideTimeout, execute: t)
    }

    func setReady(_ on: Bool) {
      ready = on
      if on && !helloSent {
        helloSent = true
        enqueue(Wire.helloBody(bridge.myName), promise: nil)
      }
      pump()
    }

    func onChunk(_ chunk: Data) {
      if closed { return }
      do {
        guard let body = try reassembler.push(chunk) else { return }
        try handle(body)
      } catch {
        close(notify: true, failure: "PROTOCOL_ERROR")
      }
    }

    private func handle(_ body: Data) throws {
      switch try handshake.onBody(body) {
      case .request(let name):
        bridge.emit("onBleRequest", ["linkId": id, "name": name, "incoming": !isCentralRole])
      case .connected:
        connectedNow()
      case .rejected:
        close(notify: true, failure: "REJECTED")
      case .data(let payload):
        bridge.emit("onBlePayload", ["linkId": id, "data": payload.base64EncodedString()])
      case .none:
        break
      }
    }

    private func connectedNow() {
      decideTimer?.cancel()
      bridge.emit("onBleConnected", ["linkId": id, "ok": true, "status": "OK"])
    }

    func acceptLocal(promise: Promise) {
      if handshake.localAccepted {
        promise.resolve()
        return
      }
      guard let outcome = handshake.acceptLocal() else {
        promise.reject("ERR_BRIDGE_LINK", "Nothing to accept yet")
        return
      }
      enqueue(Wire.body(Wire.accept), promise: promise)
      if case .connected = outcome { connectedNow() }
    }

    func rejectLocal() {
      if closed { return }
      if !ready { return close(notify: false, failure: nil) }
      enqueue(Wire.body(Wire.reject), promise: nil)
      closeWhenFlushed = true
      bridge.q.asyncAfter(deadline: .now() + 2) { [weak self] in self?.close(notify: false, failure: nil) }
    }

    func enqueue(_ body: Data, promise: Promise?) {
      if closed {
        promise?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED")
        return
      }
      let chunks = Wire.bleChunks(body, chunkSize: chunkSize)
      for (i, c) in chunks.enumerated() { queue.append((c, i == chunks.count - 1 ? promise : nil)) }
      pump()
    }

    func pump() {
      guard ready, !closed, !inFlight else { return }
      while let head = queue.first {
        let (chunk, promise) = head
        if let p = peripheral {
          guard let rx else { return close(notify: true, failure: "NOT_CONNECTED") }
          p.writeValue(chunk, for: rx, type: .withResponse)
          inFlight = true
          return
        }
        guard let pm = bridge.peripheralManager, let tx = bridge.txChar, let c = remoteCentral else {
          return close(notify: true, failure: "CONNECTION_LOST")
        }
        // False means the transmit queue is full: peripheralManagerIsReady calls pump again.
        guard pm.updateValue(chunk, for: tx, onSubscribedCentrals: [c]) else { return }
        queue.removeFirst()
        promise?.resolve()
        if queue.isEmpty && closeWhenFlushed { return close(notify: false, failure: nil) }
      }
    }

    func onSent(success: Bool) {
      guard !closed, inFlight, !queue.isEmpty else { return }
      inFlight = false
      let (_, promise) = queue.removeFirst()
      if !success {
        promise?.reject("ERR_BRIDGE_LINK", "ENDPOINT_IO_ERROR")
        return close(notify: true, failure: "CONNECTION_LOST")
      }
      promise?.resolve()
      if queue.isEmpty && closeWhenFlushed { return close(notify: false, failure: nil) }
      pump()
    }

    /// Idempotent. Same notify rules as BleBridge.kt.
    func close(notify: Bool, failure: String?) {
      if closed { return }
      closed = true
      if bridge.links[id] === self { bridge.links.removeValue(forKey: id) }
      decideTimer?.cancel()
      connectTimer?.cancel()
      for (_, p) in queue { p?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED") }
      queue.removeAll()
      if let p = peripheral {
        bridge.centralManager?.cancelPeripheralConnection(p)
      } else if let c = remoteCentral {
        bridge.closedCentrals.insert(c.identifier)
      }
      if let p = connectPromise {
        // The connect call itself fails; JS never saw a request, so no event.
        connectPromise = nil
        p.reject("ERR_BRIDGE_LINK", failure ?? "NOT_CONNECTED")
        return
      }
      guard notify else { return }
      if handshake.connected {
        bridge.emit("onBleDisconnected", ["linkId": id])
      } else if handshake.peerName != nil || isCentralRole {
        bridge.emit("onBleConnected", ["linkId": id, "ok": false, "status": failure ?? "CONNECTION_LOST"])
      }
    }
  }
}
