import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Analytics are counts only: never email addresses or message content. The fake database answers
 * every query with rows full of personal-looking strings; none may reach the result.
 */
const PERSONAL = { tool: "ana@example.com", feature: "bob@example.com wrote", platform: "carol@example.com", app_version: "dave@example.com", runtime_version: "eve@example.com", week: "frank@example.com" };

const state = vi.hoisted(() => ({
  queries: [] as unknown[],
  session: { user: { id: "u1", email: "Analyst@Example.com", disabledAt: null }, sessionId: "s1" },
  role: "analyst" as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test" }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({ getAdminSession: async () => ({ id: "a1", createdAt: new Date() }) }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }) }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/admin/confirm", () => ({ issueConfirmation: async () => "t", consumeConfirmation: async () => true }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  rowsOf: (r: unknown) => (Array.isArray(r) ? r : []),
  db: () => ({
    execute: async (q: unknown) => {
      state.queries.push(q);
      const day = new Date().toISOString().slice(0, 10);
      return [{ ...PERSONAL, day, n: 3, users: 2, uses: 5, calls: 4, tokens: 900, sessions: 3, app_build: 7, active_day: 1, active_week: 2, active_month: 3, users_total: 10, cohort: 4, returned: 2 }];
    },
  }),
}));

const { analyticsSummary, stripPersonal, safeLabel, fillDays } = await import("@/lib/admin/analytics");
const { analyticsSummaryOp } = await import("@/lib/admin/ops/analytics");
const { runOp } = await import("@/lib/admin/op");
const { can } = await import("@/lib/admin/permissions");

const dialect = new PgDialect();
const sqlText = (q: unknown) => dialect.sqlToQuery(q as SQL).sql;

beforeEach(() => {
  state.queries = [];
  state.role = "analyst";
});

describe("analytics are counts only", () => {
  it("no email address or personal string reaches the summary", async () => {
    const out = JSON.stringify(await analyticsSummary());
    expect(out).not.toMatch(/@/);
    for (const v of Object.values(PERSONAL)) expect(out).not.toContain(v);
  });

  it("no query selects email addresses, names or message content", async () => {
    await analyticsSummary();
    expect(state.queries.length).toBeGreaterThan(5);
    for (const q of state.queries) {
      const text = sqlText(q);
      expect(text).not.toMatch(/"email"|"name"|"content"|"input_summary"|"detail"|"title"/);
    }
  });

  it("the analyst gets it through the admin pipeline, without emails", async () => {
    expect(can("analyst", "analytics.read")).toBe(true);
    const r = await runOp(analyticsSummaryOp, {}, { platform: "web" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/@/);
  });

  it("roles without analytics.read are refused", async () => {
    state.role = "support";
    expect(await runOp(analyticsSummaryOp, {}, { platform: "web" })).toMatchObject({ ok: false, status: 403 });
    state.role = null;
    expect(await runOp(analyticsSummaryOp, {}, { platform: "web" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("analytics helpers", () => {
  it("stripPersonal hides email addresses at any depth", () => {
    expect(stripPersonal({ a: ["x ana@example.co.uk y"], b: { c: "Bob.Smith+tag@mail.example.com" }, n: 3 })).toEqual({ a: ["x [hidden] y"], b: { c: "[hidden]" }, n: 3 });
  });

  it("labels are identifiers only", () => {
    expect(safeLabel("gmail.search")).toBe("gmail.search");
    expect(safeLabel("ana@example.com")).toBe("other");
    expect(safeLabel("Reply to Ana about the contract")).toBe("other");
  });

  it("fillDays zero-fills missing days", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(fillDays([{ day: "2026-11-11", n: 4 }], 3, now)).toEqual([
      { day: "2026-11-10", value: 0 },
      { day: "2026-11-11", value: 4 },
      { day: "2026-11-12", value: 0 },
    ]);
  });
});
