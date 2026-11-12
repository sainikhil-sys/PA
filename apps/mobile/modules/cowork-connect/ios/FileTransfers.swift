// UNVERIFIED: written on Windows without a Swift compiler. Build and test on a Mac before shipping (ios/README.md).
//
// Files for Cowork Connect (NATIVE_CONTRACT.md, "Files (C2)").
//
// Encrypted file format, identical to Android so files can cross platforms later:
//   repeated records of [u32 big-endian length][ciphertext + 16-byte Poly1305 tag]
//   plaintext is read in 64 KiB chunks; chunk i is sealed with ChaCha20-Poly1305, the JS-chosen key,
//   nonce = 4 zero bytes + 8-byte little-endian i (i starts at 0), empty associated data.
//   An empty file has no records. The decrypter accepts any record size up to 1 MiB + 16.
//
// Transfer: the encrypted temp file is streamed to the peer as fileStart / fileChunk / fileEnd frames.
// The receiver writes it to Caches/connect/incoming/<payloadId>.enc and reports onFileReceived with that
// path. JS then calls decryptFile, which writes Documents/connect/<safe name> (through a hidden partial
// file, so a half-decrypted file is never visible) and deletes the encrypted copy. On a failed tag the
// encrypted copy is kept, as on Android; JS may delete it with deleteFile.
//
// Transfer state lives on the core queue. Encryption, decryption and hashing run on `work`.

import CryptoKit
import Foundation
import Network

final class FileTransfers {
  static let plainChunk = 64 * 1024
  static let maxRecord = 1024 * 1024 + 16
  static let maxIncomingSize: UInt64 = 8 * 1024 * 1024 * 1024
  private static let maxIncoming = 8
  private static let window = 4

  private final class Outgoing {
    let payloadId: UInt64
    let endpointId: String
    let url: URL
    let handle: FileHandle
    let total: Int64
    var sent: Int64 = 0
    var inFlight = 0
    var eof = false
    var finished = false
    var lastEmit: TimeInterval = 0

    init(payloadId: UInt64, endpointId: String, url: URL, handle: FileHandle, total: Int64) {
      self.payloadId = payloadId
      self.endpointId = endpointId
      self.url = url
      self.handle = handle
      self.total = total
    }
  }

  private final class Incoming {
    let payloadId: UInt64
    let endpointId: String
    let url: URL
    let handle: FileHandle
    let total: Int64
    var received: Int64 = 0
    var lastEmit: TimeInterval = 0

    init(payloadId: UInt64, endpointId: String, url: URL, handle: FileHandle, total: Int64) {
      self.payloadId = payloadId
      self.endpointId = endpointId
      self.url = url
      self.handle = handle
      self.total = total
    }
  }

  private unowned let core: ConnectCore
  private let work = DispatchQueue(label: "expo.modules.coworkconnect.files", qos: .userInitiated)
  private var outgoing: [UInt64: Outgoing] = [:]
  private var incoming: [UInt64: Incoming] = [:]

  init(core: ConnectCore) {
    self.core = core
  }

  // MARK: - JS calls

  func sha256File(uri: String, done: @escaping (Result<String, ConnectFailure>) -> Void) {
    work.async {
      guard let url = Paths.fileURL(uri) else {
        return done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Only file:// URIs are supported on iOS")))
      }
      do {
        done(.success(try Self.sha256(of: url)))
      } catch {
        done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Could not read the file: \(error.localizedDescription)")))
      }
    }
  }

  func sendFile(endpointId: String, uri: String, keyB64: String, done: @escaping (Result<String, ConnectFailure>) -> Void) {
    guard let key = Wire.key(keyB64) else { return done(.failure(.badKey)) }
    guard let source = Paths.fileURL(uri) else {
      return done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Only file:// URIs are supported on iOS")))
    }
    core.queue.async {
      guard self.core.isConnected(endpointId) else { return done(.failure(.notConnected)) }
      let payloadId = UInt64.random(in: 1...UInt64(Int64.max))
      self.work.async {
        let encrypted: URL
        do {
          let dir = try Paths.directory(Paths.outgoingDir)
          encrypted = dir.appendingPathComponent("\(payloadId).enc")
          try Self.encrypt(source, to: encrypted, key: key)
        } catch {
          return done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Could not prepare the file: \(error.localizedDescription)")))
        }
        self.core.queue.async {
          self.begin(payloadId: payloadId, endpointId: endpointId, url: encrypted, done: done)
        }
      }
    }
  }

