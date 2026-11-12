// UNVERIFIED: written on Windows without Xcode; never compiled or run. Review and build on a Mac
// (Network framework, NetworkExtension) before shipping. Same protocol and events as LanBridge.kt.

import ExpoModulesCore
import Foundation
import Network
import NetworkExtension
import Security

typealias BridgeEmit = (String, [String: Any?]) -> Void

/// Local network transport for iPhone: joins an Android LocalOnlyHotspot (NEHotspotConfiguration),
/// browses and advertises `_coworkconnect._tcp` over Bonjour (NWBrowser, NWListener), and talks
/// `[u32 length][body]` frames over TCP (NWConnection). Bytes are opaque and never logged.
final class LanBridge {
  private let emit: BridgeEmit
  private let q = DispatchQueue(label: "cowork.bridge.lan")
  private let instanceId = "cw-" + LanBridge.randomHex(5)
  private var inCounter = 0

  // All below on `q`.
  private var myName = "Cowork user"
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var found: [String: NWEndpoint] = [:]
  private var links: [String: LanLink] = [:]

  private static let connectTimeout: TimeInterval = 10
  private static let helloTimeout: TimeInterval = 15
  private static let decideTimeout: TimeInterval = 120
  private static let maxPendingIncoming = 5

  init(emit: @escaping BridgeEmit) {
    self.emit = emit
  }

  // MARK: Hotspot (join only: iOS apps cannot host one)

  func joinHotspot(ssid: String, passphrase: String, promise: Promise) {
    guard !ssid.isEmpty, passphrase.count >= 8 else {
      promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_HOTSPOT_NO_CREDENTIALS")
      return
    }
    let config = NEHotspotConfiguration(ssid: ssid, passphrase: passphrase, isWEP: false)
    // Removed again when Cowork leaves the foreground: the hotspot is temporary.
    config.joinOnce = true
    NEHotspotConfigurationManager.shared.apply(config) { error in
      guard let error = error as NSError? else {
        promise.resolve()
        return
      }
      if error.domain == NEHotspotConfigurationErrorDomain, let code = NEHotspotConfigurationError(rawValue: error.code) {
        switch code {
        case .alreadyAssociated:
          promise.resolve()
        case .userDenied:
          promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_JOIN_DENIED")
        case .invalidWPAPassphrase, .invalidSSID:
          promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_HOTSPOT_NO_CREDENTIALS")
        default:
          promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_JOIN_FAILED")
        }
      } else {
        promise.reject("ERR_BRIDGE_HOTSPOT", "WIFI_JOIN_FAILED")
      }
    }
  }

  // MARK: Browse and advertise

  func browseStart(name: String, promise: Promise) {
    q.async {
      self.myName = Wire.cleanName(name)
      do {
        try self.startListener()
      } catch {
        promise.reject("ERR_BRIDGE_SERVER", "Could not open the local server")
        return
      }
      self.startBrowser()
      promise.resolve()
    }
  }

  func browseStop() {
    q.async { self.stopAll() }
  }

  /// App in the background: stop browsing and advertising, keep the listener and every link.
  /// browseStart resumes (it re-advertises on the existing listener).
  func browsePause() {
    q.async {
      self.browser?.cancel()
      self.browser = nil
      self.listener?.service = nil
      self.found.removeAll()
    }
  }

  private func stopAll() {
    browser?.cancel()
    browser = nil
    listener?.cancel()
    listener = nil
    found.removeAll()
    for link in Array(links.values) { link.close(notify: false, failure: nil) }
    links.removeAll()
  }

  func destroy() {
    q.async { self.stopAll() }
  }

