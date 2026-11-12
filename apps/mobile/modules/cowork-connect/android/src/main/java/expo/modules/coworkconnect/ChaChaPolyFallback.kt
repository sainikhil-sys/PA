package expo.modules.coworkconnect

/**
 * Pure Kotlin ChaCha20-Poly1305 (RFC 8439), used only where the platform cipher is missing
 * (Android 7 to 8.1, API 24 to 27). Associated data is always empty, as in the Connect contract.
 * Output layout matches javax.crypto: ciphertext followed by the 16-byte tag.
 *
 * No Android imports on purpose, so it can be checked against the JDK cipher on a desktop JVM.
 */
internal object ChaChaPolyFallback {
  const val TAG_SIZE = 16

  fun seal(key: ByteArray, nonce: ByteArray, input: ByteArray, off: Int, len: Int): ByteArray {
    require(key.size == 32 && nonce.size == 12)
    val out = ByteArray(len + TAG_SIZE)
    xorKeyStream(key, nonce, input, off, len, out, 0)
    val tag = tag(key, nonce, out, 0, len)
    System.arraycopy(tag, 0, out, len, TAG_SIZE)
    return out
  }

  /** Returns the plaintext, or null when the tag does not match. */
  fun open(key: ByteArray, nonce: ByteArray, input: ByteArray, off: Int, len: Int): ByteArray? {
    require(key.size == 32 && nonce.size == 12)
    if (len < TAG_SIZE) return null
    val ctLen = len - TAG_SIZE
    val expected = tag(key, nonce, input, off, ctLen)
    var diff = 0
    for (i in 0 until TAG_SIZE) diff = diff or (expected[i].toInt() xor input[off + ctLen + i].toInt())
    if (diff != 0) return null
    val out = ByteArray(ctLen)
    xorKeyStream(key, nonce, input, off, ctLen, out, 0)
    return out
  }

  // region ChaCha20

  private fun le32(b: ByteArray, i: Int): Int =
    (b[i].toInt() and 0xff) or ((b[i + 1].toInt() and 0xff) shl 8) or
      ((b[i + 2].toInt() and 0xff) shl 16) or ((b[i + 3].toInt() and 0xff) shl 24)

  private fun initState(key: ByteArray, nonce: ByteArray): IntArray {
    val s = IntArray(16)
    s[0] = 0x61707865
    s[1] = 0x3320646e
    s[2] = 0x79622d32
    s[3] = 0x6b206574
    for (i in 0 until 8) s[4 + i] = le32(key, i * 4)
    s[12] = 0
    s[13] = le32(nonce, 0)
    s[14] = le32(nonce, 4)
    s[15] = le32(nonce, 8)
    return s
  }

  private fun block(state: IntArray, counter: Int, out: ByteArray) {
    val x = state.copyOf()
    x[12] = counter
    for (round in 0 until 10) {
      quarter(x, 0, 4, 8, 12)
      quarter(x, 1, 5, 9, 13)
      quarter(x, 2, 6, 10, 14)
      quarter(x, 3, 7, 11, 15)
      quarter(x, 0, 5, 10, 15)
      quarter(x, 1, 6, 11, 12)
      quarter(x, 2, 7, 8, 13)
      quarter(x, 3, 4, 9, 14)
    }
    for (i in 0 until 16) {
      val v = x[i] + (if (i == 12) counter else state[i])
      out[i * 4] = v.toByte()
      out[i * 4 + 1] = (v ushr 8).toByte()
      out[i * 4 + 2] = (v ushr 16).toByte()
      out[i * 4 + 3] = (v ushr 24).toByte()
    }
  }

  private fun quarter(x: IntArray, a: Int, b: Int, c: Int, d: Int) {
    x[a] += x[b]; x[d] = Integer.rotateLeft(x[d] xor x[a], 16)
    x[c] += x[d]; x[b] = Integer.rotateLeft(x[b] xor x[c], 12)
    x[a] += x[b]; x[d] = Integer.rotateLeft(x[d] xor x[a], 8)
    x[c] += x[d]; x[b] = Integer.rotateLeft(x[b] xor x[c], 7)
  }

  /** Encrypts or decrypts with block counter starting at 1 (block 0 makes the Poly1305 key). */
  private fun xorKeyStream(key: ByteArray, nonce: ByteArray, input: ByteArray, off: Int, len: Int, out: ByteArray, outOff: Int) {
    val state = initState(key, nonce)
    val ks = ByteArray(64)
    var done = 0
    var counter = 1
    while (done < len) {
      block(state, counter++, ks)
      val n = minOf(64, len - done)
      for (i in 0 until n) out[outOff + done + i] = (input[off + done + i].toInt() xor ks[i].toInt()).toByte()
      done += n
    }
  }

  // endregion

  // region Poly1305 (26-bit limbs, after poly1305-donna)

  private fun tag(key: ByteArray, nonce: ByteArray, ct: ByteArray, off: Int, len: Int): ByteArray {
    val block0 = ByteArray(64)
    block(initState(key, nonce), 0, block0)
    val mac = Poly1305(block0)
    // MAC input: AAD (empty) || ciphertext || zero pad to 16 || le64(aadLen = 0) || le64(ctLen).
    val full = len / 16 * 16
    var i = 0
    while (i < full) {
      mac.block(ct, off + i)
      i += 16
    }
    if (len > full) {
      val last = ByteArray(16)
      System.arraycopy(ct, off + full, last, 0, len - full)
      mac.block(last, 0)
    }
    val lengths = ByteArray(16)
    val ctLen = len.toLong()
    for (b in 0 until 8) lengths[8 + b] = (ctLen ushr (8 * b)).toByte()
    mac.block(lengths, 0)
    return mac.finish()
  }

