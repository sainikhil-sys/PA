// Times the admin console data functions against the configured database (read-only).
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const stats = await import("../lib/admin/stats");
const runs: [string, () => Promise<unknown>][] = [
  ["overviewStats", () => stats.overviewStats()],
  ["dailySeries", () => stats.dailySeries(30)],
  ["tokenBreakdown", () => stats.tokenBreakdown()],
  ["listUsersAdmin", () => stats.listUsersAdmin()],
  ["systemHealth", () => stats.systemHealth()],
  ["listBroadcasts", () => stats.listBroadcasts()],
];
for (const [name, fn] of runs) {
  const t = Date.now();
  try {
    const r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 30s")), 30_000))]);
    console.log(name, `${Date.now() - t}ms`, JSON.stringify(r).slice(0, 160));
  } catch (e) {
    console.log(name, `${Date.now() - t}ms`, "FAILED", String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message).slice(0, 300));
  }
}
process.exit(0);
