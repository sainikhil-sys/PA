package expo.modules.coworkconnect

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.Payload
import java.io.DataInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Walkie and call audio over Nearby STREAM payloads.
 *
 * PCM 16-bit mono 16 kHz in 20 ms frames (640 bytes). Each frame is sealed with this phone's send key
 * and a counter nonce, then written as `[u16 big-endian length of ciphertext][u64 little-endian counter][ciphertext]`
 * to one stream per listener. The same sealed frame goes to every listener (one counter, one key, so no
 * nonce is ever reused). Receivers keep one AudioTrack per sender and drop frames whose counter is not
 * greater than the last one played.
 *
 * The microphone is only opened while [transmit] is on. Nothing here logs audio or keys.
 */
internal class ConnectAudio(
  private val context: Context,
  private val client: () -> ConnectionsClient,
  private val emit: (String, Map<String, Any?>) -> Unit,
) {
  private val lock = Any()
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  @Volatile private var session: Session? = null

  /** Incoming streams by payload id. They may arrive before the session starts; frames without a key are dropped. */
  private val receivers = ConcurrentHashMap<Long, Receiver>()

  val isActive: Boolean get() = session != null

  // region Public API (called from the module)

  fun start(sendKey: ByteArray, peers: List<Pair<String, ByteArray>>, mode: String) {
    synchronized(lock) {
      if (session != null) stopLocked(emitIdle = false)
      val s = Session(sendKey.copyOf(), if (mode == "call") "call" else "walkie")
      session = s
      try {
        s.previousMode = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        requestFocus(s)
        // Walkie defaults to the loudspeaker, calls to the earpiece (or a connected headset).
        setSpeakerLocked(s.mode == "walkie")
        for ((endpointId, key) in peers) addPeerLocked(s, endpointId, key)
        s.ticker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "connect-audio-levels") }.also {
          it.scheduleWithFixedDelay({ tickLevels() }, LEVEL_MS, LEVEL_MS, TimeUnit.MILLISECONDS)
        }
      } catch (e: Exception) {
        stopLocked(emitIdle = false)
        emit("onAudioState", mapOf("state" to "error", "message" to "Audio could not start"))
        throw e
      }
    }
    emit("onAudioState", mapOf("state" to "active"))
  }

  fun addPeer(endpointId: String, recvKey: ByteArray) {
    synchronized(lock) {
      val s = session ?: return
      addPeerLocked(s, endpointId, recvKey)
    }
  }

  fun removePeer(endpointId: String) {
    synchronized(lock) {
      val s = session ?: return
      s.peers.remove(endpointId)?.release()
      s.senders.remove(endpointId)?.close()
      // Close incoming streams from that person too.
      for ((id, r) in receivers) if (r.endpointId == endpointId) {
        receivers.remove(id)
        r.close()
      }
    }
  }

  /** Push to talk (walkie) or mic on (call). Returns false when RECORD_AUDIO is not granted. */
  fun transmit(on: Boolean): Boolean {
    synchronized(lock) {
      val s = session ?: throw IllegalStateException("Audio is not active")
      if (!on) {
        stopCapture(s)
        return true
      }
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        emit("onAudioState", mapOf("state" to "error", "message" to "Microphone permission is off"))
        return false
      }
      // Reopen streams that broke (for example the listener restarted audio).
      for ((endpointId, sender) in s.senders) if (sender.dead) {
        sender.close()
        s.senders[endpointId] = Sender(endpointId)
      }
      if (s.capture == null) {
        s.capture = Capture(s).also { it.start() }
      }
      return true
    }
  }

  fun setMuted(muted: Boolean) {
    session?.muted = muted
  }

  fun setSpeaker(on: Boolean) {
    synchronized(lock) {
      if (session == null) return
      setSpeakerLocked(on)
    }
  }

  fun stop() {
    val wasActive: Boolean
    synchronized(lock) {
      wasActive = session != null
      stopLocked(emitIdle = false)
    }
    if (wasActive) emit("onAudioState", mapOf("state" to "idle"))
  }

  /** Called by the module for every incoming STREAM payload. */
  fun onIncomingStream(endpointId: String, payload: Payload) {
    val stream = payload.asStream() ?: return
    if (receivers.size >= MAX_RECEIVERS) {
      // One stream per sender is normal; this only guards against a peer opening streams in a loop.
      client().cancelPayload(payload.id)
      runCatching { payload.close() }
      return
    }
    val receiver = Receiver(endpointId, payload.id, stream.asInputStream(), payload)
    receivers[payload.id] = receiver
    receiver.start()
  }

  /** A stream payload ended (success, failure or cancel) on the Nearby side. */
  fun onStreamFinished(payloadId: Long) {
    receivers.remove(payloadId)?.close(cancel = false)
    val s = session ?: return
    for (sender in s.senders.values) if (sender.payloadId == payloadId) sender.dead = true
  }

  fun isStreamPayload(payloadId: Long): Boolean {
    if (receivers.containsKey(payloadId)) return true
    val s = session ?: return false
    return s.senders.values.any { it.payloadId == payloadId }
  }

  /** The endpoint disconnected: drop its streams but keep the session for the others. */
  fun onEndpointGone(endpointId: String) {
    synchronized(lock) {
      for ((id, r) in receivers) if (r.endpointId == endpointId) {
        receivers.remove(id)
        r.close(cancel = false)
      }
      val s = session ?: return
      s.senders[endpointId]?.dead = true
      s.peers[endpointId]?.releaseTrack()
    }
  }

  // endregion

  // region Session internals

  private class Session(val sendKey: ByteArray, val mode: String) {
    val peers = ConcurrentHashMap<String, Peer>()
    val senders = ConcurrentHashMap<String, Sender>()
    val sendCounter = AtomicLong(0)
    @Volatile var muted = false
    @Volatile var capture: Capture? = null
    @Volatile var selfLevel = 0f
    var lastSelfEmitted = 0f
    var previousMode = AudioManager.MODE_NORMAL
    var focusRequest: Any? = null
    var ticker: ScheduledExecutorService? = null
  }

  private fun addPeerLocked(s: Session, endpointId: String, recvKey: ByteArray) {
    s.peers.remove(endpointId)?.release()
    s.peers[endpointId] = Peer(endpointId, CounterAead(recvKey))
    if (s.senders[endpointId]?.dead != false) {
      s.senders.remove(endpointId)?.close()
      s.senders[endpointId] = Sender(endpointId)
    }
  }

  private fun stopLocked(emitIdle: Boolean) {
    val s = session ?: return
    session = null
    s.ticker?.shutdownNow()
    stopCapture(s)
    for (sender in s.senders.values) sender.close()
    s.senders.clear()
    for (r in receivers.values) r.close()
    receivers.clear()
    for (peer in s.peers.values) peer.release()
    s.peers.clear()
    s.sendKey.fill(0)
    restoreAudio(s)
    if (emitIdle) emit("onAudioState", mapOf("state" to "idle"))
  }

  private fun stopCapture(s: Session) {
    val c = s.capture ?: return
    s.capture = null
    c.shutdown()
    s.selfLevel = 0f
  }

  private fun requestFocus(s: Session) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(VOICE_ATTRIBUTES)
        .setOnAudioFocusChangeListener { }
        .build()
      audioManager.requestAudioFocus(request)
      s.focusRequest = request
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun restoreAudio(s: Session) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        audioManager.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = false
      }
      audioManager.mode = s.previousMode
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        (s.focusRequest as? AudioFocusRequest)?.let { audioManager.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        audioManager.abandonAudioFocus(null)
      }
    } catch (e: RuntimeException) {
      Log.w(TAG, "Audio routing could not be restored")
    }
  }

  private fun setSpeakerLocked(on: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (on) {
        val speaker = audioManager.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        if (speaker != null) audioManager.setCommunicationDevice(speaker)
      } else {
        audioManager.clearCommunicationDevice()
      }
    } else {
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = on
    }
  }

  private fun tickLevels() {
    val s = session ?: return
    val self = if (s.capture != null && !s.muted) s.selfLevel else 0f
    s.selfLevel = 0f
    if (self > 0f || s.lastSelfEmitted > 0f) {
      emit("onAudioLevel", mapOf("endpointId" to "self", "level" to self.toDouble()))
      s.lastSelfEmitted = self
    }
    for (peer in s.peers.values) {
      val level = peer.takeLevel()
      if (level > 0f || peer.lastEmitted > 0f) {
        emit("onAudioLevel", mapOf("endpointId" to peer.endpointId, "level" to level.toDouble()))
        peer.lastEmitted = level
      }
    }
  }

  // endregion

  // region Capture (mic -> sealed frames -> every listener)

  private inner class Capture(private val s: Session) : Thread("connect-audio-capture") {
    @Volatile private var running = true

    fun shutdown() {
      running = false
      interrupt()
      try {
        join(300) // A read returns within one 20 ms frame, so this is quick.
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }

    @SuppressLint("MissingPermission") // Checked in transmit() before this thread starts.
    override fun run() {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
      val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      if (minBuf <= 0) {
        fail("Microphone is not available")
        return
      }
      val record = try {
        AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, FRAME_BYTES * 10))
      } catch (e: RuntimeException) {
        fail("Microphone is not available")
        return
      }
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        fail("Microphone is busy")
        return
      }
      val aec = if (AcousticEchoCanceler.isAvailable()) runCatching { AcousticEchoCanceler.create(record.audioSessionId) }.getOrNull() else null
      val ns = if (NoiseSuppressor.isAvailable()) runCatching { NoiseSuppressor.create(record.audioSessionId) }.getOrNull() else null
      runCatching { aec?.enabled = true }
      runCatching { ns?.enabled = true }
      val aead = CounterAead(s.sendKey)
      val pcm = ByteArray(FRAME_BYTES)
      try {
        record.startRecording()
        while (running) {
          var filled = 0
          while (filled < FRAME_BYTES && running) {
            val n = record.read(pcm, filled, FRAME_BYTES - filled)
            if (n < 0) throw IOException("Microphone read failed")
            filled += n
          }
          if (!running) break
          if (s.muted) continue
          s.selfLevel = maxOf(s.selfLevel, level(pcm, FRAME_BYTES))
          val counter = s.sendCounter.getAndIncrement()
          val sealed = aead.seal(counter, pcm, 0, FRAME_BYTES)
          val frame = ByteArray(2 + 8 + sealed.size)
          frame[0] = (sealed.size ushr 8).toByte()
          frame[1] = sealed.size.toByte()
          for (i in 0 until 8) frame[2 + i] = (counter ushr (8 * i)).toByte()
          System.arraycopy(sealed, 0, frame, 10, sealed.size)
          for (sender in s.senders.values) sender.offer(frame)
        }
      } catch (e: Exception) {
        if (running) fail("Microphone stopped")
      } finally {
        pcm.fill(0)
        aead.wipe()
        runCatching { record.stop() }
        record.release()
        aec?.release()
        ns?.release()
      }
    }

    private fun fail(message: String) {
      running = false
      if (session === s) {
        s.capture = null
        emit("onAudioState", mapOf("state" to "error", "message" to message))
      }
    }
  }

  // endregion

  // region Sender (one Nearby STREAM payload per listener)

  private inner class Sender(val endpointId: String) {
    private val queue = ArrayBlockingQueue<ByteArray>(SEND_QUEUE)
    private val readSide: ParcelFileDescriptor
    private val out: OutputStream
    val payloadId: Long
    @Volatile var dead = false
    private val thread: Thread

    init {
      val pipe = ParcelFileDescriptor.createPipe()
      readSide = pipe[0]
      out = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])
      val payload = Payload.fromStream(readSide)
      payloadId = payload.id
      client().sendPayload(endpointId, payload).addOnFailureListener { dead = true }
      thread = Thread({ pump() }, "connect-audio-send").apply { start() }
    }

    fun offer(frame: ByteArray) {
      if (dead) return
      // Drop the oldest frame rather than build delay when the link is slow.
      while (!queue.offer(frame)) queue.poll()
    }

    private fun pump() {
      try {
        while (!dead) {
          val frame = queue.poll(200, TimeUnit.MILLISECONDS) ?: continue
          out.write(frame)
          out.flush()
        }
      } catch (e: IOException) {
        dead = true
      } catch (e: InterruptedException) {
        dead = true
      }
    }

    fun close() {
      dead = true
      thread.interrupt()
      queue.clear()
      runCatching { out.close() }
      runCatching { readSide.close() }
      client().cancelPayload(payloadId)
    }
  }

  // endregion

  // region Receiver (one thread per incoming stream) and playback

  private inner class Receiver(
    val endpointId: String,
    private val payloadId: Long,
    private val input: InputStream,
    private val payload: Payload,
  ) : Thread("connect-audio-recv") {
    @Volatile private var closed = false

    fun close(cancel: Boolean = true) {
      if (closed) return
      closed = true
      if (cancel) client().cancelPayload(payloadId)
      runCatching { input.close() }
      runCatching { payload.close() }
    }

    override fun run() {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
      val data = DataInputStream(input)
      val buf = ByteArray(MAX_FRAME_CT)
      val counterBytes = ByteArray(8)
      try {
        while (!closed) {
          val len = data.readUnsignedShort()
          data.readFully(counterBytes)
          var counter = 0L
          for (i in 0 until 8) counter = counter or ((counterBytes[i].toLong() and 0xff) shl (8 * i))
          if (len < CounterAead.TAG_SIZE || len > MAX_FRAME_CT) break // Not our format: stop reading.
          data.readFully(buf, 0, len)
          val peer = session?.peers?.get(endpointId) ?: continue
          peer.receive(counter, buf, len)
        }
      } catch (e: IOException) {
        // Stream ended or was canceled.
      } finally {
        receivers.remove(payloadId, this)
        close(cancel = false)
      }
    }
  }

  private inner class Peer(val endpointId: String, private val aead: CounterAead) {
    private var lastCounter = -1L
    private var track: AudioTrack? = null
    private var lastFrameAt = 0L
    private var released = false
    @Volatile private var level = 0f
    var lastEmitted = 0f

    @Synchronized
    fun receive(counter: Long, buf: ByteArray, len: Int) {
      if (released || counter <= lastCounter) return
      val pcm = aead.open(counter, buf, 0, len) ?: return // Failed tag: drop the frame.
      lastCounter = counter
      level = maxOf(level, level(pcm, pcm.size))
      val t = track ?: createTrack()?.also { track = it } ?: return
      val now = SystemClock.elapsedRealtime()
      if (now - lastFrameAt > GAP_MS) {
        // Start of a talk spurt: a short cushion of silence absorbs network jitter.
        t.write(SILENCE, 0, SILENCE.size, AudioTrack.WRITE_NON_BLOCKING)
      }
      lastFrameAt = now
      // Non-blocking: when the buffer is full the frame is dropped, which caps latency.
      t.write(pcm, 0, pcm.size, AudioTrack.WRITE_NON_BLOCKING)
      pcm.fill(0)
    }

    fun takeLevel(): Float {
      val l = level
      level = 0f
      return l
    }

    private fun createTrack(): AudioTrack? {
      val minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      if (minBuf <= 0) return null
      return try {
        val t = AudioTrack.Builder()
          .setAudioAttributes(VOICE_ATTRIBUTES)
          .setAudioFormat(
            AudioFormat.Builder()
              .setSampleRate(SAMPLE_RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .build(),
          )
          .setTransferMode(AudioTrack.MODE_STREAM)
          .setBufferSizeInBytes(maxOf(minBuf, FRAME_BYTES * TRACK_FRAMES))
          .build()
        if (t.state != AudioTrack.STATE_INITIALIZED) {
          t.release()
          null
        } else {
          t.play()
          t
        }
      } catch (e: RuntimeException) {
        null
      }
    }

    @Synchronized
    fun releaseTrack() {
      track?.let {
        runCatching { it.pause() }
        runCatching { it.flush() }
        it.release()
      }
      track = null
      lastFrameAt = 0L
    }

    @Synchronized
    fun release() {
      released = true
      releaseTrack()
      aead.wipe()
    }
  }

  // endregion

  private companion object {
    const val TAG = "CoworkConnectAudio"
    const val SAMPLE_RATE = 16_000
    const val FRAME_BYTES = 640 // 20 ms of 16-bit mono at 16 kHz
    const val MAX_FRAME_CT = 4096
    const val MAX_RECEIVERS = 16
    const val SEND_QUEUE = 25 // 500 ms
    const val TRACK_FRAMES = 8 // 160 ms playback buffer cap
    const val GAP_MS = 300L
    const val LEVEL_MS = 100L
    val SILENCE = ByteArray(FRAME_BYTES * 3) // 60 ms

    val VOICE_ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()

    /** 0..1 loudness of 16-bit little-endian PCM, on a 50 dB scale. */
    fun level(pcm: ByteArray, len: Int): Float {
      var sum = 0.0
      val samples = len / 2
      if (samples == 0) return 0f
      for (i in 0 until samples) {
        val v = ((pcm[i * 2 + 1].toInt() shl 8) or (pcm[i * 2].toInt() and 0xff)).toShort().toDouble()
        sum += v * v
      }
      val rms = sqrt(sum / samples)
      if (rms < 1.0) return 0f
      val db = 20 * log10(rms / 32768.0)
      return ((db + 50.0) / 50.0).coerceIn(0.0, 1.0).toFloat()
    }
  }
}
