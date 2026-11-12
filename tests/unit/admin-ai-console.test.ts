import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase I console side: AI keys are changed with ai.write through the configuration op (version,
 * history and audit row), read with ai.read, and the cost estimate and error rates are plain maths.
 * The database is a small fake: selects answer from a queue, writes are recorded.
 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; disabledAt: null }; sessionId: string },
  role: null as null | string,
  audits: [] as Record<string, unknown>[],
  selects: [] as unknown[][],
  calls: [] as { op: string; values?: unknown; set?: unknown }[],
}));

function chain(call: { op: string; values?: unknown; set?: unknown } | null, result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin", "for", "onConflictDoNothing"]) c[m] = () => c;
  c.set = (v: unknown) => ((call!.set = v), c);
  c.values = (v: unknown) => ((call!.values = v), c);
  c.returning = () => Promise.resolve([]);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}
const write = (op: string) => () => {
  const call = { op };
  state.calls.push(call);
  return chain(call, () => []);
};
const fakeDb = {
  select: () => chain(null, () => state.selects.shift() ?? []),
  update: write("update"),
  insert: write("insert"),
  delete: write("delete"),
  execute: async () => [],
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test", "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session, getOwner: async () => state.session?.user ?? null }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({ getAdminSession: async () => ({ id: "a1", createdAt: new Date() }), revokeAdminSessions: async () => {} }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (e: Record<string, unknown>) => {
    state.audits.push(e);
  },
}));
vi.mock("@/lib/admin/confirm", () => ({ issueConfirmation: async () => "tok_".padEnd(30, "x"), consumeConfirmation: async () => true }));
vi.mock("@/lib/db", async () => ({ db: () => fakeDb, schema: await import("@/lib/db/schema"), rowsOf: (r: unknown) => r }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));

const { runOp } = await import("@/lib/admin/op");
const { aiConfigUpdateOp, configUpdateOp } = await import("@/lib/admin/ops/config");
const { aiOverviewOp } = await import("@/lib/admin/ops/ai");
const reg = await import("@/lib/config/registry");
const cost = await import("@/lib/admin/ai-cost");
const web = { platform: "web" as const };

beforeEach(() => {
  state.session = { user: { id: "11111111-2222-4333-8444-555555555555", email: "admin@example.com", disabledAt: null }, sessionId: "s1" };
  state.role = "admin";
  state.audits = [];
  state.selects = [];
  state.calls = [];
});

describe("AI keys in the registry", () => {
  const aiKeys = reg.CONFIG_ENTRIES.filter((e) => e.group === "ai");
  it("are the five switches, the daily limit and the price table, all changed with ai.write", () => {
    expect(aiKeys.map((e) => e.key).sort()).toEqual(["ai.automations", "ai.chat", "ai.dailyTokenLimitPerUser", "ai.documents", "ai.priceTable", "ai.research", "ai.voice"]);
    for (const e of aiKeys) expect(e.permission, e.key).toBe("ai.write");
  });
  it("say what reads them now", () => {
    for (const key of ["registration.open", "uploads.maxMb", ...aiKeys.map((e) => e.key), "notifications.default.push"]) expect(reg.configEntry(key)?.readBy, key).toBeTruthy();
  });
  it("Connect keys are still marked as not read by this build", () => {
    for (const e of reg.CONFIG_ENTRIES.filter((x) => x.group === "connect")) expect(e.readBy, e.key).toBeNull();
  });
  it("the daily limit takes null for no limit and refuses tiny or negative values", () => {
    expect(reg.validateWrite("ai.dailyTokenLimitPerUser", null).ok).toBe(true);
    expect(reg.validateWrite("ai.dailyTokenLimitPerUser", 50_000).ok).toBe(true);
    expect(reg.validateWrite("ai.dailyTokenLimitPerUser", 10).ok).toBe(false);
    expect(reg.validateWrite("ai.dailyTokenLimitPerUser", -1).ok).toBe(false);
  });
});

