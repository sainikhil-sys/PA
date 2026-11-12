package expo.modules.coworkconnect

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps Walkie and calls running with the screen off. Always shows an ongoing notification.
 * Type connectedDevice always, plus microphone when RECORD_AUDIO is granted (Android 11+).
 */
class ConnectService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE)?.take(80).orEmpty().ifEmpty { "Cowork Connect" }
    val body = intent?.getStringExtra(EXTRA_BODY)?.take(160).orEmpty()
    val notification = ConnectNotifications.serviceNotification(this, title, body)

    var type = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    val micGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    // Both kinds ("walkie" and "call") carry audio.
    val withMic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && micGranted
    try {
      ServiceCompat.startForeground(this, ConnectNotifications.SERVICE_ID, notification, if (withMic) type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else type)
    } catch (e: RuntimeException) {
      // The microphone type is refused when the app is not in the foreground (Android 14+). Keep the link alive without it.
      try {
        ServiceCompat.startForeground(this, ConnectNotifications.SERVICE_ID, notification, type)
      } catch (e2: RuntimeException) {
        Log.w(TAG, "Foreground service could not start")
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val TAG = "CoworkConnectService"
    const val EXTRA_KIND = "kind"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
  }
}

/** Decline taps on the incoming call notification. Not exported: only our own PendingIntent reaches it. */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val callId = intent.getStringExtra(ConnectNotifications.EXTRA_CALL_ID) ?: return
    val action = intent.getStringExtra(ConnectNotifications.EXTRA_CALL_ACTION) ?: return
    if (action != "accept" && action != "decline") return
    ConnectNotifications.clearIncomingCall(context, callId)
    CallActionBus.dispatch(callId, action)
  }
}

/** Hands notification actions to the live module, if there is one. */
internal object CallActionBus {
  @Volatile var listener: ((callId: String, action: String) -> Unit)? = null

  fun dispatch(callId: String, action: String) {
    listener?.invoke(callId, action)
  }
}

internal object ConnectNotifications {
  const val SERVICE_CHANNEL = "cowork_connect_active"
  const val CALL_CHANNEL = "cowork_connect_calls"
  const val SERVICE_ID = 0x0C0C
  private const val CALL_ID = 0x0C0D
  private const val CALL_TAG_PREFIX = "cowork-connect-call:"
  const val EXTRA_CALL_ID = "expo.modules.coworkconnect.CALL_ID"
  const val EXTRA_CALL_ACTION = "expo.modules.coworkconnect.CALL_ACTION"
  private const val CALL_TIMEOUT_MS = 60_000L

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(SERVICE_CHANNEL) == null) {
      val channel = NotificationChannel(SERVICE_CHANNEL, "Connect activity", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shown while Walkie or a call runs nearby"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    if (manager.getNotificationChannel(CALL_CHANNEL) == null) {
      val channel = NotificationChannel(CALL_CHANNEL, "Connect calls", NotificationManager.IMPORTANCE_HIGH)
      channel.description = "Incoming calls from people nearby"
      manager.createNotificationChannel(channel)
    }
  }

  fun serviceNotification(context: Context, title: String, body: String): Notification {
    ensureChannels(context)
    val builder = NotificationCompat.Builder(context, SERVICE_CHANNEL)
      .setSmallIcon(R.drawable.cowork_connect_notification)
      .setContentTitle(title)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    if (body.isNotEmpty()) builder.setContentText(body)
    openAppIntent(context, 0, null, null)?.let { builder.setContentIntent(it) }
    return builder.build()
  }

  /** Returns false when notifications are off or not permitted, so JS can show the call in the app instead. */
  fun showIncomingCall(context: Context, callId: String, name: String): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    ensureChannels(context)
    val code = callId.hashCode() and 0x0fffffff
    val accept = openAppIntent(context, code * 4 + 1, callId, "accept")
    val decline = PendingIntent.getBroadcast(
      context,
      code * 4 + 2,
      Intent(context, CallActionReceiver::class.java)
        .setPackage(context.packageName)
        .putExtra(EXTRA_CALL_ID, callId)
        .putExtra(EXTRA_CALL_ACTION, "decline"),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = NotificationCompat.Builder(context, CALL_CHANNEL)
      .setSmallIcon(R.drawable.cowork_connect_notification)
      .setContentTitle(name.take(60).ifEmpty { "Someone nearby" })
      .setContentText("Incoming call over Cowork Connect")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setOngoing(true)
      .setAutoCancel(false)
      .setTimeoutAfter(CALL_TIMEOUT_MS)
      .addAction(0, "Decline", decline)
    if (accept != null) builder.addAction(0, "Accept", accept)
    openAppIntent(context, code * 4 + 3, null, null)?.let { builder.setContentIntent(it) }
    return try {
      manager.notify(CALL_TAG_PREFIX + callId, CALL_ID, builder.build())
      true
    } catch (e: SecurityException) {
      false
    }
  }

  fun clearIncomingCall(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(CALL_TAG_PREFIX + callId, CALL_ID)
  }

  /**
   * Opens the app's launcher activity (singleTask in Cowork), carrying the call action as extras.
   * Accept goes straight to the activity because Android 12+ blocks notification trampolines.
   * No intent data is set, so Expo Router never sees it as a deep link.
   */
  private fun openAppIntent(context: Context, requestCode: Int, callId: String?, action: String?): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (callId != null && action != null) {
      launch.putExtra(EXTRA_CALL_ID, callId)
      launch.putExtra(EXTRA_CALL_ACTION, action)
    }
    return PendingIntent.getActivity(context, requestCode, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** Reads and consumes a call action carried by an activity intent. */
  fun takeCallAction(intent: Intent?): Pair<String, String>? {
    if (intent == null) return null
    val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return null
    val action = intent.getStringExtra(EXTRA_CALL_ACTION) ?: return null
    intent.removeExtra(EXTRA_CALL_ID)
    intent.removeExtra(EXTRA_CALL_ACTION)
    if (action != "accept" && action != "decline") return null
    return callId to action
  }
}
