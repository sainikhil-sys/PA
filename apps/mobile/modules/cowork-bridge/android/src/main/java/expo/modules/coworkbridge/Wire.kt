package expo.modules.coworkbridge

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID

/** A peer broke the wire protocol. The link is closed; nothing more is read from it. */
internal class ProtocolException(message: String) : IOException(message)

/**
 * Cowork Bridge wire protocol. Mirrors modules/cowork-bridge/protocol.ts (the tested reference) byte
 * for byte. Every DATA payload is opaque: the Noise session above encrypts it.
 */
internal object Wire {
  const val HELLO = 1
  const val ACCEPT = 2
  const val REJECT = 3
  const val DATA = 4

  const val MAX_LAN_BODY = 64 * 1024
  const val MAX_LAN_DATA = MAX_LAN_BODY - 1
  const val MAX_BLE_DATA = 4 * 1024
  const val MAX_BLE_BODY = MAX_BLE_DATA + 1
  const val MAX_HELLO_BYTES = 200
  const val MAX_NAME_CHARS = 40
  const val MAX_ADV_NAME_BYTES = 24

  const val CHUNK_FIRST = 0x80
  const val CHUNK_LAST = 0x40
  private const val SEQ_MASK = 0x3f

  const val SERVICE_TYPE = "_coworkconnect._tcp"
  val BLE_SERVICE: UUID = UUID.fromString("6f3d0001-7c5e-4a8b-9a0e-6c6f776f726b")
  val BLE_RX: UUID = UUID.fromString("6f3d0002-7c5e-4a8b-9a0e-6c6f776f726b")
  val BLE_TX: UUID = UUID.fromString("6f3d0003-7c5e-4a8b-9a0e-6c6f776f726b")
  val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  /** Bluetooth SIG "reserved for testing" company id; the scan response carries the display name under it. */
  const val ADV_COMPANY_ID = 0xFFFF

  fun body(kind: Int, payload: ByteArray = ByteArray(0)): ByteArray {
    val out = ByteArray(1 + payload.size)
    out[0] = kind.toByte()
    payload.copyInto(out, 1)
    return out
  }

  fun hello(name: String): ByteArray = body(HELLO, truncateUtf8(cleanName(name), MAX_HELLO_BYTES))

  /** Validates a body and returns its kind. Throws ProtocolException on anything unexpected. */
  fun kindOf(b: ByteArray): Int {
    if (b.isEmpty()) throw ProtocolException("Empty body")
    val kind = b[0].toInt() and 0xff
    if (kind < HELLO || kind > DATA) throw ProtocolException("Unknown kind")
    if ((kind == ACCEPT || kind == REJECT) && b.size != 1) throw ProtocolException("Unexpected payload")
    if (kind == HELLO && b.size - 1 > MAX_HELLO_BYTES) throw ProtocolException("Name too long")
    return kind
  }

  fun payload(b: ByteArray): ByteArray = b.copyOfRange(1, b.size)

  fun nameFromHello(b: ByteArray): String = cleanName(String(b, 1, b.size - 1, Charsets.UTF_8))

  /** Trims, strips control characters, caps at MAX_NAME_CHARS code points; never empty. */
  fun cleanName(name: String): String {
    val stripped = name.filter { it.code >= 0x20 && it.code != 0x7f }.trim()
    val sb = StringBuilder()
    var count = 0
    var i = 0
    while (i < stripped.length && count < MAX_NAME_CHARS) {
      val cp = stripped.codePointAt(i)
      sb.appendCodePoint(cp)
      i += Character.charCount(cp)
      count++
    }
    return sb.toString().trim().ifEmpty { "Cowork user" }
  }

  /** UTF-8 bytes of `s`, cut to at most `maxBytes` without splitting a character. */
  fun truncateUtf8(s: String, maxBytes: Int): ByteArray {
    val out = ByteArrayOutputStream()
    var i = 0
    while (i < s.length) {
      val cp = s.codePointAt(i)
      val bytes = String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)
      if (out.size() + bytes.size > maxBytes) break
      out.write(bytes)
      i += Character.charCount(cp)
    }
    return out.toByteArray()
  }

  /** `[u32 big-endian length][body]`. */
  fun lanFrame(b: ByteArray): ByteArray {
    require(b.size in 1..MAX_LAN_BODY) { "Bad frame length" }
    val out = ByteArray(4 + b.size)
    out[0] = (b.size ushr 24).toByte()
    out[1] = (b.size ushr 16).toByte()
    out[2] = (b.size ushr 8).toByte()
    out[3] = b.size.toByte()
    b.copyInto(out, 4)
    return out
  }

  /** Splits a body into GATT chunks of at most `chunkSize` bytes each (header included). */
  fun bleChunks(b: ByteArray, chunkSize: Int): List<ByteArray> {
    require(b.size in 1..MAX_BLE_BODY) { "Bad body length" }
    require(chunkSize >= 2) { "Chunk size too small" }
    val room = chunkSize - 1
    val out = ArrayList<ByteArray>()
    var at = 0
    var seq = 0
    while (at < b.size) {
      val end = minOf(at + room, b.size)
      var header = seq and SEQ_MASK
      if (at == 0) header = header or CHUNK_FIRST
      if (end >= b.size) header = header or CHUNK_LAST
      val chunk = ByteArray(1 + end - at)
      chunk[0] = header.toByte()
      b.copyInto(chunk, 1, at, end)
      out.add(chunk)
      at = end
      seq++
    }
    return out
  }
}

/** Reassembles chunks for one direction of one link. Not thread-safe: use from one thread. */
internal class BleReassembler {
  private var buf: ByteArrayOutputStream? = null
  private var nextSeq = 0

  /** Returns a complete body, or null while more chunks are needed. Throws ProtocolException. */
  fun push(chunk: ByteArray): ByteArray? {
    if (chunk.size < 2) throw ProtocolException("Empty chunk")
    val header = chunk[0].toInt() and 0xff
    val seq = header and 0x3f
    if ((header and Wire.CHUNK_FIRST) != 0) {
      if (buf != null) throw ProtocolException("Body restarted")
      if (seq != 0) throw ProtocolException("Bad sequence")
      buf = ByteArrayOutputStream()
      nextSeq = 0
    } else if (buf == null) {
      throw ProtocolException("Chunk without a start")
    }
    if (seq != nextSeq) throw ProtocolException("Bad sequence")
    nextSeq = (nextSeq + 1) and 0x3f
    val b = buf!!
    if (b.size() + chunk.size - 1 > Wire.MAX_BLE_BODY) throw ProtocolException("Body too large")
    b.write(chunk, 1, chunk.size - 1)
    if ((header and Wire.CHUNK_LAST) == 0) return null
    buf = null
    return b.toByteArray()
  }
}
