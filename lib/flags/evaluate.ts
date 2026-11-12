import { createHash } from "node:crypto";
import { z } from "zod";
import { compareVersions, type ClientPlatform } from "@/lib/config/version";
import type { FlagTargeting } from "@/lib/db/schema";
import { FLAGS } from "./registry";

/**
 * Flag evaluation, on the server only (docs/ADMIN_CONSOLE_PROPOSAL.md 4.2):
 * disabled or outside startsAt/endsAt -> false; deny list -> false; allow list -> true;
 * platform, app version and segment must match; then a stable bucket
 * sha256(flagKey + ":" + userId) mod 100 < rolloutPercent. Raising the percentage only adds people.
 * Pure module (node:crypto only) so it is unit tested.
 */

export type EvalContext = {
  userId: string | null;
  platform: ClientPlatform | null;
  appVersion: string | null;
  /** Holds an admin role. */
  isAdmin: boolean;
  userCreatedAt: Date | null;
  now: Date;
};

export type FlagRow = {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  targeting: FlagTargeting;
  startsAt: Date | null;
  endsAt: Date | null;
  archivedAt?: Date | null;
};

const SEGMENTS = ["admins", "beta", "new_users_30d", "signed_up_before"] as const;

/** What an admin may store as targeting. Shared by flags and announcements. */
export const targetingSchema = z
  .object({
    platforms: z.array(z.enum(["web", "android"])).max(2).optional(),
    minAppVersion: z.string().trim().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, "Use a version like 1.2.0").optional(),
    maxAppVersion: z.string().trim().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, "Use a version like 1.2.0").optional(),
    segments: z.array(z.enum(SEGMENTS)).max(SEGMENTS.length).optional(),
    signedUpBefore: z.string().datetime({ offset: true }).optional(),
    allowUserIds: z.array(z.string().uuid()).max(500).optional(),
    denyUserIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict()
  .refine((t) => !t.segments?.includes("signed_up_before") || Boolean(t.signedUpBefore), { message: "Add the sign-up date for that segment.", path: ["signedUpBefore"] });

/** 0..99, the same for the same flag and person forever. */
export function bucket(flagKey: string, userId: string): number {
  const digest = createHash("sha256").update(`${flagKey}:${userId}`).digest();
  return Number(digest.readBigUInt64BE(0) % 100n);
}

export function inWindow(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  if (startsAt && now.getTime() < startsAt.getTime()) return false;
  if (endsAt && now.getTime() >= endsAt.getTime()) return false;
  return true;
}

const DAY = 86_400_000;

function segmentMatches(segment: (typeof SEGMENTS)[number], t: FlagTargeting, ctx: EvalContext): boolean {
  switch (segment) {
    case "admins":
      return ctx.isAdmin;
    case "new_users_30d":
      return Boolean(ctx.userCreatedAt && ctx.now.getTime() - ctx.userCreatedAt.getTime() <= 30 * DAY);
    case "signed_up_before":
      return Boolean(ctx.userCreatedAt && t.signedUpBefore && ctx.userCreatedAt.getTime() < new Date(t.signedUpBefore).getTime());
    case "beta":
      // No beta programme exists yet, so nobody is in it.
      return false;
  }
}

/**
 * Allow/deny lists, platform, app version and segments (no rollout). Used for announcements too.
 * "allow" means an allow-list match that skips the remaining checks.
 */
export function targetingDecision(t: FlagTargeting, ctx: EvalContext): "deny" | "allow" | "match" | "no_match" {
  if (ctx.userId && t.denyUserIds?.includes(ctx.userId)) return "deny";
  if (ctx.userId && t.allowUserIds?.includes(ctx.userId)) return "allow";
  if (t.platforms?.length && (!ctx.platform || !t.platforms.includes(ctx.platform))) return "no_match";
  if (t.minAppVersion || t.maxAppVersion) {
    if (!ctx.appVersion) return "no_match";
    if (t.minAppVersion && compareVersions(ctx.appVersion, t.minAppVersion) < 0) return "no_match";
    if (t.maxAppVersion && compareVersions(ctx.appVersion, t.maxAppVersion) > 0) return "no_match";
  }
  if (t.segments?.length) {
    if (!ctx.userId) return "no_match";
    if (!t.segments.some((s) => segmentMatches(s, t, ctx))) return "no_match";
  }
  return "match";
}

/** One flag for one person. A row whose key is not in the registry is ignored; no row means the default. */
export function evaluateFlag(key: string, row: FlagRow | null | undefined, ctx: EvalContext): boolean {
  const def = FLAGS.get(key);
  if (!def) return false;
  if (!row || row.archivedAt) return def.default;
  if (!row.enabled || !inWindow(row.startsAt, row.endsAt, ctx.now)) return false;
  const decision = targetingDecision(row.targeting ?? {}, ctx);
  if (decision === "deny" || decision === "no_match") return false;
  if (decision === "allow") return true;
  if (!ctx.userId) return row.rolloutPercent >= 100;
  return bucket(key, ctx.userId) < Math.max(0, Math.min(100, row.rolloutPercent));
}

/** Every registered flag for one person. */
export function evaluateAll(rows: readonly FlagRow[], ctx: EvalContext): Record<string, boolean> {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: Record<string, boolean> = {};
  for (const key of FLAGS.keys()) out[key] = evaluateFlag(key, byKey.get(key), ctx);
  return out;
}
