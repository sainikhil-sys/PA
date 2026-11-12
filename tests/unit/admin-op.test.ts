import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Every dependency of the pipeline is replaced, so these tests check only the order and outcome of the checks.
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; disabledAt: null }; sessionId: string },
  role: null as null | string,
  adminSession: null as null | { id: string; createdAt: Date },
  rateOk: true,
  confirmOk: true,
  audits: [] as Record<string, unknown>[],
  issued: [] as unknown[],
  txUsed: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test", "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({ getAdminSession: async () => state.adminSession }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: state.rateOk }) }));
vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (e: Record<string, unknown>, executor?: unknown) => {
    state.audits.push({ ...e, inTx: executor === "tx" });
  },
}));
vi.mock("@/lib/admin/confirm", () => ({
  issueConfirmation: async (_u: string, action: string, input: unknown) => {
    state.issued.push({ action, input });
    return "tok_".padEnd(30, "x");
  },
  consumeConfirmation: async () => state.confirmOk,
}));
vi.mock("@/lib/db", () => ({
  db: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.txUsed++;
      return fn("tx");
    },
  }),
}));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/auth/action", () => ({ UserFacingError: class UserFacingError extends Error {} }));

const { adminOp, runOp } = await import("@/lib/admin/op");
const { UserFacingError } = await import("@/lib/auth/action");

const write = adminOp({
  action: "user.set_disabled",
  resourceType: "user",
  permission: "users.suspend",
  kind: "write",
  input: z.object({ userId: z.string().uuid() }),
  run: async ({ userId }, ctx) => {
    ctx.record({ resourceId: userId, before: { disabled: false }, after: { disabled: true } });
    return { done: true };
  },
});
const destructive = adminOp({
  action: "user.delete",
  resourceType: "user",
  permission: "users.delete",
  kind: "write",
  risk: "destructive",
  summary: (i) => `Delete account ${i.userId}`,
  input: z.object({ userId: z.string().uuid() }),
  run: async () => "deleted",
});
const fresh = adminOp({ action: "maintenance.set", resourceType: "config", permission: "maintenance.write", kind: "write", freshStepUp: true, input: z.object({}), run: async () => "ok" });
const read = adminOp({ action: "users.list", resourceType: "user", permission: "users.read", kind: "read", input: z.object({}), run: async () => ["a"] });

const ID = "7d3c3c0e-2b4c-4c1f-9a51-6c3d2f1f9e11";
const web = { platform: "web" as const };

beforeEach(() => {
  state.session = { user: { id: "u1", email: "Admin@Example.com", disabledAt: null }, sessionId: "s1" };
  state.role = "admin";
  state.adminSession = { id: "a1", createdAt: new Date() };
  state.rateOk = true;
  state.confirmOk = true;
  state.audits = [];
  state.issued = [];
  state.txUsed = 0;
});

describe("admin pipeline boundaries", () => {
  it("no session: 401", async () => {
    state.session = null;
    expect(await runOp(write, { userId: ID }, web)).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
  });

  it("signed in without a role: 404, and nothing audited", async () => {
    state.role = null;
    expect(await runOp(write, { userId: ID }, web)).toMatchObject({ ok: false, status: 404 });
    expect(state.audits).toEqual([]);
  });

  it("role but no admin session: 401 step_up_required", async () => {
    state.adminSession = null;
    expect(await runOp(write, { userId: ID }, web)).toMatchObject({ ok: false, status: 401, code: "step_up_required" });
  });

  it("role without the permission: 403, audited as denied", async () => {
    state.role = "support";
    expect(await runOp(write, { userId: ID }, web)).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect(state.audits).toEqual([expect.objectContaining({ action: "user.set_disabled", outcome: "denied", actorRole: "support" })]);
  });

  it("owner-only permission refused to admin", async () => {
    expect(await runOp(destructive, { userId: ID }, web)).toMatchObject({ status: 403 });
  });

  it("bad input: 400 before anything runs", async () => {
    expect(await runOp(write, { userId: "nope" }, web)).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
    expect(state.txUsed).toBe(0);
  });

  it("rate limited: 429", async () => {
    state.rateOk = false;
    expect(await runOp(write, { userId: ID }, web)).toMatchObject({ status: 429 });
  });

  it("a write runs in a transaction with its audit row inside it, redacting the email", async () => {
    expect(await runOp(write, { userId: ID }, web)).toEqual({ ok: true, data: { done: true } });
    expect(state.txUsed).toBe(1);
    expect(state.audits).toEqual([
      expect.objectContaining({ action: "user.set_disabled", outcome: "success", resourceId: ID, before: { disabled: false }, after: { disabled: true }, inTx: true, ipPrefix: "203.0.113.0", adminSessionId: "a1" }),
    ]);
    expect(JSON.stringify(state.audits)).not.toContain("Admin@Example.com");
  });

  it("reads are not audited and use no transaction", async () => {
    expect(await runOp(read, {}, web)).toEqual({ ok: true, data: ["a"] });
    expect(state.audits).toEqual([]);
    expect(state.txUsed).toBe(0);
  });

  it("destructive: first call returns a summary and token, not the change", async () => {
    state.role = "owner";
    const r = await runOp(destructive, { userId: ID }, web);
    expect(r).toMatchObject({ ok: false, status: 409, code: "confirm_required", confirm: { summary: `Delete account ${ID}` } });
    expect(state.issued).toEqual([{ action: "user.delete", input: { userId: ID } }]);
    expect(state.txUsed).toBe(0);
  });

  it("destructive: a valid token commits, an invalid one is refused", async () => {
    state.role = "owner";
    expect(await runOp(destructive, { userId: ID }, { ...web, confirmToken: "t" })).toEqual({ ok: true, data: "deleted" });
    state.confirmOk = false;
    expect(await runOp(destructive, { userId: ID }, { ...web, confirmToken: "t" })).toMatchObject({ status: 409, code: "confirm_invalid" });
  });

  it("fresh step-up: refused when the admin session is older than 10 minutes", async () => {
    state.role = "owner";
    state.adminSession = { id: "a1", createdAt: new Date(Date.now() - 11 * 60_000) };
    expect(await runOp(fresh, {}, web)).toMatchObject({ status: 401, code: "step_up_required" });
    state.adminSession = { id: "a1", createdAt: new Date() };
    expect(await runOp(fresh, {}, web)).toEqual({ ok: true, data: "ok" });
  });

  it("a refused write is audited as failed with the plain reason; unknown errors stay generic", async () => {
    const refusing = adminOp({ ...write, run: async () => { throw new UserFacingError("You can't disable your own account."); } });
    expect(await runOp(refusing, { userId: ID }, web)).toMatchObject({ status: 400, error: "You can't disable your own account." });
    expect(state.audits.at(-1)).toMatchObject({ outcome: "failed", reason: "You can't disable your own account." });
    const crashing = adminOp({ ...write, run: async () => { throw new Error("db password=hunter2"); } });
    const r = await runOp(crashing, { userId: ID }, web);
    expect(r).toMatchObject({ status: 500 });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(state.audits.at(-1)).toMatchObject({ outcome: "failed", reason: "error" });
  });

  it("destructive ops must declare a summary", () => {
    expect(() => adminOp({ ...destructive, summary: undefined })).toThrow(/summary/);
  });
});
