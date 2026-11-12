import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Users: restrictions (expiry, enforcement at the API) and the user ops through the shared pipeline.
 * The database is a small fake: selects answer from a queue, writes are recorded.
 */
type Call = { op: "update" | "insert" | "delete"; table: unknown; set?: unknown; values?: unknown };
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; disabledAt: null }; sessionId: string },
  role: null as null | string,
  adminSession: null as null | { id: string; createdAt: Date },
  audits: [] as Record<string, unknown>[],
  selects: [] as unknown[][],
  returning: [] as unknown[][],
  calls: [] as { op: string; table: unknown; set?: unknown; values?: unknown }[],
  adminRevoked: [] as string[],
}));

function chain(call: Call | null, result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin", "offset", "onConflictDoNothing"]) c[m] = () => c;
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
  selectDistinct: () => chain(null, () => state.selects.shift() ?? []),
  update: write("update"),
  insert: write("insert"),
  delete: write("delete"),
  execute: async () => [],
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test", "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({
  getAdminSession: async () => state.adminSession,
  revokeAdminSessions: async (userId: string) => {
    state.adminRevoked.push(userId);
  },
}));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (e: Record<string, unknown>) => {
    state.audits.push(e);
  },
}));
vi.mock("@/lib/admin/confirm", () => ({ issueConfirmation: async () => "tok_".padEnd(30, "x"), consumeConfirmation: async () => true }));
vi.mock("@/lib/db", async () => ({ db: () => fakeDb, schema: await import("@/lib/db/schema"), rowsOf: (r: unknown) => r }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/auth/api", () => ({ apiGuard: async () => ({ user: { id: TARGET } }) }));
// The chat pipeline's heavy dependencies: the restricted path returns before any of them is used.
vi.mock("@/lib/ai/router", () => ({}));
vi.mock("@/lib/agent/context", () => ({}));
vi.mock("@/lib/agent/memory", () => ({}));
vi.mock("@/lib/agent/plan", () => ({}));
vi.mock("@/lib/agent/proposals", () => ({}));
vi.mock("@/lib/knowledge/rank", () => ({}));
vi.mock("@/lib/trace", () => ({}));
vi.mock("@/lib/db/queries/settings", () => ({}));
vi.mock("@/lib/knowledge/ingest", () => ({ ensureSource: async () => ({}), refreshSourceCount: async () => {}, upsertItem: async () => ({}) }));
vi.mock("@/lib/env", () => ({ env: () => ({ STT_BASE_URL: "https://stt.invalid" }), appUrl: () => "https://app.invalid" }));

const TARGET = "7d3c3c0e-2b4c-4c1f-9a51-6c3d2f1f9e11";
const ME = "11111111-2222-4333-8444-555555555555";
const schema = await import("@/lib/db/schema");
const { runOp } = await import("@/lib/admin/op");
const restrictions = await import("@/lib/admin/restrictions");
const { addRestrictionOp, liftRestrictionOp, revokeUserSessionsOp, suspendUsersOp } = await import("@/lib/admin/ops/users");
const { summarizeUserAgent, userSearchSchema } = await import("@/lib/admin/users-query");
const web = { platform: "web" as const };
const HOUR = 3_600_000;

beforeEach(() => {
  state.session = { user: { id: ME, email: "owner@example.com", disabledAt: null }, sessionId: "s1" };
  state.role = "admin";
  state.adminSession = { id: "a1", createdAt: new Date() };
  state.audits = [];
  state.selects = [];
  state.returning = [];
  state.calls = [];
  state.adminRevoked = [];
});

describe("restriction expiry", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("counts until lifted or expired", () => {
    expect(restrictions.isActiveRestriction({ expiresAt: null, liftedAt: null }, now)).toBe(true);
    expect(restrictions.isActiveRestriction({ expiresAt: new Date(now.getTime() + HOUR), liftedAt: null }, now)).toBe(true);
    expect(restrictions.isActiveRestriction({ expiresAt: new Date(now.getTime() - 1), liftedAt: null }, now)).toBe(false);
    expect(restrictions.isActiveRestriction({ expiresAt: now, liftedAt: null }, now)).toBe(false);
    expect(restrictions.isActiveRestriction({ expiresAt: null, liftedAt: new Date(now.getTime() - HOUR) }, now)).toBe(false);
  });
  it("collects only active features", () => {
    const set = restrictions.activeFeatures(
      [
        { feature: "ai", expiresAt: null, liftedAt: null },
        { feature: "uploads", expiresAt: new Date(now.getTime() - HOUR), liftedAt: null },
        { feature: "automations", expiresAt: new Date(now.getTime() + HOUR), liftedAt: null },
      ],
      now,
    );
    expect([...set].sort()).toEqual(["ai", "automations"]);
  });
});

describe("restrictions are enforced by the API", () => {
  const restrictedTo = (...features: string[]) => (state.selects = [features.map((feature) => ({ feature, expiresAt: null, liftedAt: null }))]);
  const upload = (url: string) => {
    const form = new FormData();
    form.set("file", new File(["hello"], "a.txt", { type: "text/plain" }));
    return new Request(url, { method: "POST", body: form });
  };

  it("isRestricted reads the rows and ignores expired ones", async () => {
    state.selects = [[{ feature: "ai", expiresAt: new Date(Date.now() - HOUR), liftedAt: null }]];
    expect(await restrictions.isRestricted(TARGET, "ai")).toBe(false);
    restrictedTo("ai");
    expect(await restrictions.isRestricted(TARGET, "ai")).toBe(true);
  });

  it("chat attachments: 403 with a plain message that doesn't reveal the console", async () => {
    restrictedTo("uploads");
    const { POST } = await import("@/app/api/chat/attach/route");
    const res = await POST(upload("https://app.invalid/api/chat/attach"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: "Your account can't use this right now. Contact support@antropic.me.", code: "restricted" });
    expect(body.error).not.toMatch(/admin|console/i);
  });

  it("chat: a restricted account gets the assistant message and nothing is saved", async () => {
    restrictedTo("ai");
    const { runChatTurn } = await import("@/lib/agent/chat");
    const events = [];
    for await (const e of runChatTurn({ user: { id: TARGET } as never, message: "hi", trigger: "text" })) events.push(e);
    expect(events).toEqual([{ type: "error", message: restrictions.AI_RESTRICTED_MESSAGE }]);
    expect(state.calls).toEqual([]);
  });

  it("knowledge uploads: 403", async () => {
    restrictedTo("uploads");
    const { POST } = await import("@/app/api/knowledge/upload/route");
    expect((await POST(upload("https://app.invalid/api/knowledge/upload"))).status).toBe(403);
  });

  it("voice transcription (AI): 403 with the assistant message", async () => {
    restrictedTo("ai");
    const { POST } = await import("@/app/api/voice/transcribe/route");
    const res = await POST(new Request("https://app.invalid/api/voice/transcribe", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(restrictions.AI_RESTRICTED_MESSAGE);
  });

  it("another feature's restriction doesn't block uploads", async () => {
    restrictedTo("ai");
    expect(await restrictions.restrictedResponse(TARGET, "uploads")).toBeNull();
  });

  it("server actions get a plain error", async () => {
    restrictedTo("automations");
    await expect(restrictions.assertNotRestricted(TARGET, "automations")).rejects.toThrow("Contact support@antropic.me");
  });
});

describe("user ops", () => {
  it("support can't add a restriction (403, audited as denied)", async () => {
    state.role = "support";
    const r = await runOp(addRestrictionOp, { userId: TARGET, feature: "ai", reason: "Abuse report" }, web);
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(state.audits).toEqual([expect.objectContaining({ action: "user.restrict", outcome: "denied" })]);
  });

  it("adds a restriction with reason and expiry, replacing an active one, audited in the same write", async () => {
    const until = new Date(Date.now() + 24 * HOUR);
    state.selects = [[{ id: TARGET }], [{ id: "old", expiresAt: null, liftedAt: null }]];
    state.returning = [[{ id: "new" }]];
    const r = await runOp(addRestrictionOp, { userId: TARGET, feature: "uploads", reason: "Spam uploads", expiresAt: until.toISOString() }, web);
    expect(r).toEqual({ ok: true, data: { id: "new", feature: "Uploads" } });
    expect(state.calls.map((c) => [c.op, c.table === schema.userRestrictions])).toEqual([
      ["update", true],
      ["insert", true],
    ]);
    expect(state.calls[1]!.values).toMatchObject({ userId: TARGET, feature: "uploads", reason: "Spam uploads", expiresAt: until, createdBy: ME });
    expect(state.audits).toEqual([expect.objectContaining({ action: "user.restrict", outcome: "success", resourceId: TARGET, reason: "Spam uploads" })]);
  });

  it("refuses an expiry in the past and restricting yourself", async () => {
    expect(await runOp(addRestrictionOp, { userId: TARGET, feature: "ai", reason: "x".repeat(5), expiresAt: new Date(Date.now() - HOUR).toISOString() }, web)).toMatchObject({ status: 400 });
    expect(await runOp(addRestrictionOp, { userId: ME, feature: "ai", reason: "Testing" }, web)).toMatchObject({ status: 400, error: "You can't restrict your own account." });
  });

  it("lifts a restriction", async () => {
    state.selects = [[{ feature: "ai", liftedAt: null, expiresAt: null }]];
    const r = await runOp(liftRestrictionOp, { userId: TARGET, restrictionId: "22222222-2222-4222-8222-222222222222" }, web);
    expect(r).toEqual({ ok: true, data: { feature: "Assistant" } });
    expect(state.calls[0]).toMatchObject({ op: "update", table: schema.userRestrictions });
  });

  it("support can revoke sessions; admin sessions end too", async () => {
    state.role = "support";
    state.selects = [[{ id: TARGET }]];
    state.returning = [[{ id: "s1" }, { id: "s2" }]];
    expect(await runOp(revokeUserSessionsOp, { userId: TARGET }, web)).toEqual({ ok: true, data: { revoked: 2 } });
    expect(state.adminRevoked).toEqual([TARGET]);
    expect(state.audits.at(-1)).toMatchObject({ action: "user.sessions_revoke", before: { liveSessions: 2 }, after: { liveSessions: 0 } });
  });

  it("suspending many is destructive: a summary first, then the commit", async () => {
    state.selects = [[{ id: TARGET, email: "ana@example.com", disabledAt: null }], [], [{ n: 3 }]];
    const first = await runOp(suspendUsersOp, { userIds: [TARGET], reason: "Spam wave" }, web);
    expect(first).toMatchObject({ ok: false, status: 409, code: "confirm_required" });
    expect(first.ok ? "" : first.confirm?.summary).toBe("Suspend 1 account (ana@example.com) and sign them out of 3 sessions. They can't sign in until you restore them.");
    expect(state.calls).toEqual([]);
    state.selects = [[{ id: TARGET, email: "ana@example.com", disabledAt: null }], []];
    expect(await runOp(suspendUsersOp, { userIds: [TARGET], reason: "Spam wave" }, { ...web, confirmToken: "tok" })).toEqual({ ok: true, data: { suspended: 1 } });
    expect(state.calls.map((c) => c.table)).toEqual([schema.users, schema.sessions, schema.adminSessions]);
  });

  it("bulk suspend refuses the owner and yourself, without crashing the summary", async () => {
    state.selects = [[{ id: TARGET, email: "o@example.com", disabledAt: null }], [{ userId: TARGET }]];
    const r = await runOp(suspendUsersOp, { userIds: [TARGET], reason: "Spam wave" }, web);
    expect(r.ok ? "" : r.confirm?.summary).toMatch(/^This can't go ahead: The owner's account can't be suspended/);
    const self = await runOp(suspendUsersOp, { userIds: [ME], reason: "Spam wave" }, web);
    expect(self.ok ? "" : self.confirm?.summary).toMatch(/your own account/);
  });
});

describe("search input and devices", () => {
  it("validates filters from the query string", () => {
    expect(userSearchSchema.parse({})).toEqual({ q: "", status: "all", restricted: "", platform: "", appVersion: "", page: 1 });
    expect(userSearchSchema.parse({ page: "3", restricted: "ai", platform: "android", appVersion: "1.4.0" })).toMatchObject({ page: 3, restricted: "ai", platform: "android" });
    expect(userSearchSchema.safeParse({ status: "deleted" }).success).toBe(false);
    expect(userSearchSchema.safeParse({ appVersion: "1.0'; drop" }).success).toBe(false);
  });
  it("summarizes user agents without the raw string", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(summarizeUserAgent("okhttp/4.12.0")).toBe("Cowork app on Android");
    expect(summarizeUserAgent(null, "android")).toBe("Cowork app on Android");
    expect(summarizeUserAgent(null)).toBe("Unknown device");
  });
});
