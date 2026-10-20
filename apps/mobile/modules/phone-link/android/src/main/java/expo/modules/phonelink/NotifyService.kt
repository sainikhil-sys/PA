package expo.modules.phonelink

import android.app.Notification
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Receives the phone's notifications (once the person turns on Notification access) and forwards
 * them to Cowork in small batches. Calls, SMS and WhatsApp all arrive as notifications.
 * Never logs notification content or the device token.
 */
class NotifyService : NotificationListenerService() {
  private val io: ExecutorService = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val pending = ArrayList<JSONObject>()
  private var flushScheduled = false

  private val flush = Runnable { flushNow() }
  private val heartbeat = object : Runnable {
    override fun run() {
      flushNow() // empty batch = heartbeat (keeps "Connected" and battery fresh)
      main.postDelayed(this, HEARTBEAT_MS)
    }
  }

  override fun onListenerConnected() {
    main.removeCallbacks(heartbeat)
    main.post(heartbeat)
  }

  override fun onListenerDisconnected() {
    main.removeCallbacks(heartbeat)
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (!Link.linked(this) || sbn.packageName == packageName) return
    val n = sbn.notification ?: return
    val isCall = Notification.CATEGORY_CALL == n.category || "missed_call" == n.category
    // Skip group summaries and persistent "ongoing" items (music, downloads), except calls.
    if ((n.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
    if (!isCall && (sbn.isOngoing || (n.flags and Notification.FLAG_FOREGROUND_SERVICE) != 0)) return

    val x = n.extras ?: return
    val title = x.getCharSequence(Notification.EXTRA_TITLE)
    val text = x.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: x.getCharSequence(Notification.EXTRA_TEXT)
    if (title == null && text == null) return

    try {
      val e = JSONObject()
      e.put("key", clip(sbn.key, 300))
      e.put("package", sbn.packageName)
      e.put("appName", clip(appLabel(sbn.packageName), 80))
      n.category?.let { e.put("category", clip(it, 40)) }
      e.put("title", if (title == null) "" else clip(title.toString(), 400))
      e.put("text", if (text == null) "" else clip(text.toString(), 4000))
      e.put("postedAt", sbn.postTime)
      synchronized(pending) {
        pending.add(e)
        if (pending.size > MAX_PENDING) pending.removeAt(0)
      }
      if (!flushScheduled) {
        flushScheduled = true
        main.postDelayed(flush, FLUSH_DELAY_MS)
      }
    } catch (_: Exception) {
      // A malformed notification is skipped, never crashes the service.
    }
  }

  private fun flushNow() {
    flushScheduled = false
    val batch = JSONArray()
    synchronized(pending) {
      for (e in pending) batch.put(e)
      pending.clear()
    }
    val link = Link.get(this) ?: return
    if (io.isShutdown) return
    io.execute {
      try {
        val status = send(link, batch)
        if (status == 401) Link.clearIfToken(this, link.token) // unlinked from Cowork: stop sending
        else if (status >= 500 || status == 429) requeue(batch)
      } catch (_: Exception) {
        requeue(batch) // no network: try again with the next notification or heartbeat
      }
    }
  }

  private fun requeue(batch: JSONArray) {
    synchronized(pending) {
      var i = 0
      while (i < batch.length() && pending.size < MAX_PENDING) {
        batch.optJSONObject(i)?.let { pending.add(it) }
        i++
      }
    }
  }

  /** POSTs one batch (may be empty: then it is just a heartbeat with battery level). Blocking. */
  private fun send(link: Link.Value, events: JSONArray): Int {
    val req = JSONObject()
    req.put("events", events)
    val battery: Intent? = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    if (battery != null) {
      val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
      val plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
      if (level >= 0 && scale > 0) req.put("battery", (level * 100f / scale).roundToInt().coerceIn(0, 100))
      req.put("charging", plugged != 0)
    }

    val conn = URL(link.server + EVENTS_PATH).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 10_000
      conn.readTimeout = 15_000
      conn.doOutput = true
      conn.useCaches = false
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setRequestProperty("Authorization", "Bearer " + link.token)
      conn.outputStream.use { it.write(req.toString().toByteArray(Charsets.UTF_8)) }
      val status = conn.responseCode
      // Drain the body so the connection can be reused; its content is not needed.
      try {
        (if (status >= 400) conn.errorStream else conn.inputStream)?.use { it.readBytes() }
      } catch (_: IOException) {
      }
      return status
    } finally {
      conn.disconnect()
    }
  }

  private fun appLabel(pkg: String): String =
    try {
      val pm = packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    io.shutdown()
    super.onDestroy()
  }

  private companion object {
    const val FLUSH_DELAY_MS = 1500L
    const val HEARTBEAT_MS = 2 * 60 * 1000L
    const val MAX_PENDING = 50
    const val EVENTS_PATH = "/api/phone/events"

    fun clip(s: String, max: Int): String = if (s.length <= max) s else s.substring(0, max)
  }
}
