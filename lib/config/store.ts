import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema, type DB } from "@/lib/db";
import { errMessage, log } from "@/lib/log";
import { DEFAULT_UPDATE_POLICY, maintenanceFrom, resolveValues, updatePolicySchema, validateWrite, type Maintenance, type UpdatePolicy } from "./registry";

/**
 * Configuration reads and writes. Reads go through a per-instance cache of 30 seconds, so a change
 * reaches every server instance within about 30 seconds. If the database can't be read, the last
 * good copy is used, or the registry defaults when there is none (maintenance off, no minimum build).
 */

const TTL_MS = 30_000;

export type ConfigSnapshot = {
  values: ReadonlyMap<string, unknown>;
  /** Grows by one with every write to any key (sum of row versions). */
  configVersion: number;
  loadedAt: number;
  /** False when this copy is the registry defaults because the database could not be read. */
  fromDatabase: boolean;
};

const g = globalThis as unknown as { __coworkConfig?: { snap: ConfigSnapshot; pending?: Promise<ConfigSnapshot> } };

async function load(): Promise<ConfigSnapshot> {
  const rows = await db().select({ key: schema.appConfiguration.key, value: schema.appConfiguration.value, version: schema.appConfiguration.version }).from(schema.appConfiguration);
  return { values: resolveValues(rows), configVersion: rows.reduce((n, r) => n + r.version, 0), loadedAt: Date.now(), fromDatabase: true };
}

export async function getConfigSnapshot(): Promise<ConfigSnapshot> {
  const cached = g.__coworkConfig;
  if (cached && Date.now() - cached.snap.loadedAt < TTL_MS) return cached.snap;
  if (cached?.pending) return cached.pending;
  const pending = load()
    .then((snap) => {
      g.__coworkConfig = { snap };
      return snap;
    })
    .catch((err: unknown) => {
      log.error("config.load_failed", { error: errMessage(err) });
      // Keep serving the last good copy; retry after a short pause instead of on every request.
      const fallback: ConfigSnapshot = cached?.snap
        ? { ...cached.snap, loadedAt: Date.now() - TTL_MS + 5_000 }
        : { values: resolveValues([]), configVersion: 0, loadedAt: Date.now() - TTL_MS + 5_000, fromDatabase: false };
      g.__coworkConfig = { snap: fallback };
      return fallback;
    });
  g.__coworkConfig = { snap: cached?.snap ?? { values: resolveValues([]), configVersion: 0, loadedAt: 0, fromDatabase: false }, pending };
  return pending;
}

/** Drops this instance's cached copy (after a write here). Other instances refresh within 30 seconds. */
export function invalidateConfigCache(): void {
  g.__coworkConfig = undefined;
}

export async function getConfigValue<T = unknown>(key: string): Promise<T> {
  return (await getConfigSnapshot()).values.get(key) as T;
}

export async function getMaintenance(): Promise<Maintenance> {
  return maintenanceFrom((await getConfigSnapshot()).values);
}

export async function getUpdatePolicy(): Promise<UpdatePolicy> {
  const v = (await getConfigSnapshot()).values.get("updates.android");
  const r = updatePolicySchema.safeParse(v);
  return r.success ? r.data : DEFAULT_UPDATE_POLICY;
}

type Executor = Pick<DB, "select" | "insert" | "update" | "execute">;

/** Current stored row, read inside the writing transaction with a row lock. */
export async function readConfigRow(executor: Executor, key: string): Promise<{ value: unknown; version: number } | null> {
  const [row] = await executor
    .select({ value: schema.appConfiguration.value, version: schema.appConfiguration.version })
    .from(schema.appConfiguration)
    .where(eq(schema.appConfiguration.key, key))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * Writes a new version of one key and its history row in the caller's transaction. The value must
 * already be validated (validateWrite) and is validated again here. Returns the value before and after.
 */
export async function writeConfigValue(
  executor: Executor,
  input: { key: string; value: unknown; actorUserId: string; reason: string; restoredFromVersion?: number | null },
): Promise<{ previous: unknown; value: unknown; version: number; created: boolean }> {
  const check = validateWrite(input.key, input.value);
  if (!check.ok) throw new Error(check.error);
  // Serialises writers of the same key even when the row doesn't exist yet.
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`config:${input.key}`}))`);
  const row = await readConfigRow(executor, input.key);
  const previous = row ? row.value : check.entry.default;
  const version = (row?.version ?? 0) + 1;
  if (row) {
    await executor
      .update(schema.appConfiguration)
      .set({ value: check.value as object, version, updatedBy: input.actorUserId })
      .where(eq(schema.appConfiguration.key, input.key));
  } else {
    await executor.insert(schema.appConfiguration).values({ key: input.key, value: check.value as object, version, updatedBy: input.actorUserId });
  }
  await executor.insert(schema.appConfigurationHistory).values({
    key: input.key,
    version,
    value: check.value as object,
    previousValue: (previous ?? null) as object | null,
    restoredFromVersion: input.restoredFromVersion ?? null,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  return { previous, value: check.value, version, created: !row };
}

/** Stored rows for the console (uncached). */
export async function listConfigRows() {
  return db()
    .select({ key: schema.appConfiguration.key, value: schema.appConfiguration.value, version: schema.appConfiguration.version, updatedAt: schema.appConfiguration.updatedAt })
    .from(schema.appConfiguration);
}

export async function configHistory(key: string, limit = 50) {
  return db()
    .select({
      version: schema.appConfigurationHistory.version,
      value: schema.appConfigurationHistory.value,
      previousValue: schema.appConfigurationHistory.previousValue,
      restoredFromVersion: schema.appConfigurationHistory.restoredFromVersion,
      reason: schema.appConfigurationHistory.reason,
      createdAt: schema.appConfigurationHistory.createdAt,
      actorEmail: schema.users.email,
    })
    .from(schema.appConfigurationHistory)
    .leftJoin(schema.users, eq(schema.users.id, schema.appConfigurationHistory.actorUserId))
    .where(eq(schema.appConfigurationHistory.key, key))
    .orderBy(desc(schema.appConfigurationHistory.version))
    .limit(limit);
}

/** One stored version, for rollback. */
export async function configVersionValue(executor: Executor, key: string, version: number): Promise<unknown | undefined> {
  const [row] = await executor
    .select({ value: schema.appConfigurationHistory.value })
    .from(schema.appConfigurationHistory)
    .where(sql`${schema.appConfigurationHistory.key} = ${key} and ${schema.appConfigurationHistory.version} = ${version}`)
    .limit(1);
  return row ? row.value : undefined;
}
