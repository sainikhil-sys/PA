// UNVERIFIED: written on Windows without a Swift compiler. Build and test on a Mac before shipping (ios/README.md).
//
// Walkie and call audio for Cowork Connect (NATIVE_CONTRACT.md, "Audio (C3 Walkie, C4 calls)").
//
// - PCM 16-bit little-endian mono at 16 kHz, 20 ms frames (320 samples, 640 bytes).
// - Each frame is sealed with this phone's send key (ChaCha20-Poly1305, nonce = 4 zero bytes +
//   8-byte little-endian counter, empty associated data) and sent to every peer as
//   [u16 big-endian ciphertext length][u64 little-endian counter][ciphertext + tag].
// - Each sender has its own receive key here. Frames whose counter is not greater than the last
//   authenticated one are dropped (replay and reorder protection).
// - One AVAudioPlayerNode per sender, mixed by AVAudioEngine.
// - The mic stays off until audioTransmit(true). In Walkie mode a separate capture engine runs only
//   while the person holds to talk. In call mode the playback engine also captures, with Apple's
//   voice processing (echo cancellation) switched on at the first audioTransmit(true).
//
// iOS has no foreground service: audio stops with the app when Connect's links drop in the background.
// All state lives on the core queue. The mic tap converts audio on the audio thread, then hops to the queue.

import AVFoundation
import CryptoKit
import Foundation

final class VoiceSession {
  static let sampleRate = 16_000.0
  static let frameBytes = 640
  private static let maxQueuedPerPeer = 10 // 200 ms: older audio is dropped instead of piling up latency

  private final class RemotePeer {
    var key: SymmetricKey
    var lastCounter: UInt64?
    let player = AVAudioPlayerNode()
    var queued = 0

    init(key: SymmetricKey) {
      self.key = key
    }
  }

