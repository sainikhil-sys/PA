import "server-only";
import { eq } from "drizzle-orm";
import { db, schema, type DB } from "@/lib/db";

/**
 * The one way an account is deleted (Settings, the app, and the console's deletion queue). Removes the
 * users row; sessions, devices, tasks, mail, notes, roles and everything else the person owns cascade
 * from it. Admin audit rows and deletion requests have no cascading foreign key, so they stay as proof.
 * Irreversible: every caller must confirm first.
 */
export async function deleteAccountData(userId: string, executor: Pick<DB, "delete"> = db()): Promise<void> {
  await executor.delete(schema.users).where(eq(schema.users.id, userId));
}
