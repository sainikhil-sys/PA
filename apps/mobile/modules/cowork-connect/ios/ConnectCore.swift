// UNVERIFIED: written on Windows without a Swift compiler. Build and test on a Mac before shipping (ios/README.md).
//
// iPhone to iPhone transport for Cowork Connect: Apple's Network framework over peer-to-peer Wi-Fi
// (AWDL), with Bonjour discovery. Multipeer Connectivity is deprecated, so it is not used.
//
// It mirrors the Android module's Nearby Connections semantics so the same TypeScript runs on both:
// - Every phone runs an NWListener (advertising `_coworkp2p._tcp`) and an NWBrowser.
// - The Bonjour instance name is a random 16-hex endpoint id, rotated on stopAll. The TXT record
//   holds only the display name (key "n").
// - requestConnection opens a TCP connection and sends a hello (id, name, random nonce). The other
//   side answers with its own hello. Both then emit onConnectionInitiated with the same 4 digits,
//   derived from both nonces. Nothing is accepted automatically: both sides must call
//   acceptConnection, then both get onConnectionResult ok. Either side can reject.
// - Bytes, file chunks and audio frames travel as typed frames (Wire.swift).
//
// The 4 digits only show both phones saw the same handshake; unlike Nearby's authenticationDigits
// they are not bound to a key exchange. Identity and encryption come from the Noise XX session in
// TypeScript above this layer, as on Android.
//
// All mutable state lives on `queue`. Every public entry point hops onto it.

import CryptoKit
import Foundation
import Network

final class PeerLink {
  enum State {
    case connecting
    case awaitingHello
    case initiated
    case connected
    case closed
  }

  let connection: NWConnection
  let incoming: Bool
  let localNonce = Wire.randomBytes(16)
  var id: String?
  var localName = "Cowork"
  var remoteName = "Nearby phone"
  var remoteNonce = Data()
  var state: State
  var localAccepted = false
  var remoteAccepted = false
  /// True once JS has heard of this link (request resolved, or onConnectionInitiated sent).
  var announced = false
  var requestDone: Once?
  var reader = FrameReader()
  var receiving = false
  var audioInFlight = 0

  init(connection: NWConnection, incoming: Bool) {
    self.connection = connection
    self.incoming = incoming
    self.state = incoming ? .awaitingHello : .connecting
  }
}

final class ConnectCore {
  static let serviceType = "_coworkp2p._tcp"
  static let maxBytes = 32 * 1024
  static let maxName = 40
  private static let maxUnidentified = 8
  private static let maxAudioInFlight = 25

  let queue = DispatchQueue(label: "expo.modules.coworkconnect.core", qos: .userInitiated)
  let emit: (String, [String: Any?]) -> Void

  private(set) var localId = ConnectCore.newEndpointId()
  private var displayName = "Cowork"
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var wantAdvertising = false
  private var wantDiscovery = false
  private var discovered: [String: (name: String, endpoint: NWEndpoint)] = [:]
  private var links: [String: PeerLink] = [:]
  private var unidentified: [PeerLink] = []

  // Set once in init (not lazy, so first use from two threads cannot race).
  private(set) var files: FileTransfers!
  private(set) var audio: VoiceSession!

  init(emit: @escaping (String, [String: Any?]) -> Void) {
    self.emit = emit
    files = FileTransfers(core: self)
    audio = VoiceSession(core: self)
  }

  // MARK: - Advertising and discovery

  func startAdvertising(name: String, done: @escaping (ConnectFailure?) -> Void) {
    queue.async {
      self.displayName = Self.clean(name)
      self.wantAdvertising = true
      if let listener = self.listener {
        // Already advertising: Nearby treats this as success. Refresh the TXT record in case the name changed.
        listener.service = self.service()
        done(nil)
        return
      }
      self.makeListener(Once(done))
    }
  }

  func startDiscovery(done: @escaping (ConnectFailure?) -> Void) {
    queue.async {
      self.wantDiscovery = true
      if self.browser != nil {
        done(nil)
        return
      }
      self.makeBrowser(Once(done))
    }
  }

  func stopAdvertising() {
    queue.async {
      self.wantAdvertising = false
      self.listener?.cancel()
      self.listener = nil
    }
  }

  func stopDiscovery() {
    queue.async {
      self.wantDiscovery = false
      self.browser?.cancel()
      self.browser = nil
      self.discovered = [:]
    }
  }