  private unowned let core: ConnectCore
  private let wireFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: VoiceSession.sampleRate, channels: 1, interleaved: true)!
  private let playFormat = AVAudioFormat(standardFormatWithSampleRate: VoiceSession.sampleRate, channels: 1)!

  private var active = false
  private var mode = "walkie"
  private var sendKey: SymmetricKey?
  private var sendCounter: UInt64 = 0
  private var transmitting = false
  private var muted = false
  private var peers: [String: RemotePeer] = [:]
  private var engine: AVAudioEngine?
  private var captureEngine: AVAudioEngine?
  private var callCaptureInstalled = false
  private var voiceProcessingOn = false
  private var lastLevel: [String: TimeInterval] = [:]
  private var observers: [NSObjectProtocol] = []

  init(core: ConnectCore) {
    self.core = core
  }

  // MARK: - JS calls

  func start(sendKey sendKeyB64: String, peers peerList: [(String, String)], mode: String, done: @escaping (ConnectFailure?) -> Void) {
    core.queue.async {
      guard let key = Wire.key(sendKeyB64) else { return done(.badKey) }
      var keys: [String: SymmetricKey] = [:]
      for (endpointId, recvKey) in peerList {
        guard let k = Wire.key(recvKey) else { return done(.badKey) }
        keys[endpointId] = k
      }
      if self.active { self.tearDown(emitIdle: false) }

      self.mode = mode == "call" ? "call" : "walkie"
      self.sendKey = key
      self.sendCounter = 0
      self.transmitting = false
      self.muted = false
      do {
        try self.configureSession()
        let engine = AVAudioEngine()
        _ = engine.mainMixerNode // Builds the output chain so the engine can start with no players yet.
        self.engine = engine
        for (endpointId, k) in keys { self.attach(endpointId, key: k) }
        engine.prepare()
        try engine.start()
        self.peers.values.forEach { $0.player.play() }
      } catch {
        self.tearDown(emitIdle: false)
        self.state("error", "Could not start audio: \(error.localizedDescription)")
        return done(ConnectFailure("ERR_CONNECT_AUDIO", "Could not start audio: \(error.localizedDescription)"))
      }
      self.active = true
      self.observe()
      self.state("active")
      done(nil)
    }
  }

  /// Adds a sender, or replaces its key (a new key starts a new counter space). Ignored when audio is
  /// not active, as index.ts documents.
  func addPeer(_ endpointId: String, key: SymmetricKey, done: @escaping (ConnectFailure?) -> Void) {
    core.queue.async {
      defer { done(nil) }
      guard self.active else { return }
      if let existing = self.peers[endpointId] {
        existing.key = key
        existing.lastCounter = nil
      } else {
        self.attach(endpointId, key: key)
        if self.engine?.isRunning == true { self.peers[endpointId]?.player.play() }
      }
    }
  }

  func removePeer(_ endpointId: String) {
    core.queue.async {
      guard let peer = self.peers.removeValue(forKey: endpointId) else { return }
      peer.player.stop()
      self.engine?.detach(peer.player)
      self.lastLevel[endpointId] = nil
    }
  }

  /// Resolves true when the mic state changed as asked, false when microphone permission is off
  /// (then onAudioState reports the error), like Android's transmit.
  func transmit(_ on: Bool, done: @escaping (Result<Bool, ConnectFailure>) -> Void) {
    core.queue.async {
      guard self.active else { return done(.failure(Self.notActive)) }
      if on == self.transmitting { return done(.success(true)) }
      if !on {
        self.transmitting = false
        self.stopCapture()
        self.emitLevel("self", 0, force: true)
        return done(.success(true))
      }
      Self.withMicPermission { granted in
        self.core.queue.async {
          guard self.active else { return done(.failure(Self.notActive)) }
          guard granted else {
            self.state("error", "Microphone permission is off")
            return done(.success(false))
          }
          do {
            try self.startCapture()
            self.transmitting = true
            done(.success(true))
          } catch {
            self.stopCapture()
            done(.failure(ConnectFailure("ERR_CONNECT_AUDIO", "Could not start the microphone: \(error.localizedDescription)")))
          }
        }
      }
    }
  }

  func setMuted(_ muted: Bool) {
    core.queue.async { self.muted = muted }
  }

  func setSpeaker(_ on: Bool) {
    core.queue.async {
      guard self.active else { return }
      do {
        try AVAudioSession.sharedInstance().overrideOutputAudioPort(on ? .speaker : .none)
      } catch {
        self.state("error", "Could not change the speaker: \(error.localizedDescription)")
      }
    }
  }

  func stop() {
    core.queue.async {
      guard self.active else { return }
      self.tearDown(emitIdle: true)
    }
  }

  // MARK: - Network side (core queue)

  func receive(from endpointId: String, _ body: [UInt8]) {
    guard active, let peer = peers[endpointId], body.count >= 2 + 8 + 16 else { return }
    let length = Int(Wire.readU16BE(body, 0))
    guard body.count == 10 + length else { return }
    let counter = Wire.readU64LE(body, 2)
    if let last = peer.lastCounter, counter <= last { return }
    guard let pcm = try? Wire.open(Array(body[10...]), key: peer.key, counter: counter) else { return }
    peer.lastCounter = counter // Only after the tag checks out.
    guard pcm.count > 0, pcm.count % 2 == 0 else { return }
    let samples = [UInt8](pcm)
    schedule(samples, on: peer)
    emitLevel(endpointId, Self.level(samples))
  }

  private func schedule(_ pcm: [UInt8], on peer: RemotePeer) {
    guard let engine, engine.isRunning, peer.queued < Self.maxQueuedPerPeer else { return }
    let count = pcm.count / 2
    guard let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(count)),
          let channel = buffer.floatChannelData?[0]
    else { return }
    buffer.frameLength = AVAudioFrameCount(count)
    for i in 0..<count {
      let sample = Int16(bitPattern: UInt16(pcm[2 * i]) | UInt16(pcm[2 * i + 1]) << 8)
      channel[i] = Float(sample) / 32768
    }
    peer.queued += 1
    peer.player.scheduleBuffer(buffer) { [weak self, weak peer] in
      self?.core.queue.async { peer?.queued -= 1 }
    }
    if !peer.player.isPlaying { peer.player.play() }
  }

  /// A 640-byte frame from the mic, on the core queue.
  private func captured(_ pcm: Data, level: Float) {
    guard active, transmitting, let key = sendKey else { return }
    if muted {
      emitLevel("self", 0)
      return
    }
    emitLevel("self", level)
    let counter = sendCounter
    sendCounter += 1
    guard let sealed = try? Wire.seal(pcm, key: key, counter: counter) else { return }
    var frame = Wire.u16be(UInt16(sealed.count))
    frame.append(Wire.u64le(counter))
    frame.append(sealed)
    for endpointId in peers.keys {
      core.sendAudio(endpointId, frame)
    }
  }

  // MARK: - Engine

  private func configureSession() throws {
    let session = AVAudioSession.sharedInstance()
    if mode == "call" {
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
    } else {
      try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker])
    }
    try? session.setPreferredSampleRate(48_000)
    try? session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
  }

  private func attach(_ endpointId: String, key: SymmetricKey) {
    guard let engine else { return }
    let peer = RemotePeer(key: key)
    engine.attach(peer.player)
    engine.connect(peer.player, to: engine.mainMixerNode, format: playFormat)
    peers[endpointId] = peer
  }

  private func startCapture() throws {
    if mode == "call" {
      guard let engine else { throw ConnectFailure("ERR_CONNECT_AUDIO", "Audio is not running") }
      if !voiceProcessingOn {
        // Voice processing can only change while the engine is stopped.
        engine.stop()
        try engine.inputNode.setVoiceProcessingEnabled(true)
        voiceProcessingOn = true
      }
      if !callCaptureInstalled {
        try installTap(on: engine.inputNode)
        callCaptureInstalled = true
      }
      if !engine.isRunning {
        engine.prepare()
        try engine.start()
        peers.values.forEach { $0.player.play() }
      }
    } else {
      let capture = AVAudioEngine()
      try installTap(on: capture.inputNode)
      capture.prepare()
      try capture.start()
      captureEngine = capture
    }
  }

  private func stopCapture() {
    if let capture = captureEngine {
      capture.inputNode.removeTap(onBus: 0)
      capture.stop()
      captureEngine = nil
    }
    if callCaptureInstalled, let engine {
      engine.inputNode.removeTap(onBus: 0)
      callCaptureInstalled = false
    }
  }

  private func installTap(on input: AVAudioInputNode) throws {
    let inputFormat = input.outputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0,
          let converter = AVAudioConverter(from: inputFormat, to: wireFormat)
    else { throw ConnectFailure("ERR_CONNECT_AUDIO", "No microphone input is available") }
    converter.downmix = true
    let mic = MicFramer(converter: converter, wireFormat: wireFormat) { [weak self] frame, level in
      guard let self else { return }
      self.core.queue.async { self.captured(frame, level: level) }
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in
      mic.process(buffer)
    }
  }

  private func tearDown(emitIdle: Bool) {
    transmitting = false
    stopCapture()
    for peer in peers.values { peer.player.stop() }
    engine?.stop()
    engine = nil
    peers = [:]
    voiceProcessingOn = false
    sendKey = nil
    lastLevel = [:]
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    active = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if emitIdle { state("idle") }
  }

  /// Phone calls, Siri and other apps can interrupt; headphones can change the route.
  private func observe() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
      guard let self else { return }
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      let type = raw.flatMap { AVAudioSession.InterruptionType(rawValue: $0) }
      self.core.queue.async {
        guard self.active else { return }
        if type == .began {
          self.state("error", "Audio was interrupted")
        } else if type == .ended {
          self.restart()
        }
      }
    })
    if let engine {
      observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
        guard let self else { return }
        self.core.queue.async {
          guard self.active else { return }
          self.restart()
        }
      })
    }
  }

  private func restart() {
    guard let engine else { return }
    do {
      try AVAudioSession.sharedInstance().setActive(true)
      if !engine.isRunning {
        engine.prepare()
        try engine.start()
      }
      peers.values.forEach { $0.player.play() }
      if let capture = captureEngine, !capture.isRunning {
        capture.prepare()
        try capture.start()
      }
      state("active")
    } catch {
      state("error", "Could not resume audio: \(error.localizedDescription)")
    }
  }

  // MARK: - Helpers

  private func state(_ value: String, _ message: String? = nil) {
    var body: [String: Any?] = ["state": value]
    if let message { body["message"] = message }
    core.emit("onAudioState", body)
  }

  /// About 10 updates a second per source.
  private func emitLevel(_ endpointId: String, _ level: Float, force: Bool = false) {
    let now = ProcessInfo.processInfo.systemUptime
    if !force, now - (lastLevel[endpointId] ?? 0) < 0.1 { return }
    lastLevel[endpointId] = now
    core.emit("onAudioLevel", ["endpointId": endpointId, "level": Double(min(max(level, 0), 1))])
  }

  /// 0..1 loudness of 16-bit little-endian PCM on a 50 dB scale, the same formula as Android.
  static func level(_ pcm: [UInt8]) -> Float {
    let count = pcm.count / 2
    guard count > 0 else { return 0 }
    var sum: Double = 0
    for i in 0..<count {
      let v = Double(Int16(bitPattern: UInt16(pcm[2 * i]) | UInt16(pcm[2 * i + 1]) << 8))
      sum += v * v
    }
    let rms = (sum / Double(count)).squareRoot()
    if rms < 1 { return 0 }
    let db = 20 * log10(rms / 32768)
    return Float(min(max((db + 50) / 50, 0), 1))
  }

  private static let notActive = ConnectFailure("ERR_CONNECT_AUDIO", "Audio is not active")

  private static func withMicPermission(_ callback: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: callback(true)
      case .denied: callback(false)
      default: AVAudioApplication.requestRecordPermission(completionHandler: callback)
      }
    } else {
      let session = AVAudioSession.sharedInstance()
      switch session.recordPermission {
      case .granted: callback(true)
      case .denied: callback(false)
      default: session.requestRecordPermission(callback)
      }
    }
  }
}

