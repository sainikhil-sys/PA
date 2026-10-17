package me.antropic.phonelink;

import android.app.Notification;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Receives the phone's notifications (once the person turns on Notification access) and forwards
 * them to Cowork in small batches. Calls, SMS and WhatsApp all arrive as notifications.
 */
public class NotifyService extends NotificationListenerService {
    private static final long FLUSH_DELAY_MS = 1500;
    private static final long HEARTBEAT_MS = 2 * 60 * 1000;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSONObject> pending = new ArrayList<>();
    private boolean flushScheduled = false;

    private final Runnable flush = this::flushNow;
    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            flushNow(); // empty batch = heartbeat (keeps "Connected" and battery fresh)
            main.postDelayed(this, HEARTBEAT_MS);
        }
    };

    @Override
    public void onListenerConnected() {
        main.removeCallbacks(heartbeat);
        main.post(heartbeat);
    }

    @Override
    public void onListenerDisconnected() {
        main.removeCallbacks(heartbeat);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (!Api.linked(this) || sbn.getPackageName().equals(getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null) return;
        boolean isCall = Notification.CATEGORY_CALL.equals(n.category) || "missed_call".equals(n.category);
        // Skip group summaries and persistent "ongoing" items (music, downloads), except calls.
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        if (!isCall && (sbn.isOngoing() || (n.flags & Notification.FLAG_FOREGROUND_SERVICE) != 0)) return;

        Bundle x = n.extras;
        CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence text = big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT);
        if (title == null && text == null) return;

        try {
            JSONObject e = new JSONObject();
            e.put("key", sbn.getKey());
            e.put("package", sbn.getPackageName());
            e.put("appName", appLabel(sbn.getPackageName()));
            if (n.category != null) e.put("category", n.category);
            e.put("title", title == null ? "" : clip(title.toString(), 400));
            e.put("text", text == null ? "" : clip(text.toString(), 4000));
            e.put("postedAt", sbn.getPostTime());
            synchronized (pending) {
                pending.add(e);
                if (pending.size() > 50) pending.remove(0);
            }
            if (!flushScheduled) {
                flushScheduled = true;
                main.postDelayed(flush, FLUSH_DELAY_MS);
            }
        } catch (Exception ignored) {
            // A malformed notification is skipped, never crashes the service.
        }
    }

    private void flushNow() {
        flushScheduled = false;
        final JSONArray batch = new JSONArray();
        synchronized (pending) {
            for (JSONObject e : pending) batch.put(e);
            pending.clear();
        }
        if (!Api.linked(this)) return;
        io.execute(() -> {
            try {
                Api.Result r = Api.send(this, batch);
                if (r.status >= 500 || r.status == 429) requeue(batch);
            } catch (Exception offline) {
                requeue(batch); // no network: try again with the next notification or heartbeat
            }
        });
    }

    private void requeue(JSONArray batch) {
        synchronized (pending) {
            for (int i = 0; i < batch.length() && pending.size() < 50; i++) {
                JSONObject e = batch.optJSONObject(i);
                if (e != null) pending.add(e);
            }
        }
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(ai).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    private static String clip(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        io.shutdown();
        super.onDestroy();
    }
}