  func cancelPayload(_ payloadIdText: String) {
    guard let payloadId = UInt64(payloadIdText) else { return }
    core.queue.async {
      if let o = self.outgoing[payloadId] {
        self.finish(o, status: "canceled", tellPeer: true)
      } else if let i = self.incoming[payloadId] {
        self.finish(i, status: "canceled", tellPeer: true)
      }
    }
  }

  func decryptFile(path: String, keyB64: String, fileName: String, done: @escaping (Result<[String: Any], ConnectFailure>) -> Void) {
    guard let key = Wire.key(keyB64) else { return done(.failure(.badKey)) }
    work.async {
      guard let source = Paths.fileURL(path), Paths.isInside(source, [Paths.incomingDir]) else {
        return done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Not a received Connect file")))
      }
      let partial: URL
      do {
        partial = try Paths.directory(Paths.receivedDir).appendingPathComponent(".partial-\(UUID().uuidString)")
      } catch {
        return done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Could not create the file: \(error.localizedDescription)")))
      }
      let result: (size: Int64, sha256: String)
      do {
        result = try Self.decrypt(source, to: partial, key: key)
      } catch {
        try? FileManager.default.removeItem(at: partial)
        return done(.failure(ConnectFailure("ERR_CONNECT_DECRYPT", "The file failed its integrity check (tampered, incomplete or wrong key)")))
      }
      do {
        let destination = try Paths.uniqueDestination(for: fileName)
        try FileManager.default.moveItem(at: partial, to: destination)
        try? FileManager.default.removeItem(at: source)
        done(.success(["uri": destination.absoluteString, "size": Double(result.size), "sha256": result.sha256]))
      } catch {
        try? FileManager.default.removeItem(at: partial)
        done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Could not save the file: \(error.localizedDescription)")))
      }
    }
  }

  /// Deletes a Connect file. Refuses anything outside Connect's own folders.
  @discardableResult
  static func deleteFile(uri: String) throws -> Bool {
    guard let url = Paths.fileURL(uri), Paths.isInside(url, [Paths.receivedDir, Paths.cacheRoot]) else {
      throw ConnectFailure("ERR_CONNECT_FILE", "Only Connect files can be deleted")
    }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else { return false }
    try FileManager.default.removeItem(at: url)
    return true
  }

  // MARK: - Sending (core queue)

  private func begin(payloadId: UInt64, endpointId: String, url: URL, done: (Result<String, ConnectFailure>) -> Void) {
    guard core.isConnected(endpointId) else {
      try? FileManager.default.removeItem(at: url)
      return done(.failure(.notConnected))
    }
    guard let handle = try? FileHandle(forReadingFrom: url),
          let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
    else {
      try? FileManager.default.removeItem(at: url)
      return done(.failure(ConnectFailure("ERR_CONNECT_FILE", "Could not open the encrypted file")))
    }
    let o = Outgoing(payloadId: payloadId, endpointId: endpointId, url: url, handle: handle, total: size)
    outgoing[payloadId] = o
    core.send(endpointId, .fileStart, Wire.u64be(payloadId) + Wire.u64be(UInt64(size)))
    done(.success(String(payloadId)))
    emitUpdate(endpointId: endpointId, payloadId: payloadId, incoming: false, transferred: 0, total: size, status: "in_progress")
    pump(o)
  }

