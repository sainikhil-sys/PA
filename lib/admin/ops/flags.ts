import "server-only";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { targetingSchema } from "@/lib/flags/evaluate";
import { FLAG_DEFS, FLAGS } from "@/lib/flags/registry";
import { flagHistory, flagStateOf, flagVersionValue, invalidateFlagCache, listFlagRows, writeFlag, type FlagState } from "@/lib/flags/store";
import { adminOp } from "../op";

/** Feature flag ops (Phase F). Only keys in lib/flags/registry.ts can be stored. */

const reason = z.string().trim().min(3, "Say why you're making this change.").max(500);
const flagKey = z
  .string()
  .trim()
  .max(80)
  .refine((k) => FLAGS.has(k), "That feature flag doesn't exist.");

export const flagStateSchema = z
  .object({
    enabled: z.boolean(),
    rolloutPercent: z.number().int().min(0).max(100),
    targeting: targetingSchema,
    startsAt: z.string().datetime({ offset: true }).nullable(),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    description: z.string().trim().max(300).default(""),
  })
  .refine((s) => !s.startsAt || !s.endsAt || new Date(s.startsAt) < new Date(s.endsAt), { message: "The end must be after the start.", path: ["endsAt"] });

export const flagUpdateInput = z.object({ key: flagKey, state: flagStateSchema, reason });
export type FlagUpdateInput = z.input<typeof flagUpdateInput>;

function same(a: FlagState | null, b: FlagState): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

export const flagUpdateOp = adminOp({
  action: "flag.update",
  resourceType: "feature_flag",
  permission: "flags.write",
  kind: "write",
  input: flagUpdateInput,
  run: async ({ key, state, reason: why }, ctx) => {
    const next: FlagState = { ...state, targeting: state.targeting };
    const rows = await listFlagRows();
    const current = rows.find((r) => r.key === key);
    if (current && !current.archivedAt && same(flagStateOf(current), next)) throw new UserFacingError("Nothing changed.");
    const out = await writeFlag(ctx.tx, { key, state: next, actorUserId: ctx.user.id, reason: why });
    ctx.record({ resourceId: key, before: out.previous, after: { ...next, version: out.version }, reason: why });
    invalidateFlagCache();
    return { key, version: out.version };
  },
});

/** Saves an older version again as a new version. Same permission as an edit: it is an edit with old values. */
export const flagRestoreOp = adminOp({
  action: "flag.restore",
  resourceType: "feature_flag",
  permission: "flags.write",
  kind: "write",
  input: z.object({ key: flagKey, version: z.number().int().min(1), reason }),
  run: async ({ key, version, reason: why }, ctx) => {
    const old = await flagVersionValue(ctx.tx, key, version);
    if (old === undefined) throw new UserFacingError("That version doesn't exist.");
    const parsed = flagStateSchema.safeParse(old);
    if (!parsed.success) throw new UserFacingError("That version can't be restored because it no longer fits the flag.");
    const out = await writeFlag(ctx.tx, { key, state: parsed.data, actorUserId: ctx.user.id, reason: why, restoredFromVersion: version });
    ctx.record({ resourceId: key, before: out.previous, after: { ...parsed.data, version: out.version, restoredFromVersion: version }, reason: why });
    invalidateFlagCache();
    return { key, version: out.version };
  },
});

export const flagListOp = adminOp({
  action: "flag.list",
  resourceType: "feature_flag",
  permission: "flags.read",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const rows = new Map((await listFlagRows()).map((r) => [r.key, r]));
    return FLAG_DEFS.map((f) => {
      const r = rows.get(f.key);
      return {
        key: f.key,
        label: f.label,
        description: f.description,
        default: f.default,
        enforcedIn: f.enforcedIn,
        state: r && !r.archivedAt ? flagStateOf(r) : null,
        version: r?.version ?? 0,
        updatedAt: r?.updatedAt ?? null,
      };
    });
  },
});

export const flagHistoryOp = adminOp({
  action: "flag.history",
  resourceType: "feature_flag",
  permission: "flags.read",
  kind: "read",
  input: z.object({ key: flagKey }),
  run: async ({ key }) => flagHistory(key),
});
