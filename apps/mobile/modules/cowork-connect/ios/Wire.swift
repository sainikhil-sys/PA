// UNVERIFIED: written on Windows without a Swift compiler. Build and test on a Mac before shipping (ios/README.md).
//
// Byte layouts shared by every part of the iOS module.
//
// One TCP connection per link carries all traffic, so each frame has a type byte:
//   [u32 big-endian length][u8 type][body]     length = 1 + body.count, at most `Wire.maxFrame`
//
// Bodies:
//   hello       JSON {"v":1,"id":<16 hex>,"name":<display name>,"nonce":<base64 16 bytes>}
//   accept      empty
//   reject      empty
//   bytes       opaque payload from sendBytes (at most 32 KB, the Nearby byte limit)
//   fileStart   [u64 BE payloadId][u64 BE total encrypted size]
//   fileChunk   [u64 BE payloadId][raw bytes of the encrypted file]
//   fileEnd     [u64 BE payloadId]
//   fileCancel  [u64 BE payloadId]
//   audio       [u16 BE length][u64 LE counter][ciphertext + 16-byte tag]   (NATIVE_CONTRACT.md audio frame)

import CryptoKit
import Foundation

enum FrameType: UInt8 {
  case hello = 1
  case accept = 2
  case reject = 3
  case bytes = 4
  case fileStart = 5
  case fileChunk = 6
  case fileEnd = 7
  case fileCancel = 8
  case audio = 9
}

/// An error that becomes a rejected promise with a readable code, in the same style as Android's
/// `ERR_CONNECT_<Nearby status>` codes.
struct ConnectFailure: Error {
  let code: String
  let message: String

  init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }

  static let notConnected = ConnectFailure("ERR_CONNECT_STATUS_ENDPOINT_UNKNOWN", "Not connected to that phone")
  static let localNetworkDenied = ConnectFailure(
    "ERR_CONNECT_LOCAL_NETWORK_DENIED",
    "Local network access is off for Cowork. Turn it on in Settings > Privacy & Security > Local Network."
  )
  static let badKey = ConnectFailure("ERR_CONNECT_KEY", "Key must be 32 bytes in base64")
}

/// Calls its callback at most once. Only used on the core queue.
final class Once {
  private var callback: ((ConnectFailure?) -> Void)?

  init(_ callback: @escaping (ConnectFailure?) -> Void) {
    self.callback = callback
  }

  var done: Bool { callback == nil }

  func call(_ failure: ConnectFailure?) {
    let callback = self.callback
    self.callback = nil
    callback?(failure)
  }
}

enum Wire {
  /// Largest frame accepted from a peer. File chunks are 64 KiB plus a few header bytes.
  static let maxFrame = 256 * 1024

  static func frame(_ type: FrameType, _ body: Data) -> Data {
    var out = Data(capacity: 5 + body.count)
    out.append(u32be(UInt32(body.count + 1)))
    out.append(type.rawValue)
    out.append(body)
    return out
  }

  static func u16be(_ v: UInt16) -> Data {
    Data([UInt8(truncatingIfNeeded: v >> 8), UInt8(truncatingIfNeeded: v)])
  }

  static func u32be(_ v: UInt32) -> Data {
    Data([
      UInt8(truncatingIfNeeded: v >> 24),
      UInt8(truncatingIfNeeded: v >> 16),
      UInt8(truncatingIfNeeded: v >> 8),
      UInt8(truncatingIfNeeded: v),
    ])
  }

  static func u64be(_ v: UInt64) -> Data {
    Data((0..<8).reversed().map { UInt8(truncatingIfNeeded: v >> ($0 * 8)) })
  }

  static func u64le(_ v: UInt64) -> Data {
    Data((0..<8).map { UInt8(truncatingIfNeeded: v >> ($0 * 8)) })
  }

  static func readU16BE(_ b: [UInt8], _ o: Int) -> UInt16 {
    UInt16(b[o]) << 8 | UInt16(b[o + 1])
  }

  static func readU32BE(_ b: [UInt8], _ o: Int) -> UInt32 {
    UInt32(b[o]) << 24 | UInt32(b[o + 1]) << 16 | UInt32(b[o + 2]) << 8 | UInt32(b[o + 3])
  }

  static func readU64BE(_ b: [UInt8], _ o: Int) -> UInt64 {
    var v: UInt64 = 0
    for i in 0..<8 { v = v << 8 | UInt64(b[o + i]) }
    return v
  }

  static func readU64LE(_ b: [UInt8], _ o: Int) -> UInt64 {
    var v: UInt64 = 0
    for i in (0..<8).reversed() { v = v << 8 | UInt64(b[o + i]) }
    return v
  }

  /// Contract nonce: 4 zero bytes + 8-byte little-endian counter (as in Noise).
  static func nonce(_ counter: UInt64) throws -> ChaChaPoly.Nonce {
    try ChaChaPoly.Nonce(data: Data([0, 0, 0, 0]) + u64le(counter))
  }

  /// Seals with the contract nonce. Returns ciphertext followed by the 16-byte tag, the same layout
  /// Java's "ChaCha20-Poly1305" cipher produces on Android.
  static func seal(_ plain: Data, key: SymmetricKey, counter: UInt64) throws -> Data {
    let box = try ChaChaPoly.seal(plain, using: key, nonce: nonce(counter))
    return box.ciphertext + box.tag
  }

  /// Opens ciphertext + tag. Throws on a failed tag.
  static func open(_ sealed: [UInt8], key: SymmetricKey, counter: UInt64) throws -> Data {
    guard sealed.count >= 16 else { throw ConnectFailure("ERR_CONNECT_DECRYPT", "Sealed data is too short") }
    let box = try ChaChaPoly.SealedBox(
      nonce: nonce(counter),
      ciphertext: Data(sealed[0..<(sealed.count - 16)]),
      tag: Data(sealed[(sealed.count - 16)...])
    )
    return try ChaChaPoly.open(box, using: key)
  }

  static func key(_ base64: String) -> SymmetricKey? {
    guard let raw = Data(base64Encoded: base64), raw.count == 32 else { return nil }
    return SymmetricKey(data: raw)
  }

  static func hex<D: Sequence>(_ bytes: D) -> String where D.Element == UInt8 {
    bytes.map { String(format: "%02x", $0) }.joined()
  }

  static func randomBytes(_ count: Int) -> Data {
    // SystemRandomNumberGenerator is a CSPRNG on Apple platforms.
    Data((0..<count).map { _ in UInt8.random(in: 0...255) })
  }
}

/// Collects TCP bytes and yields whole frames.
struct FrameReader {
  struct Frame {
    let type: UInt8
    let body: [UInt8]
  }

  private var buffer: [UInt8] = []

  mutating func append(_ data: Data) {
    buffer.append(contentsOf: data)
  }

  /// The next complete frame, nil when more bytes are needed. Throws on a length that cannot be valid.
  mutating func next() throws -> Frame? {
    guard buffer.count >= 4 else { return nil }
    let length = Int(Wire.readU32BE(buffer, 0))
    guard length >= 1, length <= Wire.maxFrame else {
      throw ConnectFailure("ERR_CONNECT_PROTOCOL", "Frame length \(length) is not allowed")
    }
    guard buffer.count >= 4 + length else { return nil }
    let frame = Frame(type: buffer[4], body: Array(buffer[5..<(4 + length)]))
    buffer.removeFirst(4 + length)
    return frame
  }
}