  /// Stops advertising and discovery and drops every link. Like Nearby's stopAllEndpoints, no local
  /// onDisconnected events are sent. A new endpoint id is used next time, so phones cannot be tracked
  /// across sessions by it.
  func stopAll() {
    queue.async {
      self.wantAdvertising = false
      self.wantDiscovery = false
      self.listener?.cancel()
      self.listener = nil
      self.browser?.cancel()
      self.browser = nil
      self.discovered = [:]
      for link in Array(self.links.values) + self.unidentified {
        self.teardown(link)
      }
      self.localId = Self.newEndpointId()
    }
  }

  /// iOS stops peer-to-peer listeners and browsers in the background. Restart what JS asked for.
  func appDidBecomeActive() {
    queue.async {
      if self.wantAdvertising && self.listener == nil {
        self.makeListener(Once { _ in })
      }
      if self.wantDiscovery && self.browser == nil {
        self.makeBrowser(Once { _ in })
      }
    }
  }

  func shutdown() {
    stopAll()
    audio.stop()
  }

  private func makeListener(_ once: Once) {
    let listener: NWListener
    do {
      listener = try NWListener(using: Self.parameters())
    } catch {
      once.call(ConnectFailure("ERR_CONNECT_ADVERTISE", "Could not start advertising: \(error.localizedDescription)"))
      return
    }
    listener.service = service()
    listener.stateUpdateHandler = { [weak self, weak listener] state in
      guard let self, let listener, self.listener === listener else { return }
      switch state {
      case .ready:
        once.call(nil)
      case .waiting(let error):
        if Self.isPolicyDenied(error) { once.call(.localNetworkDenied) }
      case .failed(let error):
        once.call(Self.isPolicyDenied(error) ? .localNetworkDenied : ConnectFailure("ERR_CONNECT_ADVERTISE", "Advertising stopped: \(error.localizedDescription)"))
        listener.cancel()
        self.listener = nil
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.acceptIncoming(connection)
    }
    self.listener = listener
    listener.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 10) {
      once.call(ConnectFailure("ERR_CONNECT_ADVERTISE", "Advertising did not start. Check that Wi-Fi is on."))
    }
  }

