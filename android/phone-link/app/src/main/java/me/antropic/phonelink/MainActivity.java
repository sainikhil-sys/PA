package me.antropic.phonelink;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Three screens in one: link with a code → allow notification access → linked status. */
public class MainActivity extends Activity {
    private static final int INK = Color.parseColor("#0A0A0A");
    private static final int MUTED = Color.parseColor("#6B6B70");

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private LinearLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        root.setPadding(pad, dp(48), pad, pad);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        root.removeAllViews();
        title("Cowork Phone Link");
        if (!Api.linked(this)) renderLink();
        else if (!hasNotificationAccess()) renderAccess();
        else renderLinked();
    }

    private void renderLink() {
        body("Shows this phone's calls, SMS, WhatsApp and app notifications in Cowork.\n\nIn Cowork, open Phone and tap “show my code”. Then enter the 6-character code here.");
        final EditText code = new EditText(this);
        code.setHint("ABC123");
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        code.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6), new InputFilter.AllCaps()});
        code.setTextSize(28);
        code.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        code.setGravity(Gravity.CENTER);
        code.setLetterSpacing(0.3f);
        root.addView(code, block(dp(16)));

        final EditText name = new EditText(this);
        name.setHint("Phone name");
        name.setText(Build.MANUFACTURER.substring(0, 1).toUpperCase() + Build.MANUFACTURER.substring(1) + " " + Build.MODEL);
        name.setTextSize(16);
        root.addView(name, block(dp(8)));

        final TextView status = body("");
        final Button link = primary("Link this phone");
        link.setOnClickListener(v -> {
            String c = code.getText().toString().trim().toUpperCase();
            if (c.length() != 6) {
                status.setText("Enter the 6-character code from Cowork.");
                return;
            }
            link.setEnabled(false);
            status.setText("Linking…");
            final String n = name.getText().toString().trim().isEmpty() ? Build.MODEL : name.getText().toString().trim();
            io.execute(() -> {
                String msg;
                try {
                    Api.Result r = Api.pair(this, c, n, Build.MANUFACTURER + " " + Build.MODEL);
                    msg = r.status == 200 ? null : r.body.optString("error", "Couldn't link (error " + r.status + ").");
                } catch (Exception e) {
                    msg = "No connection. Check the internet and try again.";
                }
                final String m = msg;
                main.post(() -> {
                    link.setEnabled(true);
                    if (m == null) render();
                    else status.setText(m);
                });
            });
        });
    }

    private void renderAccess() {
        body("Linked to " + Api.prefs(this).getString("account", "your Cowork account") + ".\n\nNow allow notification access, so calls and messages can reach Cowork. On the next screen, turn on “Cowork Phone Link”.");
        Button allow = primary("Allow notification access");
        allow.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        small("Android may warn that this app can read notifications. That's what lets Cowork show them. Nothing is sent anywhere except your Cowork account.");
    }

    private void renderLinked() {
        body("Linked to " + Api.prefs(this).getString("account", "your Cowork account") + ".\n\nCalls, SMS, WhatsApp and app notifications on this phone now appear in Cowork → Phone.");
        final TextView status = small("");
        Button test = primary("Send a test");
        test.setOnClickListener(v -> {
            status.setText("Sending…");
            io.execute(() -> {
                String msg;
                try {
                    JSONArray one = new JSONArray();
                    org.json.JSONObject e = new org.json.JSONObject();
                    e.put("key", "test");
                    e.put("package", getPackageName());
                    e.put("appName", "Cowork Phone Link");
                    e.put("title", "Test from your phone");
                    e.put("text", "If you can read this in Cowork, the link works.");
                    e.put("postedAt", System.currentTimeMillis());
                    one.put(e);
                    Api.Result r = Api.send(this, one);
                    msg = r.status == 200 ? "Sent. Check Cowork → Phone." : r.status == 401 ? "This phone was unlinked in Cowork." : "Couldn't send (error " + r.status + ").";
                } catch (Exception ex) {
                    msg = "No connection right now.";
                }
                final String m = msg;
                main.post(() -> {
                    status.setText(m);
                    if (!Api.linked(this)) render();
                });
            });
        });
        // Some phones stop background apps; nudge the listener to reconnect.
        Button restart = secondary("Reconnect");
        restart.setOnClickListener(v -> {
            NotificationListenerService.requestRebind(new ComponentName(this, NotifyService.class));
            status.setText("Reconnected.");
        });
        Button unlink = secondary("Unlink this phone");
        unlink.setOnClickListener(v -> {
            Api.unlink(this);
            render();
        });
        small("Tip: if updates stop, set battery usage for Cowork Phone Link to “Unrestricted” in Android settings.");
    }

    private boolean hasNotificationAccess() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(new ComponentName(this, NotifyService.class).flattenToString());
    }

    // --- tiny view helpers (no layout XML, no libraries) ---

    private void title(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(26);
        t.setTextColor(INK);
        t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(t, block(0));
    }

    private TextView body(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(16);
        t.setTextColor(INK);
        t.setLineSpacing(0, 1.25f);
        root.addView(t, block(dp(16)));
        return t;
    }

    private TextView small(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(13);
        t.setTextColor(MUTED);
        root.addView(t, block(dp(12)));
        return t;
    }

    private Button primary(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(INK);
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        root.addView(b, block(dp(20)));
        return b;
    }

    private Button secondary(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(15);
        b.setTextColor(INK);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setStroke(dp(1), Color.parseColor("#E7E7EA"));
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        root.addView(b, block(dp(10)));
        return b;
    }

    private LinearLayout.LayoutParams block(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        io.shutdown();
        super.onDestroy();
    }

    @SuppressWarnings("unused")
    private void hide(View v) {
        v.setVisibility(View.GONE);
    }
}
