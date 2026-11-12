import "server-only";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { FlagTargeting, User } from "@/lib/db/schema";
import { targetingDecision, type EvalContext } from "@/lib/flags/evaluate";
import { evaluateFlagsFor, flagContext } from "@/lib/flags/store";
import { DEFAULT_MAINTENANCE_MESSAGE, maintenanceFrom, publicSettings, updatePolicySchema, updateStatus, DEFAULT_UPDATE_POLICY } from "./registry";
import { getConfigSnapshot } from "./store";
import { readClientHeaders } from "./version";

/** What GET /api/config returns and the web layout reads (docs/ADMIN_CONSOLE_PROPOSAL.md 4.2). */

export type ClientAnnouncement = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  placement: "banner" | "home_card";
  href: string | null;
  dismissible: boolean;
};

export type ClientConfig = {
  configVersion: number;
  maintenance: { active: boolean; message: string | null; endsAt: string | null };
  update: { status: "ok" | "optional" | "required"; latestVersion: string | null; message: string | null; storeUrl: string | null };
  announcements: ClientAnnouncement[];
  settings: Record<string, unknown>;
  flags?: Record<string, boolean>;
  restrictions?: { feature: string; expiresAt: string | null }[];
};

/** Announcements live now, not archived. Small table; targeting is applied in code. */
async function liveAnnouncements(now: Date) {
  return db()
    .select({
      id: schema.systemAnnouncements.id,
      title: schema.systemAnnouncements.title,
      body: schema.systemAnnouncements.body,
      severity: schema.systemAnnouncements.severity,
      placement: schema.systemAnnouncements.placement,
      href: schema.systemAnnouncements.href,
      dismissible: schema.systemAnnouncements.dismissible,
      targeting: schema.systemAnnouncements.targeting,
      startsAt: schema.systemAnnouncements.startsAt,
    })
    .from(schema.systemAnnouncements)
    .where(
      and(
        isNull(schema.systemAnnouncements.archivedAt),
        lte(schema.systemAnnouncements.startsAt, now),
        or(isNull(schema.systemAnnouncements.endsAt), gt(schema.systemAnnouncements.endsAt, now)),
      ),
    )
    .orderBy(schema.systemAnnouncements.startsAt)
    .limit(50);
}

/** True when an announcement has no audience limits, so it may be shown without a session. */
function isPublicTargeting(t: FlagTargeting): boolean {
  return !t.allowUserIds?.length && !t.segments?.length;
}

function toClient(a: Awaited<ReturnType<typeof liveAnnouncements>>[number]): ClientAnnouncement {
  return { id: a.id, title: a.title, body: a.body, severity: a.severity, placement: a.placement, href: a.href, dismissible: a.dismissible };
}

/** Announcements for this person on this client, without the ones they dismissed. */
export async function announcementsFor(ctx: EvalContext): Promise<ClientAnnouncement[]> {
  const now = ctx.now;
  const list = await liveAnnouncements(now);
  if (!list.length) return [];
  const dismissed = ctx.userId
    ? new Set(
        (
          await db()
            .select({ id: schema.announcementDismissals.announcementId })
            .from(schema.announcementDismissals)
            .where(eq(schema.announcementDismissals.userId, ctx.userId))
        ).map((r) => r.id),
      )
    : new Set<string>();
  return list
    .filter((a) => !(a.dismissible && dismissed.has(a.id)))
    .filter((a) => {
      const t = a.targeting ?? {};
      if (!ctx.userId && !isPublicTargeting(t)) return false;
      const d = targetingDecision(t, ctx);
      return d === "allow" || d === "match";
    })
    .map(toClient);
}

/** This person's restrictions in force now. The admin's reason stays in the console. */
export async function activeRestrictions(userId: string, now = new Date()) {
  const rows = await db()
    .select({ feature: schema.userRestrictions.feature, expiresAt: schema.userRestrictions.expiresAt })
    .from(schema.userRestrictions)
    .where(and(eq(schema.userRestrictions.userId, userId), isNull(schema.userRestrictions.liftedAt), or(isNull(schema.userRestrictions.expiresAt), gt(schema.userRestrictions.expiresAt, now))));
  return rows.map((r) => ({ feature: r.feature, expiresAt: r.expiresAt?.toISOString() ?? null }));
}

/** Builds the client configuration. Without a user: the public subset only. */
export async function buildClientConfig(user: Pick<User, "id" | "createdAt" | "disabledAt"> | null, h: Pick<Headers, "get">): Promise<ClientConfig> {
  const snap = await getConfigSnapshot();
  const m = maintenanceFrom(snap.values);
  const policyParsed = updatePolicySchema.safeParse(snap.values.get("updates.android"));
  const policy = policyParsed.success ? policyParsed.data : DEFAULT_UPDATE_POLICY;
  const client = readClientHeaders(h);
  const bearer = /^Bearer /.test(h.get("authorization") ?? "");
  const android = client.platform === "android" || (client.platform === null && bearer);
  const status = android ? updateStatus(policy, client.build) : "ok";

  const ctx: EvalContext = user
    ? await flagContext(user, h)
    : { userId: null, platform: client.platform ?? (bearer ? "android" : "web"), appVersion: client.appVersion, isAdmin: false, userCreatedAt: null, now: new Date() };

  const [announcements, flags, restrictions] = await Promise.all([
    // A failing source leaves its part empty; the rest of the configuration still answers.
    announcementsFor(ctx).catch(() => []),
    user ? evaluateFlagsFor(ctx) : Promise.resolve(undefined),
    user ? activeRestrictions(user.id, ctx.now).catch(() => []) : Promise.resolve(undefined),
  ]);

  return {
    configVersion: snap.configVersion,
    maintenance: { active: m.active, message: m.active ? (m.message ?? DEFAULT_MAINTENANCE_MESSAGE) : null, endsAt: m.active ? m.endsAt : null },
    update: {
      status,
      latestVersion: policy.latestVersion,
      message: status === "ok" ? null : policy.message,
      storeUrl: policy.storeUrl,
    },
    announcements,
    settings: publicSettings(snap.values),
    ...(flags ? { flags } : {}),
    ...(restrictions ? { restrictions } : {}),
  };
}
