import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Deletion requests: due dates, support's part, and the owner-only, confirmed, fresh-unlock completion. */
type Call = { op: "update" | "insert" | "delete"; table: unknown; set?: unknown; values?: unknown };
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; disabledAt: null }; sessionId: string },
  role: null as null | string,
  adminSession: null as null | { id: string; createdAt: Date },
  confirmOk: true,
  audits: [] as Record<string, unknown>[],
  selects: [] as unknown[][],
  returning: [] as unknown[][],
  calls: [] as { op: string; table: unknown; set?: unknown; values?: unknown }[],
}));

function chain(call: Call | null, result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin", "offset"]) c[m] = () => c;
  c.set = (v: unknown) => ((call!.set = v), c);
  c.values = (v: unknown) => ((call!.values = v), c);
  c.returning = () => Promise.resolve(state.returning.shift() ?? []);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}
const write = (op: Call["op"]) => (table: unknown) => {
  const call: Call = { op, table };
  state.calls.push(call);
  return chain(call, () => []);
};
const fakeDb = {
  select: () => chain(null, () => state.selects.shift() ?? []),
  update: write("update"),
  insert: write("insert"),
  delete: write("delete"),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test" }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({ getAdminSession: async () => state.adminSession, revokeAdminSessions: async () => {} }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }) }));
vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (e: Record<string, unknown>) => {
    state.audits.push(e);
  },
}));
vi.mock("@/lib/admin/confirm", () => ({ issueConfirmation: async () => "tok_".padEnd(30, "x"), consumeConfirmation: async () => state.confirmOk }));
vi.mock("@/lib/db", async () => ({ db: () => fakeDb, schema: await import("@/lib/db/schema"), rowsOf: (r: unknown) => r }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));

const schema = await import("@/lib/db/schema");
const { runOp } = await import("@/lib/admin/op");
const del = await import("@/lib/admin/ops/deletion");
const web = { platform: "web" as const };

const OWNER = "11111111-2222-4333-8444-555555555555";
const TARGET = "7d3c3c0e-2b4c-4c1f-9a51-6c3d2f1f9e11";
const REQ = "33333333-3333-4333-8333-333333333333";
const hash = (e: string) => createHash("sha256").update(e.trim().toLowerCase()).digest("hex");
const verified = { id: REQ, status: "verified", userId: TARGET, emailHash: hash("ana@example.com"), note: null };
/** Select answers for completionTarget: the request, the account, no admin role. */
const target = () => [[verified], [{ id: TARGET, email: "ana@example.com" }], []];

beforeEach(() => {
  state.session = { user: { id: OWNER, email: "owner@example.com", disabledAt: null }, sessionId: "s1" };
  state.role = "owner";
  state.adminSession = { id: "a1", createdAt: new Date() };
  state.confirmOk = true;
  state.audits = [];
  state.selects = [];
  state.returning = [];
  state.calls = [];
});

describe("due dates", () => {
  it("is due 30 days after it was received, as /delete-account promises", () => {
    expect(del.deletionDueBy(new Date("2026-11-01T10:00:00Z")).toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });
  it("only open requests can be overdue", () => {
    const now = new Date("2026-12-02T00:00:00Z");
    expect(del.isOverdue({ status: "received", dueBy: "2026-12-01T10:00:00Z" }, now)).toBe(true);
    expect(del.isOverdue({ status: "verified", dueBy: "2026-12-03T10:00:00Z" }, now)).toBe(false);
    expect(del.isOverdue({ status: "completed", dueBy: "2026-12-01T10:00:00Z" }, now)).toBe(false);
  });
});

describe("support's part", () => {
  beforeEach(() => {
    state.role = "support";
  });

  it("records a request with only the email hash and a 30 day due date", async () => {
    state.selects = [[], [{ id: TARGET }]];
    const due = new Date(Date.now() + 30 * 86_400_000);
    state.returning = [[{ id: REQ, dueBy: due }]];
    const r = await runOp(del.recordDeletionRequestOp, { email: " Ana@Example.com ", source: "email" }, web);
    expect(r).toMatchObject({ ok: true, data: { id: REQ, accountFound: true } });
    const values = state.calls[0]!.values as Record<string, unknown>;
    expect(values).toMatchObject({ userId: TARGET, emailHash: hash("ana@example.com"), status: "received", source: "email" });
    expect(JSON.stringify(values)).not.toContain("ana@");
    expect((values.dueBy as Date).getTime() - (values.createdAt as Date).getTime()).toBe(30 * 86_400_000);
    expect(JSON.stringify(state.audits)).not.toContain("ana@");
  });

  it("refuses a second open request for the same address", async () => {
    state.selects = [[{ id: REQ }]];
    expect(await runOp(del.recordDeletionRequestOp, { email: "ana@example.com" }, web)).toMatchObject({ status: 400, error: "There's already an open request for this address." });
  });

  it("verifies and rejects with a note", async () => {
    state.selects = [[{ ...verified, status: "received" }]];
    expect(await runOp(del.verifyDeletionRequestOp, { id: REQ }, web)).toMatchObject({ ok: true });
    expect(state.calls[0]).toMatchObject({ op: "update", set: { status: "verified" } });
    state.selects = [[verified]];
    expect(await runOp(del.rejectDeletionRequestOp, { id: REQ, note: "Not from the sign-in address" }, web)).toMatchObject({ ok: true });
    expect(state.calls[1]).toMatchObject({ op: "update", set: { status: "rejected", note: "Not from the sign-in address" } });
    expect(await runOp(del.rejectDeletionRequestOp, { id: REQ }, web)).toMatchObject({ status: 400 });
  });

  it("support cannot complete a deletion (403, audited as denied, nothing deleted)", async () => {
    const r = await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, { ...web, confirmToken: "tok" });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(state.calls).toEqual([]);
    expect(state.audits).toEqual([expect.objectContaining({ action: "deletion.complete", outcome: "denied" })]);
  });
});

