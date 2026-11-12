import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { classifyChange, configEntry, DEFAULT_UPDATE_POLICY, effectiveMinBuild, updatePolicySchema, type UpdatePolicy } from "@/lib/config/registry";
import { invalidateConfigCache, readConfigRow, writeConfigValue } from "@/lib/config/store";
import { db, schema, type DB } from "@/lib/db";
import type { Permission } from "../permissions";
import { adminOp, type OpCtx } from "../op";

/** Releases and the Android update policy (Phase G). */

type Tx = OpCtx["tx"];
const reason = z.string().trim().min(3, "Say why you're making this change.").max(500);

export const policyInput = z.object({ policy: updatePolicySchema, reason });
export type PolicyInput = z.input<typeof policyInput>;

async function currentPolicy(executor: Pick<DB, "select">): Promise<UpdatePolicy> {
  const [row] = await executor.select({ value: schema.appConfiguration.value }).from(schema.appConfiguration).where(eq(schema.appConfiguration.key, "updates.android")).limit(1);
  const r = updatePolicySchema.safeParse(row?.value);
  return r.success ? r.data : DEFAULT_UPDATE_POLICY;
}

/** Which op a policy change needs, from the stored policy (fresh read). */
export async function policyChangeNeeds(next: unknown): Promise<{ permission: Permission; risk: "normal" | "destructive" }> {
  return classifyChange("updates.android", next, await currentPolicy(db()))!;
}

/**
 * Live Android store builds, and which of them are known to send the version headers (a session has
 * reported that build number). The console refuses a minimum until such a build is live (proposal 4.3).
 */
export async function liveStoreBuilds(executor: Pick<DB, "select"> = db()) {
  const rows = await executor
    .select({
      version: schema.applicationReleases.version,
      buildNumber: schema.applicationReleases.buildNumber,
      runtimeVersion: schema.applicationReleases.runtimeVersion,
      sendsHeaders: sql<boolean>`exists (select 1 from ${schema.sessions} s where s.platform = 'android' and s.app_build = ${schema.applicationReleases.buildNumber})`,
    })
    .from(schema.applicationReleases)
    .where(and(eq(schema.applicationReleases.platform, "android"), eq(schema.applicationReleases.kind, "store"), eq(schema.applicationReleases.status, "live"), isNotNull(schema.applicationReleases.buildNumber)));
  return rows.map((r) => ({ ...r, buildNumber: r.buildNumber!, sendsHeaders: Boolean(r.sendsHeaders) }));
}

/** Why a minimum build can't be set yet, or null when it can. Pure on its inputs. */
export function minimumBlockedReason(newMin: number, live: readonly { buildNumber: number; sendsHeaders: boolean }[]): string | null {
  if (newMin <= 0) return null;
  if (!live.some((b) => b.sendsHeaders)) {
    return "No live store build has reported its version yet. Release a store build that sends the version headers and wait until it is in use, then set a minimum.";
  }
  const highest = Math.max(...live.map((b) => b.buildNumber));
  if (newMin > highest) return `The newest live store build is ${highest}. A minimum above it would leave nobody able to update.`;
  return null;
}

async function applyPolicy(policy: UpdatePolicy, why: string, ctx: OpCtx, expect: Permission) {
  const prev = await readConfigRow(ctx.tx, "updates.android");
  const prevPolicy = updatePolicySchema.safeParse(prev?.value);
  const before = prevPolicy.success ? prevPolicy.data : DEFAULT_UPDATE_POLICY;
  const needs = classifyChange("updates.android", policy, before)!;
  if (needs.permission !== expect) throw new UserFacingError("The update policy changed while you were editing. Reload the page and try again.");
  if (JSON.stringify(before) === JSON.stringify(policy)) throw new UserFacingError("Nothing changed.");
  const newMin = effectiveMinBuild(policy);
  if (newMin > effectiveMinBuild(before)) {
    const blocked = minimumBlockedReason(newMin, await liveStoreBuilds(ctx.tx as Tx));
    if (blocked) throw new UserFacingError(blocked);
  }
  const out = await writeConfigValue(ctx.tx, { key: "updates.android", value: policy, actorUserId: ctx.user.id, reason: why });
  ctx.record({ resourceId: "updates.android", before, after: { ...policy, version: out.version }, reason: why });
  invalidateConfigCache();
  return { version: out.version };
}

/** Edits that don't raise the build everyone must have: messages, latest version, lowering the minimum. */
export const policyUpdateOp = adminOp({
  action: "releases.policy_update",
  resourceType: "config",
  permission: "releases.write",
  kind: "write",
  input: policyInput,
  run: async ({ policy, reason: why }, ctx) => applyPolicy(policy, why, ctx, "releases.write"),
});

/** Raising the minimum build or making the latest update required: owner only, with confirmation. */
export const policyMandatoryOp = adminOp({
  action: "releases.policy_mandatory",
  resourceType: "config",
  permission: "releases.mandatory",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: policyInput,
  summary: (i) =>
    `Require Android build ${effectiveMinBuild(i.policy)} or newer. Older app versions can only update, sign out, export their data or delete their account until they update.`,
  run: async ({ policy, reason: why }, ctx) => applyPolicy(policy, why, ctx, "releases.mandatory"),
});

// ---------- Release records ----------

const version = z
  .string()
  .trim()
  .regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, "Use a version like 1.2.0");
const token = z
  .string()
  .trim()
  .max(64)
  .regex(/^[\w.\-+:]+$/, "Letters, numbers and . - + : only");

