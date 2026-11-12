import "server-only";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveBroadcastFiles, linkFilesToBroadcast } from "@/lib/admin/broadcast-files";
import { UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import type { BroadcastEmailContent, FlagTargeting } from "@/lib/db/schema";
import { safeMailUrl } from "@/lib/email/broadcast";
import { appUrl } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { adminOp } from "../op";
import { sendBroadcastOp } from "./legacy";

/**
 * Announcements: persistent banners or home cards with a time window and targeting. This module only
 * manages the rows; /api/config delivers them, using announcementStatus / announcementTargets below.
 * Also: broadcasts scheduled for later, through the job queue (jobs.run_at), with no schema change.
 */

const uuid = z.string().uuid();
const DAY = 86_400_000;

// ---------- Pure rules (unit tested; reused by the delivery side) ----------

export type AnnouncementStatus = "scheduled" | "live" | "ended" | "archived";
type Window = { startsAt: Date | string; endsAt: Date | string | null; archivedAt: Date | string | null };

export function announcementStatus(a: Window, now: Date = new Date()): AnnouncementStatus {
  if (a.archivedAt) return "archived";
  const t = now.getTime();
  if (new Date(a.startsAt).getTime() > t) return "scheduled";
  if (a.endsAt && new Date(a.endsAt).getTime() <= t) return "ended";
  return "live";
}

/** Numeric dotted comparison: "1.10.0" > "1.9.2". Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export type AudienceClient = {
  userId: string;
  platform: "web" | "android" | null;
  appVersion: string | null;
  signedUpAt: Date;
  isAdmin: boolean;
  /** Set by the caller when a beta group exists; false otherwise. */
  isBeta?: boolean;
};

/**
 * Who sees it. Empty targeting means everyone. Deny wins, then the allow list, then every other rule
 * must hold. Segments match when the person is in ANY listed segment. A version range needs a client
 * that reports its version (the app), so the website never matches one.
 */
export function announcementTargets(t: FlagTargeting, c: AudienceClient, now: Date = new Date()): boolean {
  if (t.denyUserIds?.includes(c.userId)) return false;
  if (t.allowUserIds?.includes(c.userId)) return true;
  if (t.platforms?.length && (!c.platform || !t.platforms.includes(c.platform))) return false;
  if (t.minAppVersion && (!c.appVersion || compareVersions(c.appVersion, t.minAppVersion) < 0)) return false;
  if (t.maxAppVersion && (!c.appVersion || compareVersions(c.appVersion, t.maxAppVersion) > 0)) return false;
  if (t.segments?.length) {
    const inSegment = t.segments.some((s) => {
      if (s === "admins") return c.isAdmin;
      if (s === "beta") return Boolean(c.isBeta);
      if (s === "new_users_30d") return now.getTime() - c.signedUpAt.getTime() <= 30 * DAY;
      if (s === "signed_up_before") return Boolean(t.signedUpBefore) && c.signedUpAt.getTime() < new Date(t.signedUpBefore!).getTime();
      return false;
    });
    if (!inSegment) return false;
  }
  return true;
}

/** Live, targeted at this person, and not dismissed (a dismissal only hides dismissible ones). */
export function visibleAnnouncements<A extends Window & { id: string; targeting: FlagTargeting; dismissible: boolean }>(rows: readonly A[], c: AudienceClient, dismissed: ReadonlySet<string>, now: Date = new Date()): A[] {
  return rows.filter((a) => announcementStatus(a, now) === "live" && announcementTargets(a.targeting ?? {}, c, now) && !(a.dismissible && dismissed.has(a.id)));
}

// ---------- Input ----------