describe("completing a deletion", () => {
  it("is owner-only: an admin is refused", async () => {
    state.role = "admin";
    expect(await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, { ...web, confirmToken: "tok" })).toMatchObject({ status: 403 });
    expect(state.calls).toEqual([]);
  });

  it("needs a fresh unlock", async () => {
    state.adminSession = { id: "a1", createdAt: new Date(Date.now() - 11 * 60_000) };
    expect(await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, web)).toMatchObject({ status: 401, code: "step_up_required" });
  });

  it("asks for confirmation first with a plain summary, deleting nothing", async () => {
    state.selects = target();
    const r = await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, web);
    expect(r).toMatchObject({ ok: false, status: 409, code: "confirm_required" });
    expect(r.ok ? "" : r.confirm?.summary).toMatch(/^Delete the account ana@example.com and all of its data.*This can't be undone\.$/);
    expect(state.calls).toEqual([]);
  });

  it("with the token: marks the request completed (keeping the hash) and deletes the account in one transaction", async () => {
    state.selects = target();
    const r = await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, { ...web, confirmToken: "tok" });
    expect(r).toMatchObject({ ok: true });
    expect(state.calls.map((c) => [c.op, c.table])).toEqual([
      ["update", schema.accountDeletionRequests],
      ["delete", schema.users],
    ]);
    expect(state.calls[0]!.set).toMatchObject({ status: "completed", completedBy: OWNER });
    expect(state.calls[0]!.set).not.toHaveProperty("emailHash");
    expect(state.audits.at(-1)).toMatchObject({ action: "deletion.complete", outcome: "success", resourceId: REQ });
  });

  it("an invalid token commits nothing", async () => {
    state.confirmOk = false;
    expect(await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, { ...web, confirmToken: "bad" })).toMatchObject({ status: 409, code: "confirm_invalid" });
    expect(state.calls).toEqual([]);
  });

  it("refuses a mismatched email, an unverified request and an admin's account", async () => {
    state.selects = [[verified]];
    expect(await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "bob@example.com" }, { ...web, confirmToken: "tok" })).toMatchObject({ status: 400, error: "That email doesn't match the request." });
    state.selects = [[{ ...verified, status: "received" }]];
    expect(await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, { ...web, confirmToken: "tok" })).toMatchObject({ error: "Verify the request before deleting the account." });
    state.selects = [[verified], [{ id: TARGET, email: "ana@example.com" }], [{ role: "support" }]];
    expect(await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "ana@example.com" }, { ...web, confirmToken: "tok" })).toMatchObject({ error: "This account holds an admin role. Remove the role first." });
    expect(state.calls.filter((c) => c.op === "delete")).toEqual([]);
  });

  it("a refusal in the summary step comes back as text, not a crash", async () => {
    state.selects = [[verified]];
    const r = await runOp(del.completeDeletionRequestOp, { id: REQ, confirmEmail: "bob@example.com" }, web);
    expect(r.ok ? "" : r.confirm?.summary).toBe("This can't go ahead: That email doesn't match the request.");
  });
});