  private func makeBrowser(_ once: Once) {
    let browser = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: Self.parameters())
    browser.stateUpdateHandler = { [weak self, weak browser] state in
      guard let self, let browser, self.browser === browser else { return }
      switch state {
      case .ready:
        once.call(nil)
      case .waiting(let error):
        // Local network permission denied shows up here as a DNS policy error.
        if Self.isPolicyDenied(error) { once.call(.localNetworkDenied) }
      case .failed(let error):
        once.call(Self.isPolicyDenied(error) ? .localNetworkDenied : ConnectFailure("ERR_CONNECT_DISCOVER", "Discovery stopped: \(error.localizedDescription)"))
        browser.cancel()
        self.browser = nil
        self.discovered = [:]
      default:
        break
      }
    }
    browser.browseResultsChangedHandler = { [weak self, weak browser] results, _ in
      guard let self, let browser, self.browser === browser else { return }
      self.updateDiscovered(results)
    }
    self.browser = browser
    browser.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 10) {
      once.call(ConnectFailure("ERR_CONNECT_DISCOVER", "Discovery did not start. Check that Wi-Fi is on."))
    }
  }

  private func updateDiscovered(_ results: Set<NWBrowser.Result>) {
    // The same phone can show up once per interface (peer-to-peer Wi-Fi and infrastructure Wi-Fi):
    // group by instance name, which is the endpoint id.
    var now: [String: (name: String, endpoint: NWEndpoint)] = [:]
    for result in results {
      guard case let .service(instance, _, _, _) = result.endpoint,
            instance != localId,
            Self.isEndpointId(instance),
            now[instance] == nil
      else { continue }
      var name = "Nearby phone"
      if case let .bonjour(txt) = result.metadata, let advertised = txt["n"] {
        name = Self.clean(advertised)
      }
      now[instance] = (name, result.endpoint)
    }
    for (id, entry) in now where discovered[id]?.name != entry.name {
      emit("onEndpointFound", ["endpointId": id, "name": entry.name])
    }
    for id in discovered.keys where now[id] == nil {
      emit("onEndpointLost", ["endpointId": id])
    }
    discovered = now
  }

  private func service() -> NWListener.Service {
    var txt = NWTXTRecord()
    txt["n"] = displayName
    return NWListener.Service(name: localId, type: Self.serviceType, domain: nil, txtRecord: txt)
  }

  // MARK: - Connections

  func requestConnection(name: String, endpointId: String, done: @escaping (ConnectFailure?) -> Void) {
    queue.async {
      if let existing = self.links[endpointId], existing.state != .closed {
        // Same as Nearby's STATUS_ALREADY_CONNECTED_TO_ENDPOINT, which Android treats as success.
        done(nil)
        return
      }
      guard let target = self.discovered[endpointId] else {
        done(ConnectFailure("ERR_CONNECT_STATUS_ENDPOINT_UNKNOWN", "That phone is no longer nearby"))
        return
      }
      let link = PeerLink(connection: NWConnection(to: target.endpoint, using: Self.parameters()), incoming: false)
      link.id = endpointId
      link.localName = Self.clean(name)
      link.remoteName = target.name
      link.requestDone = Once(done)
      self.links[endpointId] = link
      self.start(link)
      self.queue.asyncAfter(deadline: .now() + 20) { [weak self, weak link] in
        guard let self, let link, link.state == .connecting || link.state == .awaitingHello else { return }
        self.fail(link, ConnectFailure("ERR_CONNECT_STATUS_ERROR", "The other phone did not answer"))
      }
    }
  }

  func acceptConnection(_ endpointId: String, done: @escaping (ConnectFailure?) -> Void) {
    queue.async {
      guard let link = self.links[endpointId], link.state == .initiated || link.state == .connected else {
        done(ConnectFailure("ERR_CONNECT_STATUS_ENDPOINT_UNKNOWN", "No connection request from that phone"))
        return
      }
      if link.state == .initiated && !link.localAccepted {
        link.localAccepted = true
        link.connection.send(content: Wire.frame(.accept, Data()), completion: .contentProcessed { _ in })
        self.maybeConnected(link)
      }
      done(nil)
    }
  }

  func rejectConnection(_ endpointId: String, done: @escaping (ConnectFailure?) -> Void) {
    queue.async {
      guard let link = self.links[endpointId], link.state != .closed else {
        done(nil)
        return
      }
      let announced = link.announced
      self.teardown(link, finalFrame: Wire.frame(.reject, Data()))
      if announced {
        // Nearby reports a rejection to both sides.
        self.emit("onConnectionResult", ["endpointId": endpointId, "ok": false, "status": "STATUS_CONNECTION_REJECTED"])
      }
      done(nil)
    }
  }

  func sendBytes(_ endpointId: String, base64: String, done: @escaping (ConnectFailure?) -> Void) {
    guard let bytes = Data(base64Encoded: base64) else {
      done(ConnectFailure("ERR_CONNECT_PAYLOAD", "Payload is not valid base64"))
      return
    }
    guard bytes.count <= Self.maxBytes else {
      done(ConnectFailure("ERR_CONNECT_PAYLOAD", "Payload is larger than \(Self.maxBytes) bytes"))
      return
    }
    queue.async {
      let sent = self.send(endpointId, .bytes, bytes) { error in
        done(error.map { ConnectFailure("ERR_CONNECT_STATUS_ENDPOINT_IO_ERROR", $0.localizedDescription) })
      }
      if !sent { done(.notConnected) }
    }
  }

  /// Local disconnect. Like Nearby, the other phone gets onDisconnected and this one does not.
  func disconnect(_ endpointId: String) {
    queue.async {
      if let link = self.links[endpointId] { self.teardown(link) }
    }
  }

  // MARK: - Used by FileTransfers and VoiceSession (on `queue`)

  func isConnected(_ endpointId: String) -> Bool {
    links[endpointId]?.state == .connected
  }

  /// Queues one frame on a connected link. Returns false when the link is not connected.
  @discardableResult
  func send(_ endpointId: String, _ type: FrameType, _ body: Data, completion: ((NWError?) -> Void)? = nil) -> Bool {
    guard let link = links[endpointId], link.state == .connected else { return false }
    link.connection.send(content: Wire.frame(type, body), completion: .contentProcessed { error in completion?(error) })
    return true
  }

  /// Audio is dropped rather than queued when a link falls behind, so latency stays low.
  func sendAudio(_ endpointId: String, _ body: Data) {
    guard let link = links[endpointId], link.state == .connected, link.audioInFlight < Self.maxAudioInFlight else { return }
    link.audioInFlight += 1
    link.connection.send(content: Wire.frame(.audio, body), completion: .contentProcessed { [weak link] _ in
      link?.audioInFlight -= 1
    })
  }

  // MARK: - Link lifecycle

  private func acceptIncoming(_ connection: NWConnection) {
    guard wantAdvertising, unidentified.count < Self.maxUnidentified else {
      connection.cancel()
      return
    }
    let link = PeerLink(connection: connection, incoming: true)
    unidentified.append(link)
    start(link)
    queue.asyncAfter(deadline: .now() + 10) { [weak self, weak link] in
      guard let self, let link, link.id == nil, link.state != .closed else { return }
      self.teardown(link)
    }
  }

  private func start(_ link: PeerLink) {
    link.connection.stateUpdateHandler = { [weak self, weak link] state in
      guard let self, let link, link.state != .closed else { return }
      switch state {
      case .ready:
        if !link.incoming && link.state == .connecting {
          link.state = .awaitingHello
          self.sendHello(link)
          // Nearby resolves requestConnection once the request is out; the answer comes as events.
          link.announced = true
          link.requestDone?.call(nil)
        }
        if !link.receiving {
          link.receiving = true
          self.receive(link)
        }
      case .waiting(let error), .failed(let error):
        self.fail(link, ConnectFailure("ERR_CONNECT_STATUS_ERROR", error.localizedDescription))
      default:
        break
      }
    }
    link.connection.start(queue: queue)
  }

  private func receive(_ link: PeerLink) {
    link.connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self, weak link] data, _, isComplete, error in
      guard let self, let link, link.state != .closed else { return }
      if let data, !data.isEmpty {
        link.reader.append(data)
        do {
          while let frame = try link.reader.next() {
            self.handle(link, frame)
            if link.state == .closed { return }
          }
        } catch {
          self.fail(link, ConnectFailure("ERR_CONNECT_PROTOCOL", "The other phone sent data Cowork could not read"))
          return
        }
      }
      if isComplete || error != nil {
        self.fail(link, ConnectFailure("ERR_CONNECT_STATUS_ERROR", error?.localizedDescription ?? "Connection closed"))
        return
      }
      self.receive(link)
    }
  }

  private func handle(_ link: PeerLink, _ frame: FrameReader.Frame) {
    guard let type = FrameType(rawValue: frame.type) else { return } // Unknown types: ignored for forward compatibility.
    switch type {
    case .hello:
      handleHello(link, frame.body)
    case .accept:
      guard link.state == .initiated else { return protocolError(link) }
      link.remoteAccepted = true
      maybeConnected(link)
    case .reject:
      let announced = link.announced
      teardown(link)
      if announced, let id = link.id {
        emit("onConnectionResult", ["endpointId": id, "ok": false, "status": "STATUS_CONNECTION_REJECTED"])
      }
    case .bytes:
      guard link.state == .connected, let id = link.id, frame.body.count <= Self.maxBytes else { return }
      emit("onPayload", ["endpointId": id, "data": Data(frame.body).base64EncodedString()])
    case .fileStart, .fileChunk, .fileEnd, .fileCancel:
      guard link.state == .connected, let id = link.id else { return }
      files.handle(from: id, type, frame.body)
    case .audio:
      guard link.state == .connected, let id = link.id else { return }
      audio.receive(from: id, frame.body)
    }
  }

  private func handleHello(_ link: PeerLink, _ body: [UInt8]) {
    guard link.state == .awaitingHello, let hello = Hello(body), hello.id != localId else { return protocolError(link) }

    if link.incoming {
      if let existing = links[hello.id], existing !== link {
        let racing = !existing.incoming && (existing.state == .connecting || existing.state == .awaitingHello)
        if racing && localId > hello.id {
          // Both phones asked at the same moment. The phone with the smaller id keeps its own request,
          // so this phone drops its request and answers the other one instead (as the incoming side).
          existing.requestDone?.call(nil)
          teardown(existing)
        } else {
          teardown(link)
          return
        }
      }
      unidentified.removeAll { $0 === link }
      link.id = hello.id
      link.remoteName = Self.clean(hello.name)
      link.remoteNonce = hello.nonce
      link.localName = displayName
      links[hello.id] = link
      sendHello(link)
      link.state = .initiated
      link.announced = true
      emit("onConnectionInitiated", [
        "endpointId": hello.id,
        "name": link.remoteName,
        "incoming": true,
        "authDigits": Self.verifier(initiatorNonce: hello.nonce, responderNonce: link.localNonce, initiatorId: hello.id, responderId: localId),
      ])
    } else {
      guard let id = link.id, hello.id == id else { return protocolError(link) }
      link.remoteName = Self.clean(hello.name)
      link.remoteNonce = hello.nonce
      link.state = .initiated
      emit("onConnectionInitiated", [
        "endpointId": id,
        "name": link.remoteName,
        "incoming": false,
        "authDigits": Self.verifier(initiatorNonce: link.localNonce, responderNonce: hello.nonce, initiatorId: localId, responderId: id),
      ])
    }
  }

  private func sendHello(_ link: PeerLink) {
    let hello = Hello(id: localId, name: link.localName, nonce: link.localNonce)
    link.connection.send(content: Wire.frame(.hello, hello.encoded()), completion: .contentProcessed { _ in })
  }

  private func maybeConnected(_ link: PeerLink) {
    guard link.state == .initiated, link.localAccepted, link.remoteAccepted, let id = link.id else { return }
    link.state = .connected
    emit("onConnectionResult", ["endpointId": id, "ok": true, "status": "STATUS_OK"])
  }

  private func protocolError(_ link: PeerLink) {
    fail(link, ConnectFailure("ERR_CONNECT_PROTOCOL", "The other phone sent data Cowork could not read"))
  }

  /// Ends a link because of the network or the peer, and reports it the way Nearby would.
  private func fail(_ link: PeerLink, _ failure: ConnectFailure) {
    guard link.state != .closed else { return }
    let wasConnected = link.state == .connected
    teardown(link)
    if let request = link.requestDone, !request.done {
      request.call(failure)
      return
    }
    guard link.announced, let id = link.id else { return }
    if wasConnected {
      emit("onDisconnected", ["endpointId": id])
    } else {
      emit("onConnectionResult", ["endpointId": id, "ok": false, "status": "STATUS_ERROR"])
    }
  }

  /// Closes a link without any event. `finalFrame` is sent before the connection closes.
  private func teardown(_ link: PeerLink, finalFrame: Data? = nil) {
    guard link.state != .closed else { return }
    link.state = .closed
    unidentified.removeAll { $0 === link }
    if let id = link.id, links[id] === link {
      links[id] = nil
      files.linkClosed(id)
    }
    link.connection.stateUpdateHandler = nil
    if let finalFrame {
      let connection = link.connection
      connection.send(content: finalFrame, completion: .contentProcessed { _ in connection.cancel() })
    } else {
      link.connection.cancel()
    }
  }

  // MARK: - Helpers

  static func parameters() -> NWParameters {
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true
    tcp.enableKeepalive = true
    tcp.keepaliveIdle = 5
    tcp.keepaliveInterval = 2
    tcp.keepaliveCount = 3
    tcp.connectionTimeout = 10
    let parameters = NWParameters(tls: nil, tcp: tcp)
    parameters.includePeerToPeer = true
    return parameters
  }

  /// kDNSServiceErr_PolicyDenied: the person turned off Local Network access for the app.
  static func isPolicyDenied(_ error: NWError) -> Bool {
    if case let .dns(code) = error, code == -65570 { return true }
    return false
  }

  static func newEndpointId() -> String {
    Wire.hex(Wire.randomBytes(8))
  }

  static func isEndpointId(_ s: String) -> Bool {
    s.count == 16 && s.allSatisfy { $0.isHexDigit }
  }

  static func clean(_ name: String) -> String {
    let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxName))
    return trimmed.isEmpty ? "Cowork" : trimmed
  }

  /// 4 digits both phones compute from the same inputs: SHA-256 over a label, both nonces and both ids,
  /// requester first. First 4 bytes as a big-endian number, modulo 10000, zero padded.
  static func verifier(initiatorNonce: Data, responderNonce: Data, initiatorId: String, responderId: String) -> String {
    var hasher = SHA256()
    hasher.update(data: Data("cowork-connect-verifier-v1".utf8))
    hasher.update(data: initiatorNonce)
    hasher.update(data: responderNonce)
    hasher.update(data: Data(initiatorId.utf8))
    hasher.update(data: Data(responderId.utf8))
    let d = Array(hasher.finalize())
    let n = Wire.readU32BE(d, 0) % 10000
    return String(format: "%04u", n)
  }
}

/// First frame each side sends.
struct Hello {
  let id: String
  let name: String
  let nonce: Data

  init(id: String, name: String, nonce: Data) {
    self.id = id
    self.name = name
    self.nonce = nonce
  }

  init?(_ body: [UInt8]) {
    guard body.count <= 1024,
          let object = try? JSONSerialization.jsonObject(with: Data(body)) as? [String: Any],
          let id = object["id"] as? String, ConnectCore.isEndpointId(id),
          let name = object["name"] as? String,
          let nonceText = object["nonce"] as? String,
          let nonce = Data(base64Encoded: nonceText), nonce.count == 16
    else { return nil }
    self.id = id
    self.name = name
    self.nonce = nonce
  }

  func encoded() -> Data {
    let object: [String: Any] = ["v": 1, "id": id, "name": name, "nonce": nonce.base64EncodedString()]
    return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
  }
}