/** Same rule as broadcasts: an in-app path, never an external link. */
const inAppPath = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/(?!\/)[\w\-/?=&.#]*$/, "Use an in-app path like /settings");
const version = z
  .string()
  .trim()
  .max(40)
  .regex(/^\d+(\.\d+){0,3}$/, "Use a version like 1.4.0");

export const targetingSchema = z
  .object({
    platforms: z.array(z.enum(["web", "android"])).max(2).optional(),
    minAppVersion: version.optional().or(z.literal("")),
    maxAppVersion: version.optional().or(z.literal("")),
    segments: z.array(z.enum(["admins", "beta", "new_users_30d", "signed_up_before"])).max(4).optional(),
    signedUpBefore: z.coerce.date().optional().nullable(),
    allowUserIds: z.array(uuid).max(200).optional(),
    denyUserIds: z.array(uuid).max(200).optional(),
  })
  .default({})
  .refine((t) => !t.segments?.includes("signed_up_before") || Boolean(t.signedUpBefore), "Pick the sign-up date for the \"signed up before\" segment")
  .refine((t) => !t.minAppVersion || !t.maxAppVersion || compareVersions(t.minAppVersion, t.maxAppVersion) <= 0, "The lowest version must not be above the highest")
  .transform((t): FlagTargeting => {
    const out: FlagTargeting = {};
    if (t.platforms?.length) out.platforms = [...new Set(t.platforms)];
    if (t.minAppVersion) out.minAppVersion = t.minAppVersion;
    if (t.maxAppVersion) out.maxAppVersion = t.maxAppVersion;
    if (t.segments?.length) out.segments = [...new Set(t.segments)];
    if (t.signedUpBefore && t.segments?.includes("signed_up_before")) out.signedUpBefore = t.signedUpBefore.toISOString();
    if (t.allowUserIds?.length) out.allowUserIds = [...new Set(t.allowUserIds)];
    if (t.denyUserIds?.length) out.denyUserIds = [...new Set(t.denyUserIds)];
    return out;
  });

const fields = z
  .object({
    title: z.string().trim().min(3, "Add a title").max(120),
    body: z.string().trim().min(3, "Add the message").max(600),
    severity: z.enum(["info", "warning", "critical"]).default("info"),
    placement: z.enum(["banner", "home_card"]).default("banner"),
    href: inAppPath.optional().or(z.literal("")).nullable(),
    dismissible: z.boolean().default(true),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    targeting: targetingSchema,
  })
  .refine((a) => !a.endsAt || a.endsAt.getTime() > (a.startsAt ?? new Date()).getTime(), "The end must be after the start")
  .refine((a) => !a.startsAt || a.startsAt.getTime() < Date.now() + 366 * DAY, "Start within the next year");

type Fields = z.infer<typeof fields>;
const toRow = (f: Fields, startsAt: Date) => ({
  title: f.title,
  body: f.body,
  severity: f.severity,
  placement: f.placement,
  href: f.href || null,
  dismissible: f.dismissible,
  startsAt,
  endsAt: f.endsAt ?? null,
  targeting: f.targeting,
});
const auditView = (r: { title: string; severity: string; placement: string; href: string | null; dismissible: boolean; startsAt: Date; endsAt: Date | null; targeting: FlagTargeting; archivedAt?: Date | null }) => ({
  title: r.title,
  severity: r.severity,
  placement: r.placement,
  href: r.href,
  dismissible: r.dismissible,
  startsAt: r.startsAt.toISOString(),
  endsAt: r.endsAt?.toISOString() ?? null,
  targeting: r.targeting,
  archived: Boolean(r.archivedAt),
});

// ---------- Ops ----------

export async function listAnnouncements() {
  const a = schema.systemAnnouncements;
  const rows = await db()
    .select({
      id: a.id,
      title: a.title,
      body: a.body,
      severity: a.severity,
      placement: a.placement,
      href: a.href,
      targeting: a.targeting,
      dismissible: a.dismissible,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      createdAt: a.createdAt,
      archivedAt: a.archivedAt,
      dismissals: sql<number>`(select count(*)::int from ${schema.announcementDismissals} where ${schema.announcementDismissals.announcementId} = ${a.id})`,
    })
    .from(a)
    .where(or(isNull(a.archivedAt), gt(a.archivedAt, new Date(Date.now() - 30 * DAY))))
    .orderBy(desc(a.startsAt))
    .limit(100);
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    status: announcementStatus(r, now),
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    archivedAt: r.archivedAt?.toISOString() ?? null,
  }));
}
export type AnnouncementRow = Awaited<ReturnType<typeof listAnnouncements>>[number];