  private func pump(_ o: Outgoing) {
    while !o.finished && !o.eof && o.inFlight < Self.window {
      let chunk: Data
      do {
        chunk = try o.handle.read(upToCount: Self.plainChunk) ?? Data()
      } catch {
        return finish(o, status: "failure", tellPeer: true)
      }
      if chunk.isEmpty {
        o.eof = true
        break
      }
      o.inFlight += 1
      let count = Int64(chunk.count)
      let queued = core.send(o.endpointId, .fileChunk, Wire.u64be(o.payloadId) + chunk) { [weak self, weak o] error in
        guard let self, let o, !o.finished else { return }
        o.inFlight -= 1
        if error != nil { return self.finish(o, status: "failure", tellPeer: false) }
        o.sent += count
        self.progress(o)
        self.pump(o)
      }
      if !queued { return finish(o, status: "failure", tellPeer: false) }
    }
    if o.eof && o.inFlight == 0 && !o.finished {
      // Success means every byte was handed to TCP. The receiver confirms the content with SHA-256 above this layer.
      core.send(o.endpointId, .fileEnd, Wire.u64be(o.payloadId))
      finish(o, status: "success", tellPeer: false)
    }
  }

  private func progress(_ o: Outgoing) {
    let now = ProcessInfo.processInfo.systemUptime
    guard now - o.lastEmit >= 0.25 else { return }
    o.lastEmit = now
    emitUpdate(endpointId: o.endpointId, payloadId: o.payloadId, incoming: false, transferred: o.sent, total: o.total, status: "in_progress")
  }

  private func finish(_ o: Outgoing, status: String, tellPeer: Bool) {
    guard !o.finished else { return }
    o.finished = true
    outgoing[o.payloadId] = nil
    try? o.handle.close()
    try? FileManager.default.removeItem(at: o.url)
    if tellPeer { core.send(o.endpointId, .fileCancel, Wire.u64be(o.payloadId)) }
    let transferred = status == "success" ? o.total : o.sent
    emitUpdate(endpointId: o.endpointId, payloadId: o.payloadId, incoming: false, transferred: transferred, total: o.total, status: status)
  }

  // MARK: - Receiving (core queue)

  func handle(from endpointId: String, _ type: FrameType, _ body: [UInt8]) {
    guard body.count >= 8 else { return }
    let payloadId = Wire.readU64BE(body, 0)
    switch type {
    case .fileStart:
      guard body.count == 16 else { return }
      let total = Wire.readU64BE(body, 8)
      guard incoming[payloadId] == nil, outgoing[payloadId] == nil, incoming.count < Self.maxIncoming, total <= Self.maxIncomingSize,
            let i = openIncoming(payloadId: payloadId, endpointId: endpointId, total: Int64(total))
      else {
        core.send(endpointId, .fileCancel, Wire.u64be(payloadId))
        return
      }
      incoming[payloadId] = i
      emitUpdate(endpointId: endpointId, payloadId: payloadId, incoming: true, transferred: 0, total: i.total, status: "in_progress")
    case .fileChunk:
      guard let i = incoming[payloadId], i.endpointId == endpointId else { return }
      let data = Data(body[8...])
      guard i.received + Int64(data.count) <= i.total else { return finish(i, status: "failure", tellPeer: true) }
      do {
        try i.handle.write(contentsOf: data)
      } catch {
        return finish(i, status: "failure", tellPeer: true)
      }
      i.received += Int64(data.count)
      let now = ProcessInfo.processInfo.systemUptime
      if now - i.lastEmit >= 0.25 {
        i.lastEmit = now
        emitUpdate(endpointId: endpointId, payloadId: payloadId, incoming: true, transferred: i.received, total: i.total, status: "in_progress")
      }
    case .fileEnd:
      guard let i = incoming[payloadId], i.endpointId == endpointId else { return }
      guard i.received == i.total else { return finish(i, status: "failure", tellPeer: false) }
      incoming[payloadId] = nil
      try? i.handle.close()
      // Path first, then success, so a JS handler on success already knows where the file is.
      core.emit("onFileReceived", ["endpointId": endpointId, "payloadId": String(payloadId), "path": i.url.path])
      emitUpdate(endpointId: endpointId, payloadId: payloadId, incoming: true, transferred: i.total, total: i.total, status: "success")
    case .fileCancel:
      if let o = outgoing[payloadId], o.endpointId == endpointId {
        finish(o, status: "canceled", tellPeer: false)
      } else if let i = incoming[payloadId], i.endpointId == endpointId {
        finish(i, status: "canceled", tellPeer: false)
      }
    default:
      break
    }
  }

