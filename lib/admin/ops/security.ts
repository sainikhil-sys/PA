import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { revokeAdminSessions } from "../admin-session";
import { verifyAuditChain } from "../audit";
import { ADMIN_IDLE_MS, emailHash } from "../core";
import { alertOwner } from "../emails";
import { adminOp } from "../op";
import type { AdminRole } from "../permissions";

/**
 * Security centre (docs/ADMIN_CONSOLE_PROPOSAL.md 2.4, 2.6, 6 row J): role holders, admin sessions,
 * failed step-ups, role management, two-step reset, and the audit log viewer and export.
 * The owner role is never granted, changed or revoked here: ownership moves only with
 * scripts/admin-bootstrap.mjs --transfer, run on the server.
 */

const uuid = z.string().uuid();

/** Roles the owner may hand out from the console. Never "owner". */
export const ASSIGNABLE_ROLES = ["admin", "moderator", "support", "analyst"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export const ROLE_LABEL: Record<AdminRole, string> = { owner: "Owner", admin: "Admin", moderator: "Moderator", support: "Support", analyst: "Analyst" };

const OWNER_ONLY_MSG = "That person is the owner. Ownership moves only with the bootstrap script on the server (--transfer).";

/**
 * Why a role change is refused, or null when it may go ahead. Pure, so it is unit tested.
 * `current` is the target's active role (null when none); `next` is the new role (null to revoke).
 */
export function roleChangeProblem(o: { actorId: string; targetId: string; current: AdminRole | null; next: AdminRole | null; mode: "grant" | "change" | "revoke" }): string | null {
  if (o.actorId === o.targetId) return "You can't change your own role.";
  if (o.next === "owner") return OWNER_ONLY_MSG;
  if (o.current === "owner") return OWNER_ONLY_MSG;
  if (o.mode === "grant" && o.current) return `They already hold the ${ROLE_LABEL[o.current]} role. Change it in the list instead.`;
  if (o.mode !== "grant" && !o.current) return "They don't hold an admin role any more. Refresh the page.";
  if (o.mode === "change" && o.current === o.next) return `They already hold the ${ROLE_LABEL[o.current!]} role.`;
  return null;
}

// ---------- Reads ----------

async function activeRole(userId: string, executor: Pick<ReturnType<typeof db>, "select"> = db()): Promise<{ id: string; role: AdminRole } | null> {
  const [row] = await executor
    .select({ id: schema.adminRoleAssignments.id, role: schema.adminRoleAssignments.role })
    .from(schema.adminRoleAssignments)
    .where(and(eq(schema.adminRoleAssignments.userId, userId), isNull(schema.adminRoleAssignments.revokedAt)))
    .limit(1);
  return row ?? null;
}

async function accountById(userId: string) {
  const [row] = await db().select({ id: schema.users.id, email: schema.users.email, disabledAt: schema.users.disabledAt }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row ?? null;
}

async function openAdminSessionCount(userId: string): Promise<number> {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.adminSessions)
    .where(and(eq(schema.adminSessions.userId, userId), isNull(schema.adminSessions.revokedAt), gt(schema.adminSessions.expiresAt, new Date())));
  return Number(r?.n ?? 0);
}

const ROLE_ORDER = sql`case ${schema.adminRoleAssignments.role} when 'owner' then 0 when 'admin' then 1 when 'support' then 2 when 'moderator' then 3 else 4 end`;

/** Everyone holding an admin role, with two-step status and their latest admin session. */
export async function listRoleHolders() {
  const a = schema.adminRoleAssignments;
  const rows = await db()
    .select({
      userId: a.userId,
      role: a.role,
      since: a.createdAt,
      source: a.source,
      email: schema.users.email,
      disabledAt: schema.users.disabledAt,
      mfaEnabledAt: schema.adminMfa.enabledAt,
      lockedUntil: schema.adminMfa.lockedUntil,
      lastSessionAt: sql<string | null>`(select max(${schema.adminSessions.lastSeenAt}) from ${schema.adminSessions} where ${schema.adminSessions.userId} = ${a.userId})`,
    })
    .from(a)
    .innerJoin(schema.users, eq(schema.users.id, a.userId))
    .leftJoin(schema.adminMfa, eq(schema.adminMfa.userId, a.userId))
    .where(isNull(a.revokedAt))
    .orderBy(ROLE_ORDER, a.createdAt)
    .limit(200);
  const now = Date.now();
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    email: r.email,
    since: r.since.toISOString(),
    source: r.source,
    disabled: Boolean(r.disabledAt),
    mfa: Boolean(r.mfaEnabledAt),
    lockedUntil: r.lockedUntil && r.lockedUntil.getTime() > now ? r.lockedUntil.toISOString() : null,
    lastSessionAt: r.lastSessionAt ? new Date(r.lastSessionAt).toISOString() : null,
  }));
}

