// End-to-end check of the phone link against PRODUCTION using the local TEST account only
// (dev@cowork.test): pair → send events → verify stored kinds → unlink and clean up.
import crypto from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
const BASE = "https://antropic.me";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const [user] = await sql`select id, disabled_at from users where email = ${"dev@cowork.test"}`;
if (!user) throw new Error("test account missing");
const wasDisabled = Boolean(user.disabled_at);
if (wasDisabled) await sql`update users set disabled_at = null where id = ${user.id}`;

try {
  const code = "TSTK" + crypto.randomInt(10, 99).toString().replace(/[01]/g, "7");
  await sql`insert into phone_pair_codes (user_id, code_hash, expires_at) values (${user.id}, ${sha(code)}, ${new Date(Date.now() + 5 * 60_000).toISOString()}::timestamptz)`;
  const pair = await fetch(`${BASE}/api/phone/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "E2E test phone", model: "Test" }) });
  const pj = await pair.json();
  console.log("pair:", pair.status, pj.token ? "token received" : pj.error);
  const reuse = await fetch(`${BASE}/api/phone/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "again" }) });
  console.log("same code again (must fail):", reuse.status);

  const now = Date.now();
  const events = [
    { key: "k1", package: "com.google.android.dialer", appName: "Phone", category: "call", title: "+91 98765 43210", text: "Incoming call", postedAt: now },
    { key: "k2", package: "com.whatsapp", appName: "WhatsApp", category: "msg", title: "Ravi", text: "Are we meeting today?", postedAt: now },
    { key: "k3", package: "com.google.android.apps.messaging", appName: "Messages", category: "msg", title: "VK-BANK", text: "Your OTP is 123456", postedAt: now },
    { key: "k4", package: "com.slack", appName: "Slack", title: "#general", text: "Deploy done", postedAt: now },
  ];
  const auth = { "content-type": "application/json", authorization: `Bearer ${pj.token}` };
  const send = await fetch(`${BASE}/api/phone/events`, { method: "POST", headers: auth, body: JSON.stringify({ events, battery: 76, charging: true }) });
  console.log("events:", send.status, JSON.stringify(await send.json()));
  const dup = await fetch(`${BASE}/api/phone/events`, { method: "POST", headers: auth, body: JSON.stringify({ events }) });
  console.log("same events again (dedupe, stored 0):", JSON.stringify(await dup.json()));

  const rows = await sql`select kind, app_name, title from phone_events where user_id = ${user.id} order by app_name`;
  console.log("stored kinds:", rows.map((r) => `${r.app_name}=${r.kind}`).join(", "));
  const [dev] = await sql`select battery, charging, last_seen_at is not null as seen from phone_devices where user_id = ${user.id} and revoked_at is null`;
  console.log("device:", JSON.stringify(dev));

  const bad = await fetch(`${BASE}/api/phone/events`, { method: "POST", headers: { ...auth, authorization: "Bearer wrong-token-wrong-token-wrong-token" }, body: "{}" });
  console.log("wrong token (must be 401):", bad.status);
} finally {
  await sql`delete from phone_devices where user_id = ${user.id}`;
  await sql`delete from phone_pair_codes where user_id = ${user.id}`;
  if (wasDisabled) await sql`update users set disabled_at = now() where id = ${user.id}`;
  console.log("cleaned up; test account disabled again:", wasDisabled);
  await sql.end();
}
