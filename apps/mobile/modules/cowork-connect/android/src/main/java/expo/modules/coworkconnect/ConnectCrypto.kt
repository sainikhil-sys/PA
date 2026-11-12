package expo.modules.coworkconnect

import android.os.Build
import android.util.Base64
import java.security.GeneralSecurityException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * ChaCha20-Poly1305 with one key and a counter nonce (4 zero bytes + 8-byte little-endian counter),
 * empty associated data. Keys always come from JavaScript; this class never makes one.
 *
 * Android 9+ (API 28) uses the platform cipher (Conscrypt). Older versions use [ChaChaPolyFallback].
 * Not thread safe: give each thread its own instance.
 */
internal class CounterAead(key: ByteArray) {
  init {
    require(key.size == KEY_SIZE) { "Key must be 32 bytes" }
  }

  private val key = key.copyOf()
  private val keySpec = SecretKeySpec(this.key, "ChaCha20")
  private val platform: Cipher? = platformCipher()
  private val nonce = ByteArray(NONCE_SIZE)

  fun seal(counter: Long, input: ByteArray, off: Int, len: Int): ByteArray {
    setNonce(counter)
    val cipher = platform ?: return ChaChaPolyFallback.seal(key, nonce, input, off, len)
    cipher.init(Cipher.ENCRYPT_MODE, keySpec, IvParameterSpec(nonce))
    return cipher.doFinal(input, off, len)
  }

  /** Plaintext, or null when the tag does not verify. */
  fun open(counter: Long, input: ByteArray, off: Int, len: Int): ByteArray? {
    if (len < TAG_SIZE) return null
    setNonce(counter)
    val cipher = platform ?: return ChaChaPolyFallback.open(key, nonce, input, off, len)
    return try {
      cipher.init(Cipher.DECRYPT_MODE, keySpec, IvParameterSpec(nonce))
      cipher.doFinal(input, off, len)
    } catch (e: AEADBadTagException) {
      null
    }
  }

  /** Overwrites the key copy. The instance must not be used afterwards. */
  fun wipe() {
    key.fill(0)
  }

  private fun setNonce(counter: Long) {
    for (i in 0 until 4) nonce[i] = 0
    for (i in 0 until 8) nonce[4 + i] = (counter ushr (8 * i)).toByte()
  }

  companion object {
    const val KEY_SIZE = 32
    const val NONCE_SIZE = 12
    const val TAG_SIZE = 16

    private fun platformCipher(): Cipher? {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
      return try {
        Cipher.getInstance("ChaCha20/Poly1305/NoPadding")
      } catch (e: GeneralSecurityException) {
        null
      }
    }

    /** Decodes a base64 key from JS. Throws IllegalArgumentException when it is not 32 bytes. */
    fun decodeKey(b64: String): ByteArray {
      val bytes = Base64.decode(b64, Base64.NO_WRAP)
      require(bytes.size == KEY_SIZE) { "Key must be 32 bytes" }
      return bytes
    }
  }
}