  private class Poly1305(key: ByteArray) {
    private val r0: Long
    private val r1: Long
    private val r2: Long
    private val r3: Long
    private val r4: Long
    private val s1: Long
    private val s2: Long
    private val s3: Long
    private val s4: Long
    private val pad = LongArray(4)
    private var h0 = 0L
    private var h1 = 0L
    private var h2 = 0L
    private var h3 = 0L
    private var h4 = 0L

    init {
      r0 = u32(key, 0) and 0x3ffffff
      r1 = (u32(key, 3) ushr 2) and 0x3ffff03
      r2 = (u32(key, 6) ushr 4) and 0x3ffc0ff
      r3 = (u32(key, 9) ushr 6) and 0x3f03fff
      r4 = (u32(key, 12) ushr 8) and 0x00fffff
      s1 = r1 * 5
      s2 = r2 * 5
      s3 = r3 * 5
      s4 = r4 * 5
      for (i in 0 until 4) pad[i] = u32(key, 16 + i * 4)
    }

    /** One full 16-byte block (the AEAD construction only ever feeds full blocks). */
    fun block(m: ByteArray, o: Int) {
      h0 += u32(m, o) and 0x3ffffff
      h1 += (u32(m, o + 3) ushr 2) and 0x3ffffff
      h2 += (u32(m, o + 6) ushr 4) and 0x3ffffff
      h3 += (u32(m, o + 9) ushr 6) and 0x3ffffff
      h4 += (u32(m, o + 12) ushr 8) or (1L shl 24)

      val d0 = h0 * r0 + h1 * s4 + h2 * s3 + h3 * s2 + h4 * s1
      var d1 = h0 * r1 + h1 * r0 + h2 * s4 + h3 * s3 + h4 * s2
      var d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s4 + h4 * s3
      var d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s4
      var d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0

      var c = d0 ushr 26
      h0 = d0 and MASK
      d1 += c; c = d1 ushr 26; h1 = d1 and MASK
      d2 += c; c = d2 ushr 26; h2 = d2 and MASK
      d3 += c; c = d3 ushr 26; h3 = d3 and MASK
      d4 += c; c = d4 ushr 26; h4 = d4 and MASK
      h0 += c * 5; c = h0 ushr 26; h0 = h0 and MASK
      h1 += c
    }

    fun finish(): ByteArray {
      var c = h1 ushr 26; h1 = h1 and MASK
      h2 += c; c = h2 ushr 26; h2 = h2 and MASK
      h3 += c; c = h3 ushr 26; h3 = h3 and MASK
      h4 += c; c = h4 ushr 26; h4 = h4 and MASK
      h0 += c * 5; c = h0 ushr 26; h0 = h0 and MASK
      h1 += c

      // Compute h + -p and keep it when h >= p (constant time select).
      var g0 = h0 + 5; c = g0 ushr 26; g0 = g0 and MASK
      var g1 = h1 + c; c = g1 ushr 26; g1 = g1 and MASK
      var g2 = h2 + c; c = g2 ushr 26; g2 = g2 and MASK
      var g3 = h3 + c; c = g3 ushr 26; g3 = g3 and MASK
      val g4 = h4 + c - (1L shl 26)
      val keepH = g4 shr 63 // -1 when g4 < 0 (h < p), else 0
      val keepG = keepH.inv()
      h0 = (h0 and keepH) or (g0 and keepG)
      h1 = (h1 and keepH) or (g1 and keepG)
      h2 = (h2 and keepH) or (g2 and keepG)
      h3 = (h3 and keepH) or (g3 and keepG)
      h4 = (h4 and keepH) or (g4 and MASK and keepG)

      val w0 = (h0 or (h1 shl 26)) and 0xffffffffL
      val w1 = ((h1 ushr 6) or (h2 shl 20)) and 0xffffffffL
      val w2 = ((h2 ushr 12) or (h3 shl 14)) and 0xffffffffL
      val w3 = ((h3 ushr 18) or (h4 shl 8)) and 0xffffffffL

      val out = ByteArray(16)
      var f = w0 + pad[0]
      put32(out, 0, f)
      f = w1 + pad[1] + (f ushr 32)
      put32(out, 4, f)
      f = w2 + pad[2] + (f ushr 32)
      put32(out, 8, f)
      f = w3 + pad[3] + (f ushr 32)
      put32(out, 12, f)
      return out
    }

    private companion object {
      const val MASK = 0x3ffffffL

      fun u32(b: ByteArray, i: Int): Long =
        (b[i].toLong() and 0xff) or ((b[i + 1].toLong() and 0xff) shl 8) or
          ((b[i + 2].toLong() and 0xff) shl 16) or ((b[i + 3].toLong() and 0xff) shl 24)

      fun put32(b: ByteArray, i: Int, v: Long) {
        b[i] = v.toByte()
        b[i + 1] = (v ushr 8).toByte()
        b[i + 2] = (v ushr 16).toByte()
        b[i + 3] = (v ushr 24).toByte()
      }
    }
  }

  // endregion
}