  private func startListener() throws {
    if let l = listener {
      // Refresh the advertised name if it changed.
      l.service = service()
      return
    }
    let params = NWParameters.tcp
    params.includePeerToPeer = false
    let l = try NWListener(using: params)
    l.service = service()
    l.newConnectionHandler = { [weak self] conn in
      guard let self else { conn.cancel(); return }
      let pending = self.links.values.filter { $0.incoming && !$0.handshake.connected }.count
      if pending >= LanBridge.maxPendingIncoming {
        conn.cancel()
        return
      }
      self.inCounter += 1
      let link = LanLink(id: "lan:in:\(self.inCounter)", incoming: true, connection: conn, bridge: self)
      self.links[link.id] = link
      link.start(promise: nil, resolveWith: nil)
    }
    l.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.listener?.cancel(); self?.listener = nil }
    }
    listener = l
    l.start(queue: q)
  }

  private func service() -> NWListener.Service {
    // The display name is the only personal thing advertised.
    let shortName = String(decoding: Wire.truncateUtf8(myName, maxBytes: 160), as: UTF8.self)
    let txt = NWTXTRecord(["n": shortName, "v": "1"])
    return NWListener.Service(name: instanceId, type: Wire.serviceType, domain: nil, txtRecord: txt)
  }

  private func startBrowser() {
    if browser != nil { return }
    let b = NWBrowser(for: .bonjourWithTXTRecord(type: Wire.serviceType, domain: nil), using: .tcp)
    b.browseResultsChangedHandler = { [weak self] _, changes in
      guard let self else { return }
      for change in changes {
        switch change {
        case .added(let result), .changed(_, let result, _):
          self.onResult(result)
        case .removed(let result):
          if case let .service(name, _, _, _) = result.endpoint {
            let id = self.linkIdFor(name)
            if self.found.removeValue(forKey: id) != nil { self.emit("onLanLost", ["linkId": id]) }
          }
        default:
          break
        }
      }
    }
    b.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.browser?.cancel(); self?.browser = nil }
    }
    browser = b
    b.start(queue: q)
  }

  private func onResult(_ result: NWBrowser.Result) {
    guard case let .service(name, _, _, _) = result.endpoint else { return }
    if name == instanceId || name == listener?.service?.name { return }
    var raw = "Cowork user"
    if case let .bonjour(txt) = result.metadata, let n = txt["n"] { raw = n }
    let id = linkIdFor(name)
    found[id] = result.endpoint
    emit("onLanFound", ["linkId": id, "name": Wire.cleanName(raw)])
  }

  private func linkIdFor(_ serviceName: String) -> String { "lan:" + String(serviceName.prefix(63)) }

  // MARK: Links

  func connect(linkId: String, promise: Promise) {
    q.async {
      guard let endpoint = self.found[linkId] else {
        promise.reject("ERR_BRIDGE_LINK", "NOT_FOUND")
        return
      }
      self.open(id: linkId, endpoint: endpoint, promise: promise, resolveWith: nil)
    }
  }

  func connectAddress(host: String, port: Int, promise: Promise) {
    guard (1...65535).contains(port), !host.isEmpty, host.count <= 253, let p = NWEndpoint.Port(rawValue: UInt16(port)) else {
      promise.reject("ERR_BRIDGE_LINK", "Bad address")
      return
    }
    let id = "lan:addr:\(host):\(port)"
    q.async {
      self.open(id: id, endpoint: .hostPort(host: NWEndpoint.Host(host), port: p), promise: promise, resolveWith: id)
    }
  }

  private func open(id: String, endpoint: NWEndpoint, promise: Promise, resolveWith: String?) {
    if let existing = links[id], !existing.closed {
      if let r = resolveWith { promise.resolve(r) } else { promise.resolve() }
      return
    }
    let options = NWProtocolTCP.Options()
    options.noDelay = true
    options.connectionTimeout = Int(LanBridge.connectTimeout)
    let link = LanLink(id: id, incoming: false, connection: NWConnection(to: endpoint, using: NWParameters(tls: nil, tcp: options)), bridge: self)
    links[id] = link
    link.start(promise: promise, resolveWith: resolveWith)
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
    guard bytes.count >= 1, bytes.count <= Wire.maxLanData else {
      promise.reject("ERR_BRIDGE_PAYLOAD", "Payload must be 1 to \(Wire.maxLanData) bytes")
      return
    }
    q.async {
      guard let link = self.links[linkId], link.handshake.connected, !link.closed else {
        promise.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED")
        return
      }
      link.write(Wire.body(Wire.data, bytes), promise: promise)
    }
  }

  func disconnect(linkId: String) {
    q.async { self.links[linkId]?.close(notify: false, failure: nil) }
  }

  // MARK: One TCP link (runs on `q`)

  fileprivate final class LanLink {
    let id: String
    let incoming: Bool
    let connection: NWConnection
    unowned let bridge: LanBridge
    let handshake = Handshake()
    private(set) var closed = false
    private var startPromise: Promise?
    private var resolveWith: String?
    private var timeout: DispatchWorkItem?
    private var helloTimer: DispatchWorkItem?

    init(id: String, incoming: Bool, connection: NWConnection, bridge: LanBridge) {
      self.id = id
      self.incoming = incoming
      self.connection = connection
      self.bridge = bridge
    }

    func start(promise: Promise?, resolveWith: String?) {
      startPromise = promise
      self.resolveWith = resolveWith
      connection.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready:
          if let p = self.startPromise {
            if let r = self.resolveWith { p.resolve(r) } else { p.resolve() }
            self.startPromise = nil
          }
          self.onReady()
        case .failed, .cancelled:
          self.close(notify: true, failure: "CONNECTION_LOST")
        case .waiting:
          // No route (for example Wi-Fi off). An outgoing connect fails instead of waiting forever.
          if !self.incoming && self.startPromise != nil { self.close(notify: true, failure: "NOT_CONNECTED") }
        default:
          break
        }
      }
      connection.start(queue: bridge.q)
    }

    private func onReady() {
      let decide = DispatchWorkItem { [weak self] in self?.close(notify: true, failure: "TIMEOUT") }
      timeout = decide
      bridge.q.asyncAfter(deadline: .now() + LanBridge.decideTimeout, execute: decide)
      let hello = DispatchWorkItem { [weak self] in
        guard let self, self.handshake.peerName == nil else { return }
        self.close(notify: true, failure: "TIMEOUT")
      }
      helloTimer = hello
      bridge.q.asyncAfter(deadline: .now() + LanBridge.helloTimeout, execute: hello)
      write(Wire.helloBody(bridge.myName), promise: nil)
      readFrame()
    }

    private func readFrame() {
      connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] header, _, isComplete, error in
        guard let self, !self.closed else { return }
        guard error == nil, let header, header.count == 4 else {
          self.close(notify: true, failure: "CONNECTION_LOST")
          return
        }
        let len = Wire.readLength(header)
        guard len >= 1, len <= Wire.maxLanBody else {
          self.close(notify: true, failure: "PROTOCOL_ERROR")
          return
        }
        self.connection.receive(minimumIncompleteLength: len, maximumLength: len) { [weak self] body, _, _, error in
          guard let self, !self.closed else { return }
          guard error == nil, let body, body.count == len else {
            self.close(notify: true, failure: "CONNECTION_LOST")
            return
          }
          do {
            try self.handle(Data(body))
          } catch {
            self.close(notify: true, failure: "PROTOCOL_ERROR")
            return
          }
          if !self.closed { self.readFrame() }
        }
        _ = isComplete
      }
    }

    private func handle(_ body: Data) throws {
      switch try handshake.onBody(body) {
      case .request(let name):
        helloTimer?.cancel()
        bridge.emit("onLanRequest", ["linkId": id, "name": name, "incoming": incoming])
      case .connected:
        connectedNow()
      case .rejected:
        close(notify: true, failure: "REJECTED")
      case .data(let payload):
        bridge.emit("onLanPayload", ["linkId": id, "data": payload.base64EncodedString()])
      case .none:
        break
      }
    }

    private func connectedNow() {
      timeout?.cancel()
      bridge.emit("onLanConnected", ["linkId": id, "ok": true, "status": "OK"])
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
      write(Wire.body(Wire.accept), promise: promise)
      if case .connected = outcome { connectedNow() }
    }

    func rejectLocal() {
      if closed { return }
      let frame = Wire.lanFrame(Wire.body(Wire.reject))
      connection.send(content: frame, completion: .contentProcessed { [weak self] _ in
        self?.close(notify: false, failure: nil)
      })
    }

    func write(_ body: Data, promise: Promise?) {
      if closed {
        promise?.reject("ERR_BRIDGE_LINK", "NOT_CONNECTED")
        return
      }
      // NWConnection keeps sends in order, which the Noise counter depends on.
      connection.send(content: Wire.lanFrame(body), completion: .contentProcessed { [weak self] error in
        if error != nil {
          promise?.reject("ERR_BRIDGE_LINK", "ENDPOINT_IO_ERROR")
          self?.close(notify: true, failure: "CONNECTION_LOST")
        } else {
          promise?.resolve()
        }
      })
    }

    /// Idempotent. Same notify rules as LanBridge.kt.
    func close(notify: Bool, failure: String?) {
      if closed { return }
      closed = true
      if bridge.links[id] === self { bridge.links.removeValue(forKey: id) }
      timeout?.cancel()
      helloTimer?.cancel()
      connection.stateUpdateHandler = nil
      connection.cancel()
      if let p = startPromise {
        // The connect call itself fails; JS never saw a request, so no event.
        startPromise = nil
        p.reject("ERR_BRIDGE_LINK", failure ?? "NOT_CONNECTED")
        return
      }
      guard notify else { return }
      if handshake.connected {
        bridge.emit("onLanDisconnected", ["linkId": id])
      } else if handshake.peerName != nil || !incoming {
        bridge.emit("onLanConnected", ["linkId": id, "ok": false, "status": failure ?? "CONNECTION_LOST"])
      }
    }
  }

  private static func randomHex(_ count: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: count)
    _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
  }
}
