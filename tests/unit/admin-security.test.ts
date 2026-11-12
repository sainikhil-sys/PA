import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "owner-1", email: "owner@example.com", disabledAt: null }, sessionId: "s1" },
  role: "owner" as string | null,
  adminSession: { id: "a1", createdAt: new Date() } as { id: string; createdAt: Date } | null,
  audits: [] as Record<string, unknown>[],
  issued: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test" }) }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({ getAdminSession: async () => state.adminSession, revokeAdminSessions: async () => {} }));
vi.mock("@/lib/admin/emails", () => ({ alertOwner: async () => {} }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }) }));
vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (e: Record<string, unknown>) => {
    state.audits.push(e);
  },
  verifyAuditChain: async () => ({ ok: true, rows: 0, firstBrokenSeq: null }),
}));
vi.mock("@/lib/admin/confirm", () => ({
  issueConfirmation: async (_u: string, action: string, input: unknown) => {
    state.issued.push({ action, input });
    return "tok_".padEnd(30, "x");
  },
  consumeConfirmation: async () => true,
}));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/auth/action", () => ({ UserFacingError: class UserFacingError extends Error {} }));
/** Every query answers with no rows. */
vi.mock("@/lib/db", async () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "innerJoin", "leftJoin", "orderBy", "offset", "update", "set", "insert", "values", "delete", "returning"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve([]);
  return { schema: await import("@/lib/db/schema"), rowsOf: () => [], db: () => ({ ...chain, transaction: async (fn: (tx: unknown) => unknown) => fn(chain) }) };
});

const sec = await import("@/lib/admin/ops/security");
const { runOp } = await import("@/lib/admin/op");
const { can } = await import("@/lib/admin/permissions");
const web = { platform: "web" as const };
const ID = "7d3c3c0e-2b4c-4c1f-9a51-6c3d2f1f9e11";

beforeEach(() => {
  state.role = "owner";
  state.adminSession = { id: "a1", createdAt: new Date() };
  state.audits = [];
  state.issued = [];
});