export const listAnnouncementsOp = adminOp({
  action: "announcement.list",
  resourceType: "announcement",
  permission: "notifications.send",
  kind: "read",
  input: z.object({}),
  run: () => listAnnouncements(),
});

export const createAnnouncementOp = adminOp({
  action: "announcement.create",
  resourceType: "announcement",
  permission: "notifications.send",
  kind: "write",
  input: fields,
  run: async (input, { user, tx, record }) => {
    const startsAt = input.startsAt ?? new Date();
    if (input.endsAt && input.endsAt.getTime() <= Date.now()) throw new UserFacingError("The end time has already passed.");
    const [row] = await tx
      .insert(schema.systemAnnouncements)
      .values({ ...toRow(input, startsAt), createdBy: user.id })
      .returning();
    record({ resourceId: row!.id, after: auditView(row!) });
    return { id: row!.id, status: announcementStatus(row!) };
  },
});

export const updateAnnouncementOp = adminOp({
  action: "announcement.update",
  resourceType: "announcement",
  permission: "notifications.send",
  kind: "write",
  input: z.intersection(z.object({ id: uuid }), fields),
  run: async (input, { tx, record }) => {
    const [before] = await tx.select().from(schema.systemAnnouncements).where(eq(schema.systemAnnouncements.id, input.id)).limit(1);
    if (!before) throw new UserFacingError("That announcement no longer exists.");
    if (before.archivedAt) throw new UserFacingError("Archived announcements can't be edited. Create a new one.");
    const [after] = await tx
      .update(schema.systemAnnouncements)
      .set(toRow(input, input.startsAt ?? before.startsAt))
      .where(eq(schema.systemAnnouncements.id, input.id))
      .returning();
    record({ resourceId: input.id, before: auditView(before), after: auditView(after!) });
    return { id: input.id, status: announcementStatus(after!) };
  },
});

/** Takes it down everywhere at once. Archived rows stay for the record. */
export const archiveAnnouncementOp = adminOp({
  action: "announcement.archive",
  resourceType: "announcement",
  permission: "notifications.send",
  kind: "write",
  input: z.object({ id: uuid }),
  run: async ({ id }, { tx, record }) => {
    const [before] = await tx.select().from(schema.systemAnnouncements).where(eq(schema.systemAnnouncements.id, id)).limit(1);
    if (!before) throw new UserFacingError("That announcement no longer exists.");
    if (before.archivedAt) throw new UserFacingError("That announcement is already archived.");
    await tx.update(schema.systemAnnouncements).set({ archivedAt: new Date() }).where(eq(schema.systemAnnouncements.id, id));
    record({ resourceId: id, before: { status: announcementStatus(before) }, after: { status: "archived" } });
  },
});

// ---------- Scheduled broadcasts (job queue, no schema change) ----------

/** Same checks as an immediate send. */
function checkEmailLinks(email: BroadcastEmailContent, base: string) {
  for (const b of email.blocks) {
    if (b.type === "button" && !safeMailUrl(b.url, base)) throw new UserFacingError(`The "${b.label}" button needs a link that starts with https:// or an app path like /settings.`);
    if (b.type === "image" && b.href && !safeMailUrl(b.href, base)) throw new UserFacingError("An image link isn't valid. Use https://… or an app path like /settings.");
  }
}

const sendAt = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now() + 5 * 60_000, "Pick a time at least 5 minutes from now")
  .refine((d) => d.getTime() < Date.now() + 60 * DAY, "Pick a time within 60 days");

/**
 * Saves the broadcast as queued and puts its first job on the queue at `sendAt`. The dispatcher then
 * runs it exactly like an immediate send (lib/admin/broadcast.ts, resumable, respects preferences).
 */
