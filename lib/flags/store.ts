import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getAdminRole } from "@/lib/admin/roles";
import { readClientHeaders, type ClientPlatform } from "@/lib/config/version";
import { db, schema, type DB } from "@/lib/db";
import type { FlagTargeting, User } from "@/lib/db/schema";
import { errMessage, log } from "@/lib/log";
import { evaluateAll, evaluateFlag, type EvalContext, type FlagRow } from "./evaluate";

/** Flag rows through a per-instance cache of 30 seconds, like configuration. */

const TTL_MS = 30_000;
const g = globalThis as unknown as { __coworkFlags?: { rows: FlagRow[]; loadedAt: number } };

export async function getFlagRows(): Promise<FlagRow[]> {
  const c = g.__coworkFlags;
  if (c && Date.now() - c.loadedAt < TTL_MS) return c.rows;
  try {
    const rows = await db()
      .select({
        key: schema.featureFlags.key,
        enabled: schema.featureFlags.enabled,
        rolloutPercent: schema.featureFlags.rolloutPercent,
        targeting: schema.featureFlags.targeting,
        startsAt: schema.featureFlags.startsAt,
        endsAt: schema.featureFlags.endsAt,
        archivedAt: schema.featureFlags.archivedAt,
      })
      .from(schema.featureFlags);
    g.__coworkFlags = { rows, loadedAt: Date.now() };
    return rows;
  } catch (err) {
    log.error("flags.load_failed", { error: errMessage(err) });
    // Last good copy, or registry defaults (no rows). Retry in a few seconds.
    const rows = c?.rows ?? [];
    g.__coworkFlags = { rows, loadedAt: Date.now() - TTL_MS + 5_000 };
    return rows;
  }
}

export function invalidateFlagCache(): void {
  g.__coworkFlags = undefined;
}

/** Evaluation context for a signed-in person on this request. Cookie requests are the website. */
export async function flagContext(user: Pick<User, "id" | "createdAt" | "disabledAt">, h: Pick<Headers, "get">): Promise<EvalContext> {
  const client = readClientHeaders(h);
  const bearer = /^Bearer /.test(h.get("authorization") ?? "");
  const platform: ClientPlatform = client.platform ?? (bearer ? "android" : "web");
  return {
    userId: user.id,
    platform,
    appVersion: client.appVersion,
    isAdmin: Boolean(await getAdminRole(user)),
    userCreatedAt: user.createdAt,
    now: new Date(),
  };
}

export async function evaluateFlagsFor(ctx: EvalContext): Promise<Record<string, boolean>> {
  return evaluateAll(await getFlagRows(), ctx);
}

export async function isFlagOn(key: string, ctx: EvalContext): Promise<boolean> {
  const rows = await getFlagRows();
  return evaluateFlag(
    key,
    rows.find((r) => r.key === key),
    ctx,
  );
}

type Executor = Pick<DB, "select" | "insert" | "update" | "execute">;

export type FlagState = { enabled: boolean; rolloutPercent: number; targeting: FlagTargeting; startsAt: string | null; endsAt: string | null; description: string };

export function flagStateOf(row: { enabled: boolean; rolloutPercent: number; targeting: FlagTargeting; startsAt: Date | null; endsAt: Date | null; description: string }): FlagState {
  return {
    enabled: row.enabled,
    rolloutPercent: row.rolloutPercent,
    targeting: row.targeting ?? {},
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    description: row.description,
  };
}

/** Writes a new version of a flag and its history row in the caller's transaction. */
export async function writeFlag(
  executor: Executor,
  input: { key: string; state: FlagState; actorUserId: string; reason: string; restoredFromVersion?: number | null },
): Promise<{ previous: FlagState | null; version: number }> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`flag:${input.key}`}))`);
  const [row] = await executor.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, input.key)).for("update").limit(1);
  const previous = row ? flagStateOf(row) : null;
  const version = (row?.version ?? 0) + 1;
  const values = {
    description: input.state.description,
    enabled: input.state.enabled,
    rolloutPercent: input.state.rolloutPercent,
    targeting: input.state.targeting,
    startsAt: input.state.startsAt ? new Date(input.state.startsAt) : null,
    endsAt: input.state.endsAt ? new Date(input.state.endsAt) : null,
    version,
    updatedBy: input.actorUserId,
    archivedAt: null,
  };
  if (row) await executor.update(schema.featureFlags).set(values).where(eq(schema.featureFlags.key, input.key));
  else await executor.insert(schema.featureFlags).values({ key: input.key, ...values });
  await executor.insert(schema.featureFlagHistory).values({
    key: input.key,
    version,
    value: input.state,
    previousValue: previous,
    restoredFromVersion: input.restoredFromVersion ?? null,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  return { previous, version };
}

export async function listFlagRows() {
  return db().select().from(schema.featureFlags);
}

export async function flagHistory(key: string, limit = 50) {
  return db()
    .select({
      version: schema.featureFlagHistory.version,
      value: schema.featureFlagHistory.value,
      previousValue: schema.featureFlagHistory.previousValue,
      restoredFromVersion: schema.featureFlagHistory.restoredFromVersion,
      reason: schema.featureFlagHistory.reason,
      createdAt: schema.featureFlagHistory.createdAt,
      actorEmail: schema.users.email,
    })
    .from(schema.featureFlagHistory)
    .leftJoin(schema.users, eq(schema.users.id, schema.featureFlagHistory.actorUserId))
    .where(eq(schema.featureFlagHistory.key, key))
    .orderBy(desc(schema.featureFlagHistory.version))
    .limit(limit);
}

export async function flagVersionValue(executor: Executor, key: string, version: number): Promise<unknown | undefined> {
  const [row] = await executor
    .select({ value: schema.featureFlagHistory.value })
    .from(schema.featureFlagHistory)
    .where(sql`${schema.featureFlagHistory.key} = ${key} and ${schema.featureFlagHistory.version} = ${version}`)
    .limit(1);
  return row ? row.value : undefined;
}