  private func openIncoming(payloadId: UInt64, endpointId: String, total: Int64) -> Incoming? {
    guard let dir = try? Paths.directory(Paths.incomingDir) else { return nil }
    let url = dir.appendingPathComponent("\(payloadId).enc")
    guard FileManager.default.createFile(atPath: url.path, contents: nil),
          let handle = try? FileHandle(forWritingTo: url)
    else { return nil }
    return Incoming(payloadId: payloadId, endpointId: endpointId, url: url, handle: handle, total: total)
  }

  private func finish(_ i: Incoming, status: String, tellPeer: Bool) {
    guard incoming[i.payloadId] === i else { return }
    incoming[i.payloadId] = nil
    try? i.handle.close()
    try? FileManager.default.removeItem(at: i.url)
    if tellPeer { core.send(i.endpointId, .fileCancel, Wire.u64be(i.payloadId)) }
    emitUpdate(endpointId: i.endpointId, payloadId: i.payloadId, incoming: true, transferred: i.received, total: i.total, status: status)
  }

  /// A link closed: every transfer on it fails.
  func linkClosed(_ endpointId: String) {
    for o in outgoing.values where o.endpointId == endpointId {
      finish(o, status: "failure", tellPeer: false)
    }
    for i in incoming.values where i.endpointId == endpointId {
      finish(i, status: "failure", tellPeer: false)
    }
  }

  private func emitUpdate(endpointId: String, payloadId: UInt64, incoming: Bool, transferred: Int64, total: Int64, status: String) {
    core.emit("onTransferUpdate", [
      "endpointId": endpointId,
      "payloadId": String(payloadId),
      "incoming": incoming,
      "bytesTransferred": Double(transferred),
      "totalBytes": Double(total),
      "status": status,
    ])
  }

  // MARK: - Crypto and hashing (work queue)

  static func encrypt(_ source: URL, to destination: URL, key: SymmetricKey) throws {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
      throw ConnectFailure("ERR_CONNECT_FILE", "Could not create the encrypted file")
    }
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }
    var counter: UInt64 = 0
    var finished = false
    while !finished {
      try autoreleasepool {
        let chunk = try input.read(upToCount: plainChunk) ?? Data()
        if chunk.isEmpty {
          finished = true
          return
        }
        let sealed = try Wire.seal(chunk, key: key, counter: counter)
        counter += 1
        var record = Wire.u32be(UInt32(sealed.count))
        record.append(sealed)
        try output.write(contentsOf: record)
      }
    }
  }

  /// Returns the plaintext size and SHA-256 (hex). Throws on any failed tag or malformed record.
  static func decrypt(_ source: URL, to destination: URL, key: SymmetricKey) throws -> (Int64, String) {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
      throw ConnectFailure("ERR_CONNECT_FILE", "Could not create the file")
    }
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }
    var hasher = SHA256()
    var size: Int64 = 0
    var counter: UInt64 = 0
    var finished = false
    while !finished {
      try autoreleasepool {
        let header = try readExactly(input, 4)
        if header.isEmpty {
          finished = true
          return
        }
        guard header.count == 4 else { throw ConnectFailure("ERR_CONNECT_DECRYPT", "Truncated record header") }
        let length = Int(Wire.readU32BE(header, 0))
        guard length >= 16, length <= maxRecord else { throw ConnectFailure("ERR_CONNECT_DECRYPT", "Bad record length") }
        let record = try readExactly(input, length)
        guard record.count == length else { throw ConnectFailure("ERR_CONNECT_DECRYPT", "Truncated record") }
        let plain = try Wire.open(record, key: key, counter: counter)
        counter += 1
        hasher.update(data: plain)
        size += Int64(plain.count)
        try output.write(contentsOf: plain)
      }
    }
    return (size, Wire.hex(hasher.finalize()))
  }

  static func sha256(of url: URL) throws -> String {
    let input = try FileHandle(forReadingFrom: url)
    defer { try? input.close() }
    var hasher = SHA256()
    var finished = false
    while !finished {
      try autoreleasepool {
        let chunk = try input.read(upToCount: plainChunk) ?? Data()
        if chunk.isEmpty {
          finished = true
        } else {
          hasher.update(data: chunk)
        }
      }
    }
    return Wire.hex(hasher.finalize())
  }

  /// Reads `count` bytes, fewer only at end of file.
  private static func readExactly(_ handle: FileHandle, _ count: Int) throws -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(count)
    while out.count < count {
      guard let data = try handle.read(upToCount: count - out.count), !data.isEmpty else { break }
      out.append(contentsOf: data)
    }
    return out
  }
}