export const scheduleBroadcastOp = adminOp({
  action: "broadcast.schedule",
  resourceType: "broadcast",
  permission: "notifications.send",
  kind: "write",
  // linkFilesToBroadcast and the queue use their own connections, as in broadcast.send.
  transaction: false,
  input: sendBroadcastOp.input.omit({ confirm: true }).extend({ sendAt }),
  run: async (input, { user, tx, record }) => {
    const email = input.channels.includes("email") && input.email ? input.email : null;
    if (email) checkEmailLinks(email, appUrl());
    const files = await resolveBroadcastFiles(user.id, email, email ? input.attachmentIds : []);
    const [b] = await tx
      .insert(schema.broadcasts)
      .values({ createdBy: user.id, title: input.title, body: input.body, href: input.href || null, channels: input.channels, email, status: "queued" })
      .returning({ id: schema.broadcasts.id });
    await linkFilesToBroadcast(
      user.id,
      files.map((f) => f.id),
      b!.id,
    );
    const jobId = await enqueue(user.id, "broadcast", { broadcastId: b!.id }, { dedupeKey: `broadcast:${b!.id}:start`, runAt: input.sendAt });
    if (!jobId) throw new UserFacingError("Couldn't schedule it. Try again.");
    record({ resourceId: b!.id, after: { title: input.title, channels: input.channels, files: files.length, sendAt: input.sendAt.toISOString() } });
    return { id: b!.id, sendAt: input.sendAt.toISOString() };
  },
});

const pendingJobFor = (broadcastId: string) =>
  and(eq(schema.jobs.type, "broadcast"), eq(schema.jobs.status, "pending"), sql`${schema.jobs.payload}->>'broadcastId' = ${broadcastId}`);

export async function listScheduledBroadcasts() {
  const rows = await db()
    .select({ id: schema.broadcasts.id, title: schema.broadcasts.title, channels: schema.broadcasts.channels, sendAt: schema.jobs.runAt, createdAt: schema.broadcasts.createdAt })
    .from(schema.broadcasts)
    .innerJoin(schema.jobs, and(eq(schema.jobs.type, "broadcast"), eq(schema.jobs.status, "pending"), sql`${schema.jobs.payload}->>'broadcastId' = ${schema.broadcasts.id}::text`))
    .where(and(eq(schema.broadcasts.status, "queued"), gt(schema.jobs.runAt, new Date())))
    .orderBy(schema.jobs.runAt)
    .limit(50);
  return rows.map((r) => ({ ...r, sendAt: r.sendAt.toISOString(), createdAt: r.createdAt.toISOString() }));
}
export type ScheduledBroadcastRow = Awaited<ReturnType<typeof listScheduledBroadcasts>>[number];

export const listScheduledBroadcastsOp = adminOp({
  action: "broadcast.scheduled_list",
  resourceType: "broadcast",
  permission: "notifications.send",
  kind: "read",
  input: z.object({}),
  run: () => listScheduledBroadcasts(),
});

/** Only before it starts: a broadcast that is already sending can't be pulled back. */
export const cancelScheduledBroadcastOp = adminOp({
  action: "broadcast.cancel",
  resourceType: "broadcast",
  permission: "notifications.send",
  kind: "write",
  input: z.object({ id: uuid }),
  run: async ({ id }, { tx, record }) => {
    const [b] = await tx.select({ status: schema.broadcasts.status, cursor: schema.broadcasts.cursor }).from(schema.broadcasts).where(eq(schema.broadcasts.id, id)).limit(1);
    if (!b) throw new UserFacingError("That broadcast no longer exists.");
    if (b.status !== "queued" || b.cursor) throw new UserFacingError("It has already started sending, so it can't be cancelled.");
    await tx.update(schema.broadcasts).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(schema.broadcasts.id, id), eq(schema.broadcasts.status, "queued")));
    await tx.delete(schema.jobs).where(pendingJobFor(id));
    record({ resourceId: id, before: { status: "queued" }, after: { status: "cancelled" } });
  },
});
