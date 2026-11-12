package expo.modules.coworkconnect

import android.content.Context
import android.net.Uri
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID

/**
 * File work for Connect transfers. Encrypted file format: a sequence of frames
 * `[u32 big-endian length][ciphertext + 16-byte tag]`, one frame per 64 KiB plaintext chunk,
 * frame i sealed with nonce counter i. Nothing here logs names, keys or contents.
 */
internal class ConnectFiles(private val context: Context) {
  class DecryptError(message: String) : Exception(message)

  data class Decrypted(val file: File, val size: Long, val sha256: String)

  /** files/connect: decrypted files the person keeps. */
  val filesRoot: File get() = File(context.filesDir, "connect")

  /** cache/connect: encrypted temp files (outgoing and incoming). */
  val cacheRoot: File get() = File(context.cacheDir, "connect")
  val incomingDir: File get() = File(cacheRoot, "incoming")
  val outgoingDir: File get() = File(cacheRoot, "outgoing")

  fun openInput(uri: String): InputStream {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      null, "" -> FileInputStream(File(uri))
      "file" -> FileInputStream(File(requireNotNull(parsed.path) { "Bad file uri" }))
      else -> context.contentResolver.openInputStream(parsed) ?: throw IOException("Cannot open file")
    }
  }

  fun sha256(uri: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    openInput(uri).use { input ->
      val buf = ByteArray(CHUNK)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        if (n > 0) digest.update(buf, 0, n)
      }
    }
    return hex(digest.digest())
  }

  /** Encrypts [uri] into a new temp file in cache/connect/outgoing and returns it. */
  fun encryptToTemp(uri: String, key: ByteArray): File {
    val dir = outgoingDir.apply { mkdirs() }
    val out = File(dir, UUID.randomUUID().toString() + ".enc")
    val aead = CounterAead(key)
    try {
      openInput(uri).use { raw ->
        BufferedOutputStream(FileOutputStream(out), CHUNK + 64).use { sink ->
          val buf = ByteArray(CHUNK)
          var counter = 0L
          while (true) {
            val n = readFully(raw, buf)
            if (n <= 0) break
            val sealed = aead.seal(counter++, buf, 0, n)
            writeU32(sink, sealed.size)
            sink.write(sealed)
            if (n < CHUNK) break
          }
        }
      }
      return out
    } catch (e: Throwable) {
      out.delete()
      throw e
    } finally {
      aead.wipe()
    }
  }

  /**
   * Stream-decrypts an incoming encrypted file into files/connect/<safe unique name>, verifying every
   * tag, then deletes the encrypted copy. On any failure nothing is left in files/connect and the
   * encrypted copy is kept (JS may delete it with deleteFile).
   */
  fun decrypt(path: String, key: ByteArray, fileName: String): Decrypted {
    val source = resolveInside(path, listOf(incomingDir)) ?: throw DecryptError("File is not a received Connect file")
    if (!source.isFile) throw DecryptError("Received file is missing")
    val dir = filesRoot.apply { mkdirs() }
    val partial = File(dir, ".partial-" + UUID.randomUUID().toString())
    val digest = MessageDigest.getInstance("SHA-256")
    val aead = CounterAead(key)
    var size = 0L
    try {
      DataInputStream(BufferedInputStream(FileInputStream(source), CHUNK + 64)).use { input ->
        FileOutputStream(partial).use { sink ->
          val frame = ByteArray(CHUNK + CounterAead.TAG_SIZE)
          var counter = 0L
          while (true) {
            val first = input.read()
            if (first < 0) break
            val len = (first shl 24) or (input.readUnsignedByte() shl 16) or (input.readUnsignedByte() shl 8) or input.readUnsignedByte()
            if (len < CounterAead.TAG_SIZE || len > frame.size) throw DecryptError("File is damaged")
            input.readFully(frame, 0, len)
            val plain = aead.open(counter++, frame, 0, len) ?: throw DecryptError("File failed the integrity check")
            digest.update(plain)
            sink.write(plain)
            size += plain.size
          }
          sink.fd.sync()
        }
      }
      val target = uniqueFile(dir, safeName(fileName))
      if (!partial.renameTo(target)) {
        partial.copyTo(target, overwrite = false)
        partial.delete()
      }
      source.delete()
      return Decrypted(target, size, hex(digest.digest()))
    } catch (e: EOFException) {
      partial.delete()
      throw DecryptError("File is incomplete")
    } catch (e: Throwable) {
      partial.delete()
      throw e
    } finally {
      aead.wipe()
    }
  }

  /** Deletes a file only when it is inside files/connect or cache/connect. Returns whether it was deleted. */
  fun delete(uri: String): Boolean {
    val file = resolveInside(uri, listOf(filesRoot, cacheRoot)) ?: throw SecurityException("Not a Connect file")
    return file.isFile && file.delete()
  }

  /** Copies [input] to cache/connect/incoming/<payloadId>.enc, replacing any old file there. */
  fun storeIncoming(payloadId: Long, input: InputStream): File {
    val dir = incomingDir.apply { mkdirs() }
    val target = File(dir, "$payloadId.enc")
    val tmp = File(dir, "$payloadId.enc.part")
    try {
      input.use { src -> FileOutputStream(tmp).use { src.copyTo(it, CHUNK) } }
      target.delete()
      if (!tmp.renameTo(target)) throw IOException("Cannot store received file")
      return target
    } catch (e: Throwable) {
      tmp.delete()
      throw e
    }
  }

  /** Moves an already accessible file into the incoming folder (old API levels). */
  fun moveIncoming(payloadId: Long, file: File): File {
    val dir = incomingDir.apply { mkdirs() }
    val target = File(dir, "$payloadId.enc")
    target.delete()
    if (file.renameTo(target)) return target
    val stored = storeIncoming(payloadId, FileInputStream(file))
    file.delete()
    return stored
  }

  /** Removes stale encrypted temp files (left by a crash). */
  fun cleanOutgoing() {
    outgoingDir.listFiles()?.forEach { it.delete() }
  }

  /** Accepts a path or a file:// uri and returns the canonical file when it lies inside one of [roots]. */
  private fun resolveInside(pathOrUri: String, roots: List<File>): File? {
    val parsed = Uri.parse(pathOrUri)
    val raw = when (parsed.scheme) {
      null, "" -> pathOrUri
      "file" -> parsed.path ?: return null
      else -> return null
    }
    val file = try {
      File(raw).canonicalFile
    } catch (e: IOException) {
      return null
    }
    for (root in roots) {
      val base = try {
        root.canonicalFile
      } catch (e: IOException) {
        continue
      }
      if (file.path.startsWith(base.path + File.separator)) return file
    }
    return null
  }

  companion object {
    const val CHUNK = 64 * 1024
    private const val MAX_NAME = 120

    fun hex(bytes: ByteArray): String {
      val chars = "0123456789abcdef"
      val sb = StringBuilder(bytes.size * 2)
      for (b in bytes) {
        val v = b.toInt() and 0xff
        sb.append(chars[v ushr 4]).append(chars[v and 0x0f])
      }
      return sb.toString()
    }

    /** Fills [buf] as far as the stream allows. Returns bytes read, 0 at end of stream. */
    fun readFully(input: InputStream, buf: ByteArray): Int {
      var total = 0
      while (total < buf.size) {
        val n = input.read(buf, total, buf.size - total)
        if (n < 0) break
        total += n
      }
      return total
    }

    fun writeU32(out: OutputStream, v: Int) {
      out.write(v ushr 24 and 0xff)
      out.write(v ushr 16 and 0xff)
      out.write(v ushr 8 and 0xff)
      out.write(v and 0xff)
    }

    /** A file name with no folders, no control or reserved characters and no leading dots. */
    fun safeName(name: String): String {
      val base = name.substringAfterLast('/').substringAfterLast('\\')
      val cleaned = buildString {
        for (ch in base) {
          val c = ch.code
          // Control characters, reserved characters, and bidi controls that could disguise an extension.
          val bad = c < 0x20 || c == 0x7f || ch in "<>:\"|?*" || c in 0x200e..0x200f || c in 0x202a..0x202e || c in 0x2066..0x2069
          if (bad) append('_') else append(ch)
        }
      }.trim().trimStart('.').trim()
      if (cleaned.isEmpty()) return "file"
      if (cleaned.length <= MAX_NAME) return cleaned
      val dot = cleaned.lastIndexOf('.')
      val ext = if (dot > 0 && cleaned.length - dot <= 16) cleaned.substring(dot) else ""
      return cleaned.substring(0, MAX_NAME - ext.length) + ext
    }

    fun uniqueFile(dir: File, name: String): File {
      var candidate = File(dir, name)
      if (!candidate.exists()) return candidate
      val dot = name.lastIndexOf('.')
      val stem = if (dot > 0) name.substring(0, dot) else name
      val ext = if (dot > 0) name.substring(dot) else ""
      var i = 1
      while (candidate.exists()) {
        candidate = File(dir, "$stem ($i)$ext")
        i++
      }
      return candidate
    }
  }
}
