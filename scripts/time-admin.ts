// Times the admin console queries against the configured database (read-only).
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const stats = await import("../lib/admin/stats");
for (const [name, fn] of [
  ["overviewStats", () => stats.overviewStats()],
  ["dailySeries", () => stats.dailySeries(30)],
  ["tokenBreakdown", () => stats.tokenBreakdown()],
  ["listUsersAdmin", () => stats.listUsersAdmin()],
  ["systemHealth", () => stats.systemHealth()],
] as const) {
  const t = Date.now();
  try {
    const r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 30s")), 30_000))]);
    console.log(name, `${Date.now() - t}ms`, Array.isArray(r) ? `${r.length} rows` : "ok");
  } catch (e) {
    console.log(name, `${Date.now() - t}ms`, "FAILED", (e as Error).message.slice(0, 200));
  }
}
process.exit(0);
