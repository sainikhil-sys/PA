import "server-only";
import { listUsersForSystem } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";
import { errMessage, log } from "@/lib/log";

/** Run per-user scheduling for every account; one user's failure never stops the rest. */
export async function forEachUser<T>(name: string, fn: (user: User) => Promise<T>): Promise<{ users: number; ok: number; failed: number }> {
  const users = await listUsersForSystem();
  let ok = 0;
  let failed = 0;
  for (const u of users) {
    try {
      await fn(u);
      ok++;
    } catch (err) {
      failed++;
      log.error(`${name}.user_failed`, { error: errMessage(err) });
    }
  }
  return { users: users.length, ok, failed };
}