export const releaseCreateInput = z
  .object({
    platform: z.literal("android"),
    kind: z.enum(["store", "ota"]),
    version,
    buildNumber: z.number().int().min(1).max(1_000_000_000).nullable(),
    runtimeVersion: token.nullable(),
    channel: z.enum(["production", "preview"]).default("production"),
    updateGroupId: token.nullable(),
    notes: z.string().trim().max(2000).default(""),
    storeUrl: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((u) => u.startsWith("https://"), "Use a link that starts with https://")
      .nullable(),
  })
  .refine((r) => r.kind !== "store" || r.buildNumber !== null, { message: "A store build needs its build number (versionCode).", path: ["buildNumber"] })
  .refine((r) => r.kind !== "ota" || (r.runtimeVersion !== null && r.updateGroupId !== null), { message: "An OTA update needs its runtime version and update group id.", path: ["runtimeVersion"] });
export type ReleaseCreateInput = z.input<typeof releaseCreateInput>;

export const releaseCreateOp = adminOp({
  action: "release.create",
  resourceType: "release",
  permission: "releases.write",
  kind: "write",
  input: releaseCreateInput,
  run: async (r, ctx) => {
    const [dup] = await ctx.tx
      .select({ id: schema.applicationReleases.id })
      .from(schema.applicationReleases)
      .where(and(eq(schema.applicationReleases.platform, r.platform), eq(schema.applicationReleases.kind, r.kind), eq(schema.applicationReleases.version, r.version), eq(schema.applicationReleases.channel, r.channel)))
      .limit(1);
    if (dup) throw new UserFacingError("That release is already recorded.");
    const [row] = await ctx.tx
      .insert(schema.applicationReleases)
      .values({ ...r, buildNumber: r.kind === "store" ? r.buildNumber : null, updateGroupId: r.kind === "ota" ? r.updateGroupId : null, status: "draft", createdBy: ctx.user.id })
      .returning({ id: schema.applicationReleases.id });
    ctx.record({ resourceId: row!.id, after: { kind: r.kind, version: r.version, buildNumber: r.buildNumber, runtimeVersion: r.runtimeVersion, channel: r.channel } });
    return { id: row!.id };
  },
});

const STATUSES = ["draft", "testing", "live", "halted", "retired"] as const;

export const releaseStatusOp = adminOp({
  action: "release.set_status",
  resourceType: "release",
  permission: "releases.write",
  kind: "write",
  input: z.object({ id: z.string().uuid(), status: z.enum(STATUSES) }),
  run: async ({ id, status }, ctx) => {
    const [rel] = await ctx.tx.select().from(schema.applicationReleases).where(eq(schema.applicationReleases.id, id)).for("update").limit(1);
    if (!rel) throw new UserFacingError("That release doesn't exist.");
    if (rel.status === status) throw new UserFacingError("Nothing changed.");
    if (status === "live" && rel.kind === "ota") {
      // An update only reaches installs with the same runtime version, so a store build for it must be live.
      const live = await liveStoreBuilds(ctx.tx as Tx);
      if (!live.some((b) => b.runtimeVersion && b.runtimeVersion === rel.runtimeVersion)) {
        throw new UserFacingError(`No live store build has runtime version ${rel.runtimeVersion ?? "(none)"}, so this update can't reach anyone. Record and release that store build first.`);
      }
    }
    if (rel.kind === "store" && rel.status === "live" && status !== "live") {
      const policy = await currentPolicy(ctx.tx as Tx);
      const min = effectiveMinBuild(policy);
      const others = (await liveStoreBuilds(ctx.tx as Tx)).filter((b) => b.buildNumber !== rel.buildNumber);
      if (min > 0 && !others.some((b) => b.buildNumber >= min)) {
        throw new UserFacingError(`Build ${min} or newer is required, and this is the only live build that meets it. Lower the minimum first.`);
      }
    }
    await ctx.tx
      .update(schema.applicationReleases)
      .set({ status, ...(status === "live" && !rel.releasedAt ? { releasedAt: new Date() } : {}) })
      .where(eq(schema.applicationReleases.id, id));
    ctx.record({ resourceId: id, before: { status: rel.status }, after: { status } });
    return { id, status };
  },
});

// ---------- Overview (page and /api/admin/releases) ----------

/** Active app sessions seen in the last 30 days, by reported version. Real counts only. */
export async function versionAdoption() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db()
    .select({
      appVersion: schema.sessions.appVersion,
      appBuild: schema.sessions.appBuild,
      runtimeVersion: schema.sessions.runtimeVersion,
      people: sql<number>`count(distinct ${schema.sessions.userId})::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.platform, "android"), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()), gt(schema.sessions.lastSeenAt, since)))
    .groupBy(schema.sessions.appVersion, schema.sessions.appBuild, schema.sessions.runtimeVersion)
    .orderBy(desc(sql`count(distinct ${schema.sessions.userId})`))
    .limit(50);
}

export async function listReleases() {
  return db().select().from(schema.applicationReleases).orderBy(desc(schema.applicationReleases.createdAt)).limit(100);
}

export const releasesOverviewOp = adminOp({
  action: "release.list",
  resourceType: "release",
  permission: "releases.read",
  kind: "read",
  input: z.object({}),
  run: async () => {
    const [policy, releases, adoption, live] = await Promise.all([currentPolicy(db()), listReleases(), versionAdoption(), liveStoreBuilds()]);
    return { policy, effectiveMinBuild: effectiveMinBuild(policy), releases, adoption, liveStoreBuilds: live, policyLabel: configEntry("updates.android")!.label };
  },
});
