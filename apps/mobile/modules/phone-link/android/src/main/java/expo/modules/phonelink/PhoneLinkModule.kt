package expo.modules.phonelink

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridges the notification forwarder to JS: checks and opens Notification access, and stores the
 * device link (server URL and this phone's device token) where [NotifyService] reads it.
 */
class PhoneLinkModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  override fun definition() = ModuleDefinition {
    Name("PhoneLink")

    Function("isAccessGranted") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("openAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("setLink") { serverUrl: String, token: String ->
      val server = serverUrl.trim().trimEnd('/')
      if (!server.startsWith("https://") && !server.startsWith("http://")) {
        throw CodedException("ERR_PHONE_LINK_URL", "The server address must start with https://", null)
      }
      if (!TOKEN.matches(token)) {
        throw CodedException("ERR_PHONE_LINK_TOKEN", "The device token is not valid", null)
      }
      Link.save(context, server, token)
      requestRebind(context)
    }

    Function("clearLink") {
      Link.clear(context)
    }

    Function("isLinked") {
      Link.linked(context)
    }
  }

  /** Asks Android to (re)connect the listener so a fresh link starts forwarding without a restart. */
  private fun requestRebind(c: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    try {
      NotificationListenerService.requestRebind(ComponentName(c, NotifyService::class.java))
    } catch (_: Exception) {
      // Access is off or the listener is already bound: it picks the link up on the next heartbeat.
    }
  }

  private companion object {
    // Mirrors the Bearer token shape the server accepts (lib/phone-server.ts).
    val TOKEN = Regex("^[A-Za-z0-9_-]{30,200}$")
  }
}

/** The stored link, in private SharedPreferences. The token is sent only to the linked server. */
internal object Link {
  private const val PREFS = "cowork.phonelink"
  private const val KEY_SERVER = "server"
  private const val KEY_TOKEN = "token"

  data class Value(val server: String, val token: String)

  private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun get(c: Context): Value? {
    val p = prefs(c)
    val server = p.getString(KEY_SERVER, null) ?: return null
    val token = p.getString(KEY_TOKEN, null) ?: return null
    return Value(server, token)
  }

  fun linked(c: Context): Boolean = get(c) != null

  @Synchronized
  fun save(c: Context, server: String, token: String) {
    prefs(c).edit().putString(KEY_SERVER, server).putString(KEY_TOKEN, token).apply()
  }

  @Synchronized
  fun clear(c: Context) {
    prefs(c).edit().clear().apply()
  }

  /** Clears the link only if it is still the one the server rejected, so a newer link survives. */
  @Synchronized
  fun clearIfToken(c: Context, token: String) {
    if (prefs(c).getString(KEY_TOKEN, null) == token) prefs(c).edit().clear().apply()
  }
}