describe("role change rules", () => {
  const base = { actorId: "me", targetId: "them" };
  it("never your own role", () => {
    expect(sec.roleChangeProblem({ ...base, targetId: "me", current: "admin", next: "analyst", mode: "change" })).toMatch(/your own role/);
  });
  it("the owner role is never granted, changed or revoked here", () => {
    expect(sec.roleChangeProblem({ ...base, current: null, next: "owner", mode: "grant" })).toMatch(/--transfer/);
    expect(sec.roleChangeProblem({ ...base, current: "owner", next: "admin", mode: "change" })).toMatch(/--transfer/);
    expect(sec.roleChangeProblem({ ...base, current: "owner", next: null, mode: "revoke" })).toMatch(/--transfer/);
  });
  it("grant needs no current role; change and revoke need one", () => {
    expect(sec.roleChangeProblem({ ...base, current: "support", next: "admin", mode: "grant" })).toMatch(/already hold/);
    expect(sec.roleChangeProblem({ ...base, current: null, next: "admin", mode: "change" })).toMatch(/don't hold/);
    expect(sec.roleChangeProblem({ ...base, current: "admin", next: "admin", mode: "change" })).toMatch(/already hold/);
    expect(sec.roleChangeProblem({ ...base, current: null, next: "analyst", mode: "grant" })).toBeNull();
    expect(sec.roleChangeProblem({ ...base, current: "support", next: null, mode: "revoke" })).toBeNull();
  });
  it("the console can't even ask for the owner role", () => {
    expect(sec.grantRoleOp.input.safeParse({ email: "a@example.com", role: "owner" }).success).toBe(false);
    expect(sec.changeRoleOp.input.safeParse({ userId: ID, role: "owner" }).success).toBe(false);
    expect(sec.ASSIGNABLE_ROLES).not.toContain("owner");
  });
});

describe("security ops are declared owner-only and destructive where they must be", () => {
  it.each([sec.grantRoleOp, sec.changeRoleOp, sec.revokeRoleOp])("$action: roles.manage, destructive, fresh unlock", (op) => {
    expect(op).toMatchObject({ permission: "roles.manage", risk: "destructive", freshStepUp: true, kind: "write" });
  });
  it("two-step reset: owner only, destructive, fresh unlock", () => {
    expect(sec.resetMfaOp).toMatchObject({ permission: "security.policy", risk: "destructive", freshStepUp: true, kind: "write" });
  });
  it("ending someone else's admin session is owner only; your own is any role", () => {
    expect(sec.revokeAdminSessionOp.permission).toBe("security.policy");
    expect(sec.revokeOwnAdminSessionOp.permission).toBe("overview.read");
    for (const role of ["owner", "admin", "moderator", "support", "analyst"] as const) expect(can(role, "overview.read")).toBe(true);
    expect(can("admin", "security.policy")).toBe(false);
  });
  it("audit reads need audit.read; the CSV export is owner only and audited", () => {
    expect(sec.auditQueryOp.permission).toBe("audit.read");
    expect(sec.auditExportOp).toMatchObject({ permission: "security.policy", kind: "write" });
    expect(can("analyst", "audit.read")).toBe(false);
  });
});

describe("through the pipeline", () => {
  it("an admin can't grant roles: 403, audited as denied", async () => {
    state.role = "admin";
    expect(await runOp(sec.grantRoleOp, { email: "new@example.com", role: "analyst" }, web)).toMatchObject({ ok: false, status: 403 });
    expect(state.audits).toEqual([expect.objectContaining({ action: "role.grant", outcome: "denied" })]);
  });

  it("the owner needs a fresh unlock to change roles", async () => {
    state.adminSession = { id: "a1", createdAt: new Date(Date.now() - 11 * 60_000) };
    expect(await runOp(sec.revokeRoleOp, { userId: ID }, web)).toMatchObject({ ok: false, status: 401, code: "step_up_required" });
  });

  it("a role change asks for confirmation first, with a plain summary", async () => {
    const r = await runOp(sec.revokeRoleOp, { userId: ID }, web);
    expect(r).toMatchObject({ ok: false, status: 409, code: "confirm_required" });
    expect(state.issued).toEqual([{ action: "role.revoke", input: { userId: ID } }]);
  });

  it("a confirmed grant for an address without an account is refused and audited as failed", async () => {
    const r = await runOp(sec.grantRoleOp, { email: "Nobody@Example.com", role: "analyst" }, { ...web, confirmToken: "t".repeat(30) });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(state.audits.at(-1)).toMatchObject({ action: "role.grant", outcome: "failed" });
  });

  it("an admin can't reset someone's two-step verification or export the audit log", async () => {
    state.role = "admin";
    expect(await runOp(sec.resetMfaOp, { userId: ID }, web)).toMatchObject({ status: 403 });
    expect(await runOp(sec.auditExportOp, {}, web)).toMatchObject({ status: 403 });
  });

  it("the owner can't reset their own two-step verification here", async () => {
    state.session = { ...state.session, user: { ...state.session.user, id: ID } };
    const r = await runOp(sec.resetMfaOp, { userId: ID }, { ...web, confirmToken: "t".repeat(30) });
    expect(r).toMatchObject({ ok: false, status: 400 });
    state.session = { ...state.session, user: { ...state.session.user, id: "owner-1" } };
  });
});

describe("audit filters are typed, never free-form SQL", () => {
  it("accepts blank fields and normalises an email", () => {
    expect(sec.auditFilterSchema.parse({ actor: " Ana@Example.com ", action: "", outcome: "" })).toEqual({ actor: "ana@example.com" });
  });
  it("rejects anything that isn't a plain identifier, date or known outcome", () => {
    expect(sec.auditFilterSchema.safeParse({ action: "x' or 1=1 --" }).success).toBe(false);
    expect(sec.auditFilterSchema.safeParse({ resourceType: "user; drop table users" }).success).toBe(false);
    expect(sec.auditFilterSchema.safeParse({ outcome: "anything" }).success).toBe(false);
    expect(sec.auditFilterSchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(sec.auditFilterSchema.safeParse({ actor: "not-an-id" }).success).toBe(false);
  });
  it("values are bound parameters, and LIKE wildcards in an action are escaped", () => {
    const q = new PgDialect().sqlToQuery(sec.auditWhere({ action: "user_set", resourceType: "user" })!);
    expect(q.sql).not.toContain("user_set");
    expect(q.params).toContain("user\\_set%");
  });
  it("page is a bounded integer", () => {
    expect(sec.auditQueryOp.input.safeParse({ page: "2" }).success).toBe(true);
    expect(sec.auditQueryOp.input.safeParse({ page: "0" }).success).toBe(false);
    expect(sec.auditQueryOp.input.safeParse({ page: "1; select" }).success).toBe(false);
  });
});

describe("audit CSV", () => {
  it("quotes, and neutralises cells a spreadsheet would run", () => {
    expect(sec.csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(sec.csvCell("+1")).toBe("'+1");
    expect(sec.csvCell("a,b")).toBe('"a,b"');
    expect(sec.csvCell(null)).toBe("");
    expect(sec.csvCell({ role: "admin" })).toBe('"{""role"":""admin""}"');
  });
  it("has a header row and one line per entry", () => {
    const csv = sec.auditCsv([{ seq: 1, created_at: "2026-11-12T00:00:00.000Z", actor_user_id: ID, actor_role: "owner", action: "role.grant", resource_type: "admin_role", resource_id: ID, outcome: "success", reason: null, ip_prefix: null, before: null, after: { role: "analyst" }, prev_hash: null, hash: "h" }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(sec.AUDIT_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
  });
});
