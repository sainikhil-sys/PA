import "server-only";
import { and, desc, eq, gt, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, rowsOf, schema } from "@/lib/db";
import { RESTRICTABLE_FEATURES } from "@/lib/db/schema";
import { emailHash, ipPrefix } from "./core";
import { isActiveRestriction } from "./restrictions";

/**
 * Fixed, typed queries for the Users pages and /api/admin/users. Account metadata and counts only:
 * never message, email, note, memory or document content (docs/ADMIN_CONSOLE_PROPOSAL.md 2.8).
 */

export const USERS_PAGE_SIZE = 25;

/** Filters arrive as query-string values, so everything is a string and validated here. */
export const userSearchSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  status: z.enum(["all", "active", "suspended"]).optional().default("all"),
  restricted: z
    .enum(["", "any", ...RESTRICTABLE_FEATURES])
    .optional()
    .default(""),
  platform: z.enum(["", "web", "android"]).optional().default(""),
  appVersion: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\w.+-]*$/, "Use a version like 1.4.0")
    .optional()
    .default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});
export type UserSearch = z.infer<typeof userSearchSchema>;

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A live session: not revoked and not expired. */
const liveSession = sql`${schema.sessions.revokedAt} is null and ${schema.sessions.expiresAt} > now()`;
const activeRestriction = sql`${schema.userRestrictions.liftedAt} is null and (${schema.userRestrictions.expiresAt} is null or ${schema.userRestrictions.expiresAt} > now())`;

export async function searchUsers(input: UserSearch) {
  const u = schema.users;
  const conds: SQL[] = [];
  if (input.q) {
    const pat = `%${escapeLike(input.q)}%`;
    conds.push(or(ilike(u.email, pat), ilike(u.name, pat))!);
  }
  if (input.status === "suspended") conds.push(isNotNull(u.disabledAt));
  if (input.status === "active") conds.push(isNull(u.disabledAt));
  if (input.restricted) {
    const feature = input.restricted === "any" ? sql`` : sql`and ${schema.userRestrictions.feature} = ${input.restricted}`;
    conds.push(sql`exists (select 1 from ${schema.userRestrictions} where ${schema.userRestrictions.userId} = ${u.id} and ${activeRestriction} ${feature})`);
  }
  if (input.platform || input.appVersion) {
    const p = input.platform ? sql`and ${schema.sessions.platform} = ${input.platform}` : sql``;
    const v = input.appVersion ? sql`and ${schema.sessions.appVersion} = ${input.appVersion}` : sql``;
    conds.push(sql`exists (select 1 from ${schema.sessions} where ${schema.sessions.userId} = ${u.id} and ${liveSession} ${p} ${v})`);
  }
  const offset = (input.page - 1) * USERS_PAGE_SIZE;
  const rows = await db()
    .select({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      disabledAt: u.disabledAt,
      onboardedAt: u.onboardedAt,
      lastSeen: sql<string | null>`(select max(${schema.sessions.lastSeenAt}) from ${schema.sessions} where ${schema.sessions.userId} = ${u.id})`,
      platforms: sql<string[] | null>`array(select distinct ${schema.sessions.platform} from ${schema.sessions} where ${schema.sessions.userId} = ${u.id} and ${schema.sessions.platform} is not null and ${liveSession})`,
      appVersion: sql<
        string | null
      >`(select ${schema.sessions.appVersion} from ${schema.sessions} where ${schema.sessions.userId} = ${u.id} and ${schema.sessions.appVersion} is not null order by ${schema.sessions.lastSeenAt} desc limit 1)`,
      restrictions: sql<number>`(select count(*)::int from ${schema.userRestrictions} where ${schema.userRestrictions.userId} = ${u.id} and ${activeRestriction})`,
      total: sql<number>`count(*) over()::int`,
    })
    .from(u)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(u.createdAt), u.id)
    .limit(USERS_PAGE_SIZE)
    .offset(offset);
  const total = Number(rows[0]?.total ?? 0);
  return {
    page: input.page,
    pageSize: USERS_PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
    rows: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
      disabledAt: r.disabledAt?.toISOString() ?? null,
      onboardedAt: r.onboardedAt?.toISOString() ?? null,
      lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
      platforms: (r.platforms ?? []).filter(Boolean),
      appVersion: r.appVersion,
      restrictions: Number(r.restrictions ?? 0),
    })),
  };
}
export type UserSearchResult = Awaited<ReturnType<typeof searchUsers>>;