/// Turns mic buffers (any rate, any channels) into 640-byte 16 kHz mono frames.
/// Only touched from the tap's audio thread.
private final class MicFramer {
  private let converter: AVAudioConverter
  private let wireFormat: AVAudioFormat
  private let output: (Data, Float) -> Void
  private var pending: [UInt8] = []

  init(converter: AVAudioConverter, wireFormat: AVAudioFormat, output: @escaping (Data, Float) -> Void) {
    self.converter = converter
    self.wireFormat = wireFormat
    self.output = output
  }

  func process(_ buffer: AVAudioPCMBuffer) {
    let ratio = wireFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let converted = AVAudioPCMBuffer(pcmFormat: wireFormat, frameCapacity: capacity) else { return }
    var fed = false
    var error: NSError?
    let status = converter.convert(to: converted, error: &error) { _, inputStatus in
      if fed {
        // .noDataNow keeps the resampler's state between buffers, unlike .endOfStream.
        inputStatus.pointee = .noDataNow
        return nil
      }
      fed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, converted.frameLength > 0, let channel = converted.int16ChannelData?[0] else { return }
    for i in 0..<Int(converted.frameLength) {
      let sample = UInt16(bitPattern: channel[i])
      pending.append(UInt8(truncatingIfNeeded: sample))
      pending.append(UInt8(truncatingIfNeeded: sample >> 8))
    }
    while pending.count >= VoiceSession.frameBytes {
      let frame = Array(pending[0..<VoiceSession.frameBytes])
      pending.removeFirst(VoiceSession.frameBytes)
      output(Data(frame), VoiceSession.level(frame))
    }
  }
}