describe("changing AI keys through the op pipeline", () => {
  it("an admin turns voice off: new version, history row and audit row", async () => {
    const r = await runOp(aiConfigUpdateOp, { key: "ai.voice", value: false, reason: "Speech costs too much" }, web);
    expect(r).toEqual({ ok: true, data: { key: "ai.voice", version: 1 } });
    expect(state.calls.filter((c) => c.op === "insert")).toHaveLength(2);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: "config.update_ai", resourceId: "ai.voice", before: { value: true }, after: { value: false, version: 1 } });
  });
  it("sets the daily limit", async () => {
    const r = await runOp(aiConfigUpdateOp, { key: "ai.dailyTokenLimitPerUser", value: 200_000, reason: "Cap heavy use" }, web);
    expect(r.ok).toBe(true);
  });
  it("an analyst (ai.read only) can read but not change", async () => {
    state.role = "analyst";
    expect(await runOp(aiConfigUpdateOp, { key: "ai.chat", value: false, reason: "Trying it" }, web)).toMatchObject({ ok: false, status: 403 });
    // The refusal is audited as denied, and nothing is written.
    expect(state.audits).toMatchObject([{ action: "config.update_ai", outcome: "denied", reason: "missing ai.write" }]);
    expect(state.calls).toEqual([]);
  });
  it("support has no AI access at all", async () => {
    state.role = "support";
    expect(await runOp(aiOverviewOp, {}, web)).toMatchObject({ ok: false, status: 403 });
  });
  it("the generic config op can't change an AI key, and the AI op can't change other keys", async () => {
    expect(await runOp(configUpdateOp, { key: "ai.chat", value: false, reason: "Wrong door" }, web)).toMatchObject({ ok: false, error: "Your role can't change this setting." });
    expect(await runOp(aiConfigUpdateOp, { key: "uploads.maxMb", value: 2, reason: "Wrong door" }, web)).toMatchObject({ ok: false, error: "Your role can't change this setting." });
  });
  it("refuses values that don't fit", async () => {
    expect(await runOp(aiConfigUpdateOp, { key: "ai.priceTable", value: { "bad id!": { inputPerMillion: 1, outputPerMillion: 1 } }, reason: "Prices" }, web)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("cost estimate", () => {
  const table = { "smart-1": { inputPerMillion: 2, outputPerMillion: 8 }, "fast-1": { inputPerMillion: 0.5, outputPerMillion: 1.5 } };
  it("prices server-key tokens per million and leaves own keys out", () => {
    const r = cost.estimateCost(
      [
        { model: "smart-1", keySource: "server", input: 1_000_000, output: 500_000 },
        { model: "fast-1", keySource: "server", input: 2_000_000, output: 0 },
        { model: "smart-1", keySource: "own", input: 9_000_000, output: 9_000_000 },
      ],
      table,
    );
    expect(r.totalUsd).toBeCloseTo(2 + 4 + 1, 6);
    expect(r.byModel.map((m) => m.model)).toEqual(["smart-1", "fast-1"]);
    expect(r.unpriced).toEqual([]);
  });
  it("lists models without a price as unknown, never as free", () => {
    const r = cost.estimateCost([{ model: "mystery", keySource: "server", input: 10, output: 10 }], table);
    expect(r.totalUsd).toBe(0);
    expect(r.unpriced).toEqual(["mystery"]);
    expect(r.byModel[0]!.usd).toBeNull();
  });
  it("formats rates and money plainly", () => {
    expect(cost.errorRate(0, 0)).toBeNull();
    expect(cost.formatRate(null)).toBe("No calls");
    expect(cost.formatRate(cost.errorRate(1, 4))).toBe("25%");
    expect(cost.formatRate(cost.errorRate(1, 3000))).toBe("<0.1%");
    expect(cost.formatUsd(0.004)).toBe("<$0.01");
    expect(cost.formatUsd(12.345)).toBe("$12.35");
  });
});
