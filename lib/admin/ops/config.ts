import "server-only";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { auditValue, CONFIG, CONFIG_ENTRIES, configEntry, DEFAULT_MAINTENANCE_MESSAGE, resolveValues, validateWrite, type ConfigEntry } from "@/lib/config/registry";
import { configHistory, configVersionValue, invalidateConfigCache, listConfigRows, readConfigRow, writeConfigValue } from "@/lib/config/store";
import type { Permission } from "../permissions";
import { adminOp, type OpCtx } from "../op";

/** Configuration ops (Phase E). Every change writes a new version, a history row and an audit row. */

const reason = z.string().trim().min(3, "Say why you're making this change.").max(500);
const configKey = z.string().trim().min(1).max(80);

export const configUpdateInput = z.object({ key: configKey, value: z.unknown(), reason });
export type ConfigUpdateInput = z.input<typeof configUpdateInput>;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Applies one validated change in the op's transaction and records the audit values. */
async function applyChange(entry: ConfigEntry, value: unknown, why: string, ctx: OpCtx, restoredFromVersion?: number) {
  const out = await writeConfigValue(ctx.tx, { key: entry.key, value, actorUserId: ctx.user.id, reason: why, restoredFromVersion: restoredFromVersion ?? null });
  ctx.record({
    resourceId: entry.key,
    before: { value: auditValue(entry, out.previous) },
    after: { value: auditValue(entry, out.value), version: out.version, ...(restoredFromVersion ? { restoredFromVersion } : {}) },
    reason: why,
  });
  return { key: entry.key, version: out.version };
}

/** Generic edit for keys changed through the editor with this permission (not the dedicated cards). */
function makeUpdateOp(action: string, permission: Permission) {
  return adminOp({
    action,
    resourceType: "config",
    permission,
    kind: "write",
    input: configUpdateInput,
    run: async ({ key, value, reason: why }, ctx) => {
      const check = validateWrite(key, value);
      if (!check.ok) throw new UserFacingError(check.error);
      const entry = check.entry;
      if (entry.dedicated) throw new UserFacingError(`${entry.label} is changed from its own card.`);
      if (entry.permission !== permission) throw new UserFacingError("Your role can't change this setting.");
      const row = await readConfigRow(ctx.tx, key);
      if (row && sameValue(row.value, check.value)) throw new UserFacingError("Nothing changed.");
      const result = await applyChange(entry, check.value, why, ctx);
      invalidateConfigCache();
      return result;
    },
  });
}

export const configUpdateOp = makeUpdateOp("config.update", "config.write");
export const appearanceUpdateOp = makeUpdateOp("config.update_appearance", "appearance.write");

// ---------- Maintenance (owner only, confirmation every time) ----------

export const maintenanceInput = z.object({
  active: z.boolean(),
  message: z
    .string()
    .trim()
    .max(300)
    .refine((s) => !/[<>]/.test(s), "Plain text only, without < or >.")
    .nullable()
    .transform((s) => (s ? s : null)),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  pauseJobs: z.boolean(),
  reason,
});

const MAINTENANCE_KEYS = { active: "maintenance.active", message: "maintenance.message", endsAt: "maintenance.endsAt", pauseJobs: "maintenance.pauseJobs" } as const;

export const maintenanceSetOp = adminOp({
  action: "maintenance.set",
  resourceType: "config",
  permission: "maintenance.write",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: maintenanceInput,
  summary: (i) =>
    i.active
      ? `Turn maintenance on. Everyone except admins sees "${i.message ?? DEFAULT_MAINTENANCE_MESSAGE}" and the API answers 503${i.pauseJobs ? ". Background jobs pause" : ""}.`
      : `Turn maintenance off${i.pauseJobs ? " but keep background jobs paused" : " and let background jobs run"}.`,
  run: async (input, ctx) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let changed = 0;
    for (const [field, key] of Object.entries(MAINTENANCE_KEYS) as [keyof typeof MAINTENANCE_KEYS, string][]) {
      const entry = CONFIG.get(key)!;
      const next = input[field];
      const row = await readConfigRow(ctx.tx, key);
      const current = row ? row.value : entry.default;
      before[field] = current;
      after[field] = next;
      if (sameValue(current, next)) continue;
      await writeConfigValue(ctx.tx, { key, value: next, actorUserId: ctx.user.id, reason: input.reason });
      changed++;
    }
    if (!changed) throw new UserFacingError("Nothing changed.");
    ctx.record({ resourceId: "maintenance", before, after, reason: input.reason });
    invalidateConfigCache();
    return { changed };
  },
});

// ---------- Rollback (owner only, confirmation) ----------

export const configRollbackOp = adminOp({
  action: "config.rollback",
  resourceType: "config",
  permission: "config.rollback",
  kind: "write",
  risk: "destructive",
  input: z.object({ key: configKey, version: z.number().int().min(1), reason }),
  summary: (i) => {
    const e = configEntry(i.key);
    return `Restore ${e?.label ?? i.key} to version ${i.version}. This saves the old value as a new version.`;
  },
  run: async ({ key, version, reason: why }, ctx) => {
    const entry = configEntry(key);
    if (!entry) throw new UserFacingError("That setting doesn't exist.");
    // Maintenance and the update policy have their own checks; change them from their cards.
    if (entry.dedicated) throw new UserFacingError(`${entry.label} is changed from its own card, not restored from history.`);
    const old = await configVersionValue(ctx.tx, key, version);
    if (old === undefined) throw new UserFacingError("That version doesn't exist.");
    const check = validateWrite(key, old);
    if (!check.ok) throw new UserFacingError(`That version can't be restored because it no longer fits the setting. ${check.error}`);
    const row = await readConfigRow(ctx.tx, key);
    if (row && sameValue(row.value, check.value)) throw new UserFacingError("That version is already the current value.");
    const result = await applyChange(entry, check.value, why, ctx, version);
    invalidateConfigCache();
    return result;
  },
});

// ---------- Reads (for /api/admin/config) ----------

export const configListOp = adminOp({
  action: "config.list",
  resourceType: "config",
  permission: "config.read",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const rows = await listConfigRows();
    const values = resolveValues(rows);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return CONFIG_ENTRIES.map((e) => ({
      key: e.key,
      group: e.group,
      label: e.label,
      scope: e.scope,
      permission: e.permission,
      value: e.secret ? "[secret]" : values.get(e.key),
      isDefault: !byKey.has(e.key),
      version: byKey.get(e.key)?.version ?? 0,
      updatedAt: byKey.get(e.key)?.updatedAt ?? null,
    }));
  },
});

export const configHistoryOp = adminOp({
  action: "config.history",
  resourceType: "config",
  permission: "config.read",
  kind: "read",
  input: z.object({ key: configKey }),
  run: async ({ key }) => {
    const entry = configEntry(key);
    if (!entry) throw new UserFacingError("That setting doesn't exist.");
    const rows = await configHistory(key);
    return rows.map((r) => ({ ...r, value: entry.secret ? "[secret]" : r.value, previousValue: entry.secret ? "[secret]" : r.previousValue }));
  },
});
