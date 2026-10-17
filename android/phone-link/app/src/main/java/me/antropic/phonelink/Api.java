package me.antropic.phonelink;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.BatteryManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Talks to Cowork over HTTPS. Blocking calls: run them off the main thread. */
final class Api {
    private static final String PREFS = "link";

    static final class Result {
        final int status;
        final JSONObject body;
        Result(int status, JSONObject body) { this.status = status; this.body = body; }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String token(Context c) {
        return prefs(c).getString("token", null);
    }

    static boolean linked(Context c) {
        return token(c) != null;
    }

    static void unlink(Context c) {
        prefs(c).edit().clear().apply();
    }

    /** Exchange the 6-character code from Cowork → Phone for this phone's own token. */
    static Result pair(Context c, String code, String name, String model) throws Exception {
        JSONObject req = new JSONObject();
        req.put("code", code);
        req.put("name", name);
        req.put("model", model);
        Result r = post("/api/phone/pair", req, null);
        if (r.status == 200 && r.body.has("token")) {
            prefs(c).edit()
                    .putString("token", r.body.getString("token"))
                    .putString("account", r.body.optString("account", ""))
                    .apply();
        }
        return r;
    }

    /** Send a batch of notifications (may be empty: then it's just a heartbeat with battery level). */
    static Result send(Context c, JSONArray events) throws Exception {
        String token = token(c);
        if (token == null) return new Result(401, new JSONObject());
        JSONObject req = new JSONObject();
        req.put("events", events);
        Intent battery = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery != null) {
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            if (level >= 0 && scale > 0) req.put("battery", Math.round(level * 100f / scale));
            req.put("charging", plugged != 0);
        }
        Result r = post("/api/phone/events", req, token);
        if (r.status == 401) unlink(c); // unlinked from Cowork: stop sending
        return r;
    }

    private static Result post(String path, JSONObject json, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(BuildConfig.SERVER + path).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(15_000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
        byte[] body = json.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body);
        }
        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            text = out.toString("UTF-8");
        }
        conn.disconnect();
        JSONObject parsed;
        try {
            parsed = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (Exception e) {
            parsed = new JSONObject();
        }
        return new Result(status, parsed);
    }

    private Api() {}
}