/** App versions seen on live sessions, for the version filter. */
export async function appVersionsSeen(): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ v: schema.sessions.appVersion })
    .from(schema.sessions)
    .where(and(isNotNull(schema.sessions.appVersion), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
    .limit(50);
  return rows
    .map((r) => r.v!)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .slice(0, 30);
}

/** "Chrome on Windows", "Cowork app on Android". Never the raw string, which can be long and identifying. */
export function summarizeUserAgent(ua: string | null | undefined, platform?: string | null): string {
  const s = ua ?? "";
  if (platform === "android" || /okhttp|Dalvik|Expo|ReactNative|CFNetwork/i.test(s)) return "Cowork app on Android";
  if (!s) return "Unknown device";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : /curl|node|undici/i.test(s) ? "Script" : "Browser";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iOS/.test(s) ? "iOS" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}

const AUDIT_LIMIT = 50;

/** Everything the detail page shows. Null when the account doesn't exist. */
export async function userDetail(userId: string) {
  const [user] = await db()
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, createdAt: schema.users.createdAt, onboardedAt: schema.users.onboardedAt, disabledAt: schema.users.disabledAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;
  const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [sessions, restrictions, counts, audit, role, deletion] = await Promise.all([
    db()
      .select({
        id: schema.sessions.id,
        userAgent: schema.sessions.userAgent,
        ipPrefix: schema.sessions.ipPrefix,
        platform: schema.sessions.platform,
        appVersion: schema.sessions.appVersion,
        appBuild: schema.sessions.appBuild,
        lastSeenAt: schema.sessions.lastSeenAt,
        createdAt: schema.sessions.createdAt,
      })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
      .orderBy(desc(schema.sessions.lastSeenAt))
      .limit(30),
    db()
      .select({
        id: schema.userRestrictions.id,
        feature: schema.userRestrictions.feature,
        reason: schema.userRestrictions.reason,
        expiresAt: schema.userRestrictions.expiresAt,
        createdAt: schema.userRestrictions.createdAt,
        liftedAt: schema.userRestrictions.liftedAt,
      })
      .from(schema.userRestrictions)
      .where(eq(schema.userRestrictions.userId, userId))
      .orderBy(desc(schema.userRestrictions.createdAt))
      .limit(30),
    db().execute(sql`
      select
        (select count(*) from ${schema.phoneDevices} where ${schema.phoneDevices.userId} = ${userId} and ${schema.phoneDevices.revokedAt} is null)::int as paired_phones,
        (select count(*) from ${schema.pushSubscriptions} where ${schema.pushSubscriptions.userId} = ${userId})::int as push_devices,
        (select count(*) from ${schema.integrations} where ${schema.integrations.userId} = ${userId} and ${schema.integrations.status} = 'connected')::int as integrations,
        (select count(*) from ${schema.conversations} where ${schema.conversations.userId} = ${userId})::int as conversations,
        (select count(*) from ${schema.messages} where ${schema.messages.userId} = ${userId})::int as messages,
        (select count(*) from ${schema.tasks} where ${schema.tasks.userId} = ${userId})::int as tasks,
        (select count(*) from ${schema.notes} where ${schema.notes.userId} = ${userId})::int as notes,
        (select count(*) from ${schema.memories} where ${schema.memories.userId} = ${userId})::int as memories,
        (select count(*) from ${schema.knowledgeItems} where ${schema.knowledgeItems.userId} = ${userId})::int as documents,
        (select count(*) from ${schema.automations} where ${schema.automations.userId} = ${userId})::int as automations,
        (select count(*) from ${schema.automationRuns} where ${schema.automationRuns.userId} = ${userId} and ${schema.automationRuns.createdAt} >= ${d30}::timestamptz)::int as automation_runs30,
        (select count(*) from ${schema.aiRuns} where ${schema.aiRuns.userId} = ${userId} and ${schema.aiRuns.createdAt} >= ${d30}::timestamptz)::int as ai_runs30,
        (select coalesce(sum(${schema.aiRuns.inputTokens} + ${schema.aiRuns.outputTokens}), 0) from ${schema.aiRuns} where ${schema.aiRuns.userId} = ${userId} and ${schema.aiRuns.createdAt} >= ${d30}::timestamptz)::bigint as tokens30
    `),
    db()
      .select({
        seq: schema.adminAuditLogs.seq,
        createdAt: schema.adminAuditLogs.createdAt,
        action: schema.adminAuditLogs.action,
        actorRole: schema.adminAuditLogs.actorRole,
        actorEmail: schema.users.email,
        outcome: schema.adminAuditLogs.outcome,
        reason: schema.adminAuditLogs.reason,
      })
      .from(schema.adminAuditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.adminAuditLogs.actorUserId))
      .where(and(eq(schema.adminAuditLogs.resourceType, "user"), eq(schema.adminAuditLogs.resourceId, userId)))
      .orderBy(desc(schema.adminAuditLogs.seq))
      .limit(AUDIT_LIMIT),
    db()
      .select({ role: schema.adminRoleAssignments.role })
      .from(schema.adminRoleAssignments)
      .where(and(eq(schema.adminRoleAssignments.userId, userId), isNull(schema.adminRoleAssignments.revokedAt)))
      .limit(1),
    db()
      .select({ id: schema.accountDeletionRequests.id, status: schema.accountDeletionRequests.status, dueBy: schema.accountDeletionRequests.dueBy, createdAt: schema.accountDeletionRequests.createdAt })
      .from(schema.accountDeletionRequests)
      .where(or(eq(schema.accountDeletionRequests.userId, userId), eq(schema.accountDeletionRequests.emailHash, emailHash(user.email))))
      .orderBy(desc(schema.accountDeletionRequests.createdAt))
      .limit(10),
  ]);

  const c = rowsOf<Record<string, number | string | null>>(counts)[0] ?? {};
  const n = (k: string) => Number(c[k] ?? 0);
  const now = new Date();
  return {
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
      onboardedAt: user.onboardedAt?.toISOString() ?? null,
      disabledAt: user.disabledAt?.toISOString() ?? null,
      adminRole: role[0]?.role ?? null,
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      device: summarizeUserAgent(s.userAgent, s.platform),
      platform: s.platform,
      appVersion: s.appVersion ? `${s.appVersion}${s.appBuild ? ` (${s.appBuild})` : ""}` : null,
      network: ipPrefix(s.ipPrefix),
      lastSeenAt: s.lastSeenAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
    restrictions: restrictions.map((r) => ({
      id: r.id,
      feature: r.feature,
      reason: r.reason,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      liftedAt: r.liftedAt?.toISOString() ?? null,
      active: isActiveRestriction(r, now),
    })),
    usage: {
      pairedPhones: n("paired_phones"),
      pushDevices: n("push_devices"),
      integrations: n("integrations"),
      conversations: n("conversations"),
      messages: n("messages"),
      tasks: n("tasks"),
      notes: n("notes"),
      memories: n("memories"),
      documents: n("documents"),
      automations: n("automations"),
      automationRuns30: n("automation_runs30"),
      aiRuns30: n("ai_runs30"),
      tokens30: n("tokens30"),
    },
    audit: audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    deletionRequests: deletion.map((d) => ({ ...d, dueBy: d.dueBy.toISOString(), createdAt: d.createdAt.toISOString() })),
  };
}
export type UserDetail = NonNullable<Awaited<ReturnType<typeof userDetail>>>;
