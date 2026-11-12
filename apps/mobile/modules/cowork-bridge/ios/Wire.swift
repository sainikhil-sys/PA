// UNVERIFIED: written on Windows without Xcode; never compiled. Mirrors modules/cowork-bridge/protocol.ts
// (the tested reference) and android/.../Wire.kt byte for byte. Review and build on a Mac before use.

import Foundation

/// A peer broke the wire protocol. The link is closed; nothing more is read from it.
struct WireError: Error {
  let reason: String
  init(_ reason: String) { self.reason = reason }
}

/// Cowork Bridge wire protocol. Every DATA payload is opaque: the Noise session above encrypts it.
enum Wire {
  static let hello: UInt8 = 1
  static let accept: UInt8 = 2
  static let reject: UInt8 = 3
  static let data: UInt8 = 4

  static let maxLanBody = 64 * 1024
  static let maxLanData = maxLanBody - 1
  static let maxBleData = 4 * 1024
  static let maxBleBody = maxBleData + 1
  static let maxHelloBytes = 200
  static let maxNameChars = 40
  static let maxAdvNameBytes = 24

  static let chunkFirst: UInt8 = 0x80
  static let chunkLast: UInt8 = 0x40
  static let seqMask: UInt8 = 0x3f

  static let serviceType = "_coworkconnect._tcp"
  static let bleService = "6F3D0001-7C5E-4A8B-9A0E-6C6F776F726B"
  static let bleRx = "6F3D0002-7C5E-4A8B-9A0E-6C6F776F726B"
  static let bleTx = "6F3D0003-7C5E-4A8B-9A0E-6C6F776F726B"
  /// Bluetooth SIG "reserved for testing" company id; Android peers put the name under it.
  static let advCompanyId: UInt16 = 0xFFFF

  static func body(_ kind: UInt8, _ payload: Data = Data()) -> Data {
    var out = Data([kind])
    out.append(payload)
    return out
  }

  static func helloBody(_ name: String) -> Data {
    body(hello, truncateUtf8(cleanName(name), maxBytes: maxHelloBytes))
  }

  /// Validates a body and returns its kind.
  static func kindOf(_ b: Data) throws -> UInt8 {
    guard let kind = b.first else { throw WireError("Empty body") }
    guard kind >= hello && kind <= data else { throw WireError("Unknown kind") }
    if (kind == accept || kind == reject) && b.count != 1 { throw WireError("Unexpected payload") }
    if kind == hello && b.count - 1 > maxHelloBytes { throw WireError("Name too long") }
    return kind
  }

  static func payload(_ b: Data) -> Data { Data(b.dropFirst()) }

  /// Trims, strips control characters, caps at maxNameChars code points; never empty.
  static func cleanName(_ name: String) -> String {
    let scalars = name.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }
    var s = String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespacesAndNewlines)
    if s.unicodeScalars.count > maxNameChars {
      s = String(String.UnicodeScalarView(s.unicodeScalars.prefix(maxNameChars)))
    }
    s = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return s.isEmpty ? "Cowork user" : s
  }

  /// UTF-8 bytes of `s`, cut to at most `maxBytes` without splitting a code point.
  static func truncateUtf8(_ s: String, maxBytes: Int) -> Data {
    var out = Data()
    for scalar in s.unicodeScalars {
      let bytes = Data(String(scalar).utf8)
      if out.count + bytes.count > maxBytes { break }
      out.append(bytes)
    }
    return out
  }

  /// `[u32 big-endian length][body]`.
  static func lanFrame(_ b: Data) -> Data {
    precondition(b.count >= 1 && b.count <= maxLanBody, "Bad frame length")
    let n = UInt32(b.count)
    var out = Data([UInt8(n >> 24 & 0xff), UInt8(n >> 16 & 0xff), UInt8(n >> 8 & 0xff), UInt8(n & 0xff)])
    out.append(b)
    return out
  }

  static func readLength(_ header: Data) -> Int {
    let h = [UInt8](header)
    return Int(UInt32(h[0]) << 24 | UInt32(h[1]) << 16 | UInt32(h[2]) << 8 | UInt32(h[3]))
  }

  /// Splits a body into GATT chunks of at most `chunkSize` bytes each (header included).
  static func bleChunks(_ b: Data, chunkSize: Int) -> [Data] {
    precondition(b.count >= 1 && b.count <= maxBleBody, "Bad body length")
    precondition(chunkSize >= 2, "Chunk size too small")
    let bytes = [UInt8](b)
    let room = chunkSize - 1
    var out: [Data] = []
    var at = 0
    var seq: UInt8 = 0
    while at < bytes.count {
      let end = min(at + room, bytes.count)
      var header = seq & seqMask
      if at == 0 { header |= chunkFirst }
      if end >= bytes.count { header |= chunkLast }
      var chunk = Data([header])
      chunk.append(contentsOf: bytes[at..<end])
      out.append(chunk)
      at = end
      seq = seq &+ 1
    }
    return out
  }
}

/// Reassembles chunks for one direction of one link. Use from one queue.
final class BleReassembler {
  private var buf: Data?
  private var nextSeq: UInt8 = 0

  /// Returns a complete body, or nil while more chunks are needed.
  func push(_ chunk: Data) throws -> Data? {
    let bytes = [UInt8](chunk)
    guard bytes.count >= 2 else { throw WireError("Empty chunk") }
    let header = bytes[0]
    let seq = header & Wire.seqMask
    if header & Wire.chunkFirst != 0 {
      if buf != nil { throw WireError("Body restarted") }
      if seq != 0 { throw WireError("Bad sequence") }
      buf = Data()
      nextSeq = 0
    } else if buf == nil {
      throw WireError("Chunk without a start")
    }
    if seq != nextSeq { throw WireError("Bad sequence") }
    nextSeq = (nextSeq &+ 1) & Wire.seqMask
    guard var b = buf else { throw WireError("Chunk without a start") }
    if b.count + bytes.count - 1 > Wire.maxBleBody { throw WireError("Body too large") }
    b.append(contentsOf: bytes[1...])
    if header & Wire.chunkLast == 0 {
      buf = b
      return nil
    }
    buf = nil
    return b
  }
}

/// The accept rules shared by LAN and BLE links (LinkRules in protocol.ts).
final class Handshake {
  enum Outcome {
    case none
    case request(String)
    case connected
    case rejected
    case data(Data)
  }

  private(set) var peerName: String?
  private(set) var localAccepted = false
  private(set) var remoteAccepted = false
  private(set) var connected = false

  func onBody(_ b: Data) throws -> Outcome {
    switch try Wire.kindOf(b) {
    case Wire.hello:
      if peerName != nil { throw WireError("Second hello") }
      let raw = String(decoding: Wire.payload(b), as: UTF8.self)
      let name = Wire.cleanName(raw)
      peerName = name
      return .request(name)
    case Wire.accept:
      if peerName == nil || remoteAccepted { throw WireError("Unexpected accept") }
      remoteAccepted = true
      return maybeConnected()
    case Wire.reject:
      return .rejected
    default:
      // Nothing is delivered before both sides accepted.
      if !connected { throw WireError("Data before accept") }
      return .data(Wire.payload(b))
    }
  }

  /// This side accepts. `nil` when there is nothing to accept yet (no hello).
  func acceptLocal() -> Outcome? {
    if peerName == nil { return nil }
    if localAccepted { return Outcome.none }
    localAccepted = true
    return maybeConnected()
  }

  private func maybeConnected() -> Outcome {
    if localAccepted && remoteAccepted && !connected {
      connected = true
      return .connected
    }
    return .none
  }
}