/** Admin sessions that can still be used: not revoked, not expired, active within the idle limit. */
export async function listOpenAdminSessions(onlyUserId?: string) {
  const s = schema.adminSessions;
  const now = new Date();
  const rows = await db()
    .select({ id: s.id, userId: s.userId, email: schema.users.email, method: s.method, platform: s.platform, ipPrefix: s.ipPrefix, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, role: schema.adminRoleAssignments.role })
    .from(s)
    .innerJoin(schema.users, eq(schema.users.id, s.userId))
    .leftJoin(schema.adminRoleAssignments, and(eq(schema.adminRoleAssignments.userId, s.userId), isNull(schema.adminRoleAssignments.revokedAt)))
    .where(and(isNull(s.revokedAt), gt(s.expiresAt, now), gt(s.lastSeenAt, new Date(now.getTime() - ADMIN_IDLE_MS)), onlyUserId ? eq(s.userId, onlyUserId) : undefined))
    .orderBy(desc(s.lastSeenAt))
    .limit(100);
  return rows.map((r) => ({ ...r, userAgent: r.userAgent?.slice(0, 120) ?? null, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
}

const STEP_UP_EVENTS = ["admin.step_up_failed", "admin.step_up_locked"] as const;

/** Wrong step-up codes and lockouts (30 days), and who is locked out right now. */
export async function securityEvents() {
  const l = schema.adminAuditLogs;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [events, locked] = await Promise.all([
    db()
      .select({ seq: l.seq, createdAt: l.createdAt, action: l.action, actorUserId: l.actorUserId, actorRole: l.actorRole, email: schema.users.email, ipPrefix: l.ipPrefix, after: l.after })
      .from(l)
      .leftJoin(schema.users, eq(schema.users.id, l.actorUserId))
      .where(and(inArray(l.action, [...STEP_UP_EVENTS]), gte(l.createdAt, since)))
      .orderBy(desc(l.seq))
      .limit(100),
    db()
      .select({ userId: schema.adminMfa.userId, email: schema.users.email, lockedUntil: schema.adminMfa.lockedUntil })
      .from(schema.adminMfa)
      .innerJoin(schema.users, eq(schema.users.id, schema.adminMfa.userId))
      .where(gt(schema.adminMfa.lockedUntil, new Date())),
  ]);
  return {
    events: events.map((e) => ({
      seq: e.seq,
      createdAt: e.createdAt.toISOString(),
      kind: e.action === "admin.step_up_locked" ? ("locked" as const) : ("failed" as const),
      actorUserId: e.actorUserId,
      actorRole: e.actorRole,
      email: e.email,
      ipPrefix: e.ipPrefix,
      failures: typeof (e.after as { failures?: unknown } | null)?.failures === "number" ? (e.after as { failures: number }).failures : null,
    })),
    lockedNow: locked.map((x) => ({ userId: x.userId, email: x.email, lockedUntil: x.lockedUntil!.toISOString() })),
    failed30: events.filter((e) => e.action === "admin.step_up_failed").length,
    locked30: events.filter((e) => e.action === "admin.step_up_locked").length,
  };
}

// ---------- Audit log ----------

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-12");

/** Typed audit filters. No free text reaches SQL except as bound parameters; there is no query language. */
export const auditFilterSchema = z.object({
  actor: z.preprocess(blank, z.union([uuid, z.string().trim().toLowerCase().email().max(320)]).optional()),
  action: z.preprocess(blank, z.string().trim().regex(/^[a-z0-9_.:-]{1,80}$/i, "Use an action name like user.set_disabled or the start of one").optional()),
  resourceType: z.preprocess(blank, z.string().trim().regex(/^[a-z0-9_.-]{1,40}$/i, "Use a resource type like user").optional()),
  resourceId: z.preprocess(blank, z.string().trim().max(100).optional()),
  outcome: z.preprocess(blank, z.enum(["success", "denied", "failed"]).optional()),
  from: z.preprocess(blank, day.optional()),
  to: z.preprocess(blank, day.optional()),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;
export const AUDIT_PAGE_SIZE = 50;
const AUDIT_EXPORT_MAX = 10_000;

export function auditWhere(f: AuditFilters): SQL | undefined {
  const l = schema.adminAuditLogs;
  const conds: (SQL | undefined)[] = [];
  if (f.actor) conds.push(f.actor.includes("@") ? eq(l.actorEmailHash, emailHash(f.actor)) : eq(l.actorUserId, f.actor));
  // Prefix match; "_" is a LIKE wildcard, so it is escaped.
  if (f.action) conds.push(sql`${l.action} like ${f.action.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"}`);
  if (f.resourceType) conds.push(eq(l.resourceType, f.resourceType));
  if (f.resourceId) conds.push(eq(l.resourceId, f.resourceId));
  if (f.outcome) conds.push(eq(l.outcome, f.outcome));
  if (f.from) conds.push(gte(l.createdAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lt(l.createdAt, new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000)));
  return conds.length ? and(...conds) : undefined;
}

const auditListColumns = {
  seq: schema.adminAuditLogs.seq,
  createdAt: schema.adminAuditLogs.createdAt,
  actorUserId: schema.adminAuditLogs.actorUserId,
  actorRole: schema.adminAuditLogs.actorRole,
  actorEmail: schema.users.email,
  action: schema.adminAuditLogs.action,
  resourceType: schema.adminAuditLogs.resourceType,
  resourceId: schema.adminAuditLogs.resourceId,
  outcome: schema.adminAuditLogs.outcome,
  reason: schema.adminAuditLogs.reason,
  ipPrefix: schema.adminAuditLogs.ipPrefix,
};

/** One page of the audit log, newest first. The actor's email is looked up while the account exists. */
export async function queryAudit(f: AuditFilters, page: number) {
  const rows = await db()
    .select(auditListColumns)
    .from(schema.adminAuditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.adminAuditLogs.actorUserId))
    .where(auditWhere(f))
    .orderBy(desc(schema.adminAuditLogs.seq))
    .limit(AUDIT_PAGE_SIZE + 1)
    .offset((page - 1) * AUDIT_PAGE_SIZE);
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), page, hasMore: rows.length > AUDIT_PAGE_SIZE };
}

/** One audit row with its before and after values (already redacted when written). */
export async function auditEntry(seq: number) {
  const [r] = await db()
    .select({ ...auditListColumns, before: schema.adminAuditLogs.before, after: schema.adminAuditLogs.after, userAgent: schema.adminAuditLogs.userAgent, requestId: schema.adminAuditLogs.requestId, adminSessionId: schema.adminAuditLogs.adminSessionId, prevHash: schema.adminAuditLogs.prevHash, hash: schema.adminAuditLogs.hash })
    .from(schema.adminAuditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.adminAuditLogs.actorUserId))
    .where(eq(schema.adminAuditLogs.seq, seq))
    .limit(1);
  return r ? { ...r, createdAt: r.createdAt.toISOString() } : null;
}

/** A CSV cell: quoted when needed, and a leading = + - @ is neutralised so spreadsheets don't run it. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const AUDIT_CSV_COLUMNS = ["seq", "created_at", "actor_user_id", "actor_role", "action", "resource_type", "resource_id", "outcome", "reason", "ip_prefix", "before", "after", "prev_hash", "hash"] as const;

export function auditCsv(rows: Record<(typeof AUDIT_CSV_COLUMNS)[number], unknown>[]): string {
  return [AUDIT_CSV_COLUMNS.join(","), ...rows.map((r) => AUDIT_CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
}

// ---------- Read ops ----------

export const listRoleHoldersOp = adminOp({ action: "security.admins", resourceType: "admin_role", permission: "security.read", kind: "read", input: z.object({}), run: async () => ({ admins: await listRoleHolders() }) });

export const listAdminSessionsOp = adminOp({ action: "security.sessions", resourceType: "admin_session", permission: "security.read", kind: "read", input: z.object({}), run: async () => ({ sessions: await listOpenAdminSessions() }) });

export const securityEventsOp = adminOp({ action: "security.events", resourceType: "admin_mfa", permission: "security.read", kind: "read", input: z.object({}), run: async () => securityEvents() });

export const auditQueryOp = adminOp({
  action: "audit.query",
  resourceType: "audit",
  permission: "audit.read",
  kind: "read",
  input: auditFilterSchema.extend({ page: z.coerce.number().int().min(1).max(10_000).default(1) }),
  run: async ({ page, ...f }) => queryAudit(f, page),
});

export const auditEntryOp = adminOp({
  action: "audit.entry",
  resourceType: "audit",
  permission: "audit.read",
  kind: "read",
  input: z.object({ seq: z.coerce.number().int().positive() }),
  run: async ({ seq }) => {
    const entry = await auditEntry(seq);
    if (!entry) throw new UserFacingError("There is no audit entry with that number.");
    return entry;
  },
});

export const auditChainOp = adminOp({ action: "audit.chain", resourceType: "audit", permission: "audit.read", kind: "read", input: z.object({}), run: async () => verifyAuditChain() });

/** Owner only. Audited (the export itself is a sensitive act). Returns CSV text for the browser to save. */
export const auditExportOp = adminOp({
  action: "audit.export",
  resourceType: "audit",
  permission: "security.policy",
  kind: "write",
  transaction: false,
  input: auditFilterSchema,
  run: async (f, { record }) => {
    const rows = await db()
      .select({
        seq: schema.adminAuditLogs.seq,
        created_at: schema.adminAuditLogs.createdAt,
        actor_user_id: schema.adminAuditLogs.actorUserId,
        actor_role: schema.adminAuditLogs.actorRole,
        action: schema.adminAuditLogs.action,
        resource_type: schema.adminAuditLogs.resourceType,
        resource_id: schema.adminAuditLogs.resourceId,
        outcome: schema.adminAuditLogs.outcome,
        reason: schema.adminAuditLogs.reason,
        ip_prefix: schema.adminAuditLogs.ipPrefix,
        before: schema.adminAuditLogs.before,
        after: schema.adminAuditLogs.after,
        prev_hash: schema.adminAuditLogs.prevHash,
        hash: schema.adminAuditLogs.hash,
      })
      .from(schema.adminAuditLogs)
      .where(auditWhere(f))
      .orderBy(desc(schema.adminAuditLogs.seq))
      .limit(AUDIT_EXPORT_MAX);
    const csv = auditCsv(rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })));
    // The filter's actor email (if any) is personal; only its presence is recorded.
    record({ after: { rows: rows.length, filters: { ...f, actor: f.actor ? "set" : undefined } } });
    return { filename: `cowork-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv, rows: rows.length, truncated: rows.length === AUDIT_EXPORT_MAX };
  },
});

// ---------- Role management (owner only) ----------

const roleInput = z.enum(ASSIGNABLE_ROLES);

function alertAfter(subject: string, lines: string[]) {
  try {
    after(() => alertOwner(subject, lines));
  } catch {
    // Outside a request (tests, scripts): no alert.
  }
}

export const grantRoleOp = adminOp({
  action: "role.grant",
  resourceType: "admin_role",
  permission: "roles.manage",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: z.object({ email: z.string().trim().toLowerCase().email("Enter the email address of their Cowork account").max(320), role: roleInput, note: z.string().trim().max(200).optional() }),
  summary: async ({ email, role }) => {
    const [target] = await db().select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
    if (!target) return `No Cowork account uses ${email}, so nothing will change. They need to sign in to Cowork once first.`;
    return `Give ${email} the ${ROLE_LABEL[role]} role. They can open the console after setting up two-step verification.`;
  },
  run: async ({ email, role, note }, { user, tx, record }) => {
    const [target] = await tx.select({ id: schema.users.id, disabledAt: schema.users.disabledAt }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
    if (!target) throw new UserFacingError("No Cowork account uses that address. They need to sign in to Cowork once before they can be given a role.");
    if (target.disabledAt) throw new UserFacingError("That account is disabled. Enable it before giving it a role.");
    const current = await activeRole(target.id, tx);
    const problem = roleChangeProblem({ actorId: user.id, targetId: target.id, current: current?.role ?? null, next: role, mode: "grant" });
    if (problem) throw new UserFacingError(problem);
    await tx.insert(schema.adminRoleAssignments).values({ userId: target.id, role, grantedBy: user.id, source: "console", note: note || null });
    record({ resourceId: target.id, before: { role: null }, after: { role }, reason: note || null });
    alertAfter("Admin role granted", [`You gave an account the ${ROLE_LABEL[role]} role from the console.`]);
    return { userId: target.id, role };
  },
});

export const changeRoleOp = adminOp({
  action: "role.change",
  resourceType: "admin_role",
  permission: "roles.manage",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: z.object({ userId: uuid, role: roleInput }),
  summary: async ({ userId, role }) => {
    const [account, current, open] = await Promise.all([accountById(userId), activeRole(userId), openAdminSessionCount(userId)]);
    if (!account || !current) return "That person no longer holds an admin role, so nothing will change.";
    return `Change ${account.email} from ${ROLE_LABEL[current.role]} to ${ROLE_LABEL[role]}. ${open ? `Their ${open === 1 ? "open admin session ends" : `${open} open admin sessions end`} now, and` : "They"} unlock the console again with their own code.`;
  },
  run: async ({ userId, role }, { user, tx, record }) => {
    const current = await activeRole(userId, tx);
    const problem = roleChangeProblem({ actorId: user.id, targetId: userId, current: current?.role ?? null, next: role, mode: "change" });
    if (problem) throw new UserFacingError(problem);
    await tx.update(schema.adminRoleAssignments).set({ revokedAt: new Date(), revokedBy: user.id }).where(and(eq(schema.adminRoleAssignments.id, current!.id), isNull(schema.adminRoleAssignments.revokedAt)));
    await tx.insert(schema.adminRoleAssignments).values({ userId, role, grantedBy: user.id, source: "console" });
    await revokeAdminSessions(userId, tx);
    record({ resourceId: userId, before: { role: current!.role }, after: { role } });
    alertAfter("Admin role changed", [`You changed an account from ${ROLE_LABEL[current!.role]} to ${ROLE_LABEL[role]}. Its admin sessions were ended.`]);
    return { userId, role };
  },
});

export const revokeRoleOp = adminOp({
  action: "role.revoke",
  resourceType: "admin_role",
  permission: "roles.manage",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: z.object({ userId: uuid }),
  summary: async ({ userId }) => {
    const [account, current, open] = await Promise.all([accountById(userId), activeRole(userId), openAdminSessionCount(userId)]);
    if (!account || !current) return "That person no longer holds an admin role, so nothing will change.";
    return `Remove the ${ROLE_LABEL[current.role]} role from ${account.email}. They lose console access${open ? ` and ${open === 1 ? "their open admin session ends" : `${open} open admin sessions end`} now` : ""}. Their Cowork account stays as it is.`;
  },
  run: async ({ userId }, { user, tx, record }) => {
    const current = await activeRole(userId, tx);
    const problem = roleChangeProblem({ actorId: user.id, targetId: userId, current: current?.role ?? null, next: null, mode: "revoke" });
    if (problem) throw new UserFacingError(problem);
    await tx.update(schema.adminRoleAssignments).set({ revokedAt: new Date(), revokedBy: user.id }).where(and(eq(schema.adminRoleAssignments.id, current!.id), isNull(schema.adminRoleAssignments.revokedAt)));
    await revokeAdminSessions(userId, tx);
    record({ resourceId: userId, before: { role: current!.role }, after: { role: null } });
    alertAfter("Admin role removed", [`You removed the ${ROLE_LABEL[current!.role]} role from an account. Its admin sessions were ended.`]);
    return { userId };
  },
});

// ---------- Admin sessions ----------

async function endSession(id: string, ownerOf: string | null, tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0] | ReturnType<typeof db>) {
  const ended = await tx
    .update(schema.adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.adminSessions.id, id), isNull(schema.adminSessions.revokedAt), ownerOf ? eq(schema.adminSessions.userId, ownerOf) : undefined))
    .returning({ userId: schema.adminSessions.userId });
  return ended[0] ?? null;
}

/** Ends anyone's admin session (owner: security.policy). */
export const revokeAdminSessionOp = adminOp({
  action: "admin_session.revoke",
  resourceType: "admin_session",
  permission: "security.policy",
  kind: "write",
  input: z.object({ id: uuid }),
  run: async ({ id }, { tx, record }) => {
    const ended = await endSession(id, null, tx);
    if (!ended) throw new UserFacingError("That admin session has already ended.");
    record({ resourceId: id, after: { revoked: true, holder: ended.userId } });
    return { id };
  },
});

/** Anyone with a role may end their own admin sessions. */
export const revokeOwnAdminSessionOp = adminOp({
  action: "admin_session.revoke_own",
  resourceType: "admin_session",
  permission: "overview.read",
  kind: "write",
  input: z.object({ id: uuid }),
  run: async ({ id }, { user, tx, record }) => {
    const ended = await endSession(id, user.id, tx);
    if (!ended) throw new UserFacingError("That admin session isn't yours or has already ended.");
    record({ resourceId: id, after: { revoked: true } });
    return { id };
  },
});

// ---------- Two-step verification reset (owner only) ----------

export const resetMfaOp = adminOp({
  action: "mfa.reset",
  resourceType: "admin_mfa",
  permission: "security.policy",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: z.object({ userId: uuid }),
  summary: async ({ userId }) => {
    const account = await accountById(userId);
    if (!account) return "That account no longer exists, so nothing will change.";
    return `Reset two-step verification for ${account.email}. Their authenticator and recovery codes stop working, their admin sessions end, and they set it up again by email code before they can unlock the console.`;
  },
  run: async ({ userId }, { user, tx, record }) => {
    if (userId === user.id) throw new UserFacingError("You can't reset your own two-step verification here. Use a recovery code to unlock instead.");
    const removed = await tx.delete(schema.adminMfa).where(eq(schema.adminMfa.userId, userId)).returning({ enabledAt: schema.adminMfa.enabledAt });
    if (!removed.length) throw new UserFacingError("Two-step verification isn't set up for that account, so there is nothing to reset.");
    await revokeAdminSessions(userId, tx);
    record({ resourceId: userId, before: { mfaEnabled: Boolean(removed[0]!.enabledAt) }, after: { mfaEnabled: false } });
    alertAfter("Two-step verification reset", ["You reset two-step verification for an admin account. Its admin sessions were ended."]);
    return { userId };
  },
});