/// Where Connect keeps its files.
enum Paths {
  /// Decrypted files (the Android equivalent is files/connect). Excluded from iCloud backup.
  static var receivedDir: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("connect", isDirectory: true)
  }

  /// Encrypted temp files, outgoing and incoming (the Android equivalent is cache/connect).
  static var cacheRoot: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("connect", isDirectory: true)
  }

  static var incomingDir: URL { cacheRoot.appendingPathComponent("incoming", isDirectory: true) }
  static var outgoingDir: URL { cacheRoot.appendingPathComponent("outgoing", isDirectory: true) }

  static func directory(_ url: URL) throws -> URL {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  /// Accepts file:// URIs and absolute paths.
  static func fileURL(_ text: String) -> URL? {
    if text.hasPrefix("file://") {
      guard let url = URL(string: text), url.isFileURL else { return nil }
      return url
    }
    if text.hasPrefix("/") {
      return URL(fileURLWithPath: text)
    }
    return nil
  }

  static func isInside(_ url: URL, _ roots: [URL]) -> Bool {
    let path = url.standardizedFileURL.resolvingSymlinksInPath().path
    return roots.contains { root in
      path.hasPrefix(root.standardizedFileURL.resolvingSymlinksInPath().path + "/")
    }
  }

  static func uniqueDestination(for fileName: String) throws -> URL {
    var dir = try directory(receivedDir)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)
    let safe = safeName(fileName)
    let base = (safe as NSString).deletingPathExtension
    let ext = (safe as NSString).pathExtension
    var candidate = dir.appendingPathComponent(safe)
    var n = 1
    while FileManager.default.fileExists(atPath: candidate.path) {
      let name = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
      candidate = dir.appendingPathComponent(name)
      n += 1
    }
    return candidate
  }

  /// The same rules as Android's safeName: no folders, no control, reserved or bidi control characters
  /// (they can disguise an extension), no leading dots, at most 120 characters with the extension kept.
  static func safeName(_ name: String) -> String {
    let base = name.split(separator: "/").last.map(String.init) ?? ""
    let last = base.split(separator: "\\").last.map(String.init) ?? ""
    var cleaned = ""
    for scalar in last.unicodeScalars {
      let v = scalar.value
      let bad = v < 0x20 || v == 0x7f || "<>:\"|?*".unicodeScalars.contains(scalar)
        || (0x200e...0x200f).contains(v) || (0x202a...0x202e).contains(v) || (0x2066...0x2069).contains(v)
      cleaned.unicodeScalars.append(bad ? "_" : scalar)
    }
    cleaned = cleaned.trimmingCharacters(in: .whitespaces)
    while cleaned.hasPrefix(".") { cleaned.removeFirst() }
    cleaned = cleaned.trimmingCharacters(in: .whitespaces)
    if cleaned.isEmpty { return "file" }
    if cleaned.count <= 120 { return cleaned }
    var ext = ""
    if let dot = cleaned.lastIndex(of: "."), dot > cleaned.startIndex, cleaned.distance(from: dot, to: cleaned.endIndex) <= 16 {
      ext = String(cleaned[dot...])
    }
    return String(cleaned.prefix(120 - ext.count)) + ext
  }
}
