import { beforeEach, describe, expect, it, vi } from "vitest";

/** Announcements: time window, targeting, dismissals, input rules; and broadcast scheduling through the queue. */
type Call = { op: "update" | "insert" | "delete"; table: unknown; set?: unknown; values?: unknown };
const state = vi.hoisted(() => ({
  role: "admin" as string | null,
  audits: [] as Record<string, unknown>[],
  selects: [] as unknown[][],
  returning: [] as unknown[][],
  calls: [] as { op: string; table: unknown; set?: unknown; values?: unknown }[],
  enqueued: [] as { type: string; payload: unknown; opts: { runAt?: Date; dedupeKey?: string } }[],
}));

function chain(call: Call | null, result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ user: { id: "11111111-2222-4333-8444-555555555555", email: "a@example.com", disabledAt: null }, sessionId: "s1" }) }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/admin/admin-session", () => ({ getAdminSession: async () => ({ id: "a1", createdAt: new Date() }), revokeAdminSessions: async () => {} }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }) }));
vi.mock("@/lib/admin/audit", () => ({
  writeAudit: async (e: Record<string, unknown>) => {
    state.audits.push(e);
  },
}));
vi.mock("@/lib/admin/confirm", () => ({ issueConfirmation: async () => "t", consumeConfirmation: async () => true }));
vi.mock("@/lib/db", async () => ({ db: () => fakeDb, schema: await import("@/lib/db/schema"), rowsOf: (r: unknown) => r }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/ai/router", () => ({}));
vi.mock("@/lib/admin/broadcast", () => ({}));
vi.mock("@/lib/email/send", () => ({}));
vi.mock("@/lib/env", () => ({ appUrl: () => "https://app.invalid" }));
vi.mock("@/lib/admin/broadcast-files", () => ({ resolveBroadcastFiles: async () => [], linkFilesToBroadcast: async () => {}, deleteUnsentFile: async () => {}, mailParts: () => ({}), unsentFilesWithData: async () => [] }));
vi.mock("@/lib/jobs/queue", () => ({
  enqueue: async (_u: string, type: string, payload: unknown, opts: { runAt?: Date; dedupeKey?: string }) => {
    state.enqueued.push({ type, payload, opts });
    return "job1";
  },
}));

const schema = await import("@/lib/db/schema");
const { runOp } = await import("@/lib/admin/op");
const a = await import("@/lib/admin/ops/announcements");
const web = { platform: "web" as const };
const now = new Date("2026-11-12T12:00:00Z");
const H = 3_600_000;
const client = (o: Partial<Parameters<typeof a.announcementTargets>[1]> = {}) => ({ userId: "u1", platform: "web" as const, appVersion: null, signedUpAt: new Date("2026-01-01T00:00:00Z"), isAdmin: false, ...o });

beforeEach(() => {
  state.role = "admin";
  state.audits = [];
  state.selects = [];
  state.returning = [];
  state.calls = [];
  state.enqueued = [];
});

describe("time window", () => {
  const w = (start: number, end: number | null, archived = false) => ({ startsAt: new Date(now.getTime() + start), endsAt: end === null ? null : new Date(now.getTime() + end), archivedAt: archived ? now : null });
  it("is scheduled before the start, live inside, ended after the end", () => {
    expect(a.announcementStatus(w(H, null), now)).toBe("scheduled");
    expect(a.announcementStatus(w(-H, null), now)).toBe("live");
    expect(a.announcementStatus(w(-H, H), now)).toBe("live");
    expect(a.announcementStatus(w(-2 * H, -H), now)).toBe("ended");
    expect(a.announcementStatus(w(-2 * H, 0), now)).toBe("ended");
    expect(a.announcementStatus(w(-H, H, true), now)).toBe("archived");
  });
});

describe("targeting", () => {
  it("empty targeting reaches everyone", () => {
    expect(a.announcementTargets({}, client(), now)).toBe(true);
  });
  it("platforms", () => {
    expect(a.announcementTargets({ platforms: ["android"] }, client(), now)).toBe(false);
    expect(a.announcementTargets({ platforms: ["android"] }, client({ platform: "android", appVersion: "1.2.0" }), now)).toBe(true);
    expect(a.announcementTargets({ platforms: ["web"] }, client({ platform: null }), now)).toBe(false);
  });
  it("app version range applies to the app only", () => {
    const t = { minAppVersion: "1.2.0", maxAppVersion: "1.10.0" };
    expect(a.announcementTargets(t, client({ platform: "android", appVersion: "1.9.3" }), now)).toBe(true);
    expect(a.announcementTargets(t, client({ platform: "android", appVersion: "1.10.0" }), now)).toBe(true);
    expect(a.announcementTargets(t, client({ platform: "android", appVersion: "1.11.0" }), now)).toBe(false);
    expect(a.announcementTargets(t, client({ platform: "android", appVersion: "1.1.9" }), now)).toBe(false);
    expect(a.announcementTargets(t, client({ platform: "web", appVersion: null }), now)).toBe(false);
  });
  it("segments match when the person is in any of them", () => {
    expect(a.announcementTargets({ segments: ["admins"] }, client(), now)).toBe(false);
    expect(a.announcementTargets({ segments: ["admins"] }, client({ isAdmin: true }), now)).toBe(true);
    expect(a.announcementTargets({ segments: ["new_users_30d"] }, client({ signedUpAt: new Date(now.getTime() - 10 * 24 * H) }), now)).toBe(true);
    expect(a.announcementTargets({ segments: ["new_users_30d"] }, client(), now)).toBe(false);
    const before = { segments: ["signed_up_before" as const], signedUpBefore: "2026-06-01T00:00:00.000Z" };
    expect(a.announcementTargets(before, client(), now)).toBe(true);
    expect(a.announcementTargets(before, client({ signedUpAt: new Date("2026-07-01T00:00:00Z") }), now)).toBe(false);
    expect(a.announcementTargets({ segments: ["admins", "beta"] }, client({ isBeta: true }), now)).toBe(true);
  });
  it("deny wins over allow, and allow skips the other rules", () => {
    expect(a.announcementTargets({ platforms: ["android"], allowUserIds: ["u1"] }, client(), now)).toBe(true);
    expect(a.announcementTargets({ allowUserIds: ["u1"], denyUserIds: ["u1"] }, client(), now)).toBe(false);
  });
  it("visible: live, targeted and not dismissed (unless it can't be dismissed)", () => {
    const base = { startsAt: new Date(now.getTime() - H), endsAt: null, archivedAt: null, targeting: {}, dismissible: true };
    const rows = [
      { ...base, id: "live" },
      { ...base, id: "dismissed" },
      { ...base, id: "sticky", dismissible: false },
      { ...base, id: "later", startsAt: new Date(now.getTime() + H) },
      { ...base, id: "ended", endsAt: new Date(now.getTime() - 1) },
      { ...base, id: "android", targeting: { platforms: ["android" as const] } },
    ];
    expect(a.visibleAnnouncements(rows, client(), new Set(["dismissed", "sticky"]), now).map((r) => r.id)).toEqual(["live", "sticky"]);
  });
});

describe("announcement ops", () => {
  const good = { title: "Planned maintenance", body: "Sync pauses on Sunday from 02:00 to 03:00 UTC.", severity: "warning", placement: "banner", href: "/settings", targeting: { platforms: ["android"], segments: [] } };

  it("creates with normalised targeting and an audit row", async () => {
    state.returning = [[{ id: "an1", ...good, dismissible: true, startsAt: new Date(), endsAt: null, archivedAt: null, targeting: { platforms: ["android"] } }]];
    expect(await runOp(a.createAnnouncementOp, good, web)).toEqual({ ok: true, data: { id: "an1", status: "live" } });
    expect(state.calls[0]).toMatchObject({ op: "insert", table: schema.systemAnnouncements });
    expect((state.calls[0]!.values as { targeting: unknown }).targeting).toEqual({ platforms: ["android"] });
    expect(state.audits).toEqual([expect.objectContaining({ action: "announcement.create", outcome: "success", resourceId: "an1" })]);
  });

  it("only allows in-app links, like broadcasts", async () => {
    for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      expect(await runOp(a.createAnnouncementOp, { ...good, href }, web), href).toMatchObject({ status: 400 });
    }
  });

  it("refuses an end before the start and a missing sign-up date for that segment", async () => {
    expect(await runOp(a.createAnnouncementOp, { ...good, startsAt: new Date(Date.now() + 2 * H).toISOString(), endsAt: new Date(Date.now() + H).toISOString() }, web)).toMatchObject({ status: 400 });
    expect(await runOp(a.createAnnouncementOp, { ...good, targeting: { segments: ["signed_up_before"] } }, web)).toMatchObject({ status: 400 });
    expect(await runOp(a.createAnnouncementOp, { ...good, targeting: { minAppVersion: "2.0.0", maxAppVersion: "1.0.0" } }, web)).toMatchObject({ status: 400 });
  });

  it("support and analysts can't manage announcements", async () => {
    for (const role of ["support", "analyst", "moderator"]) {
      state.role = role;
      expect(await runOp(a.createAnnouncementOp, good, web), role).toMatchObject({ status: 403 });
    }
  });

  it("archived announcements can't be edited; archiving takes it down", async () => {
    const row = { id: "an1", title: "t", body: "b", severity: "info", placement: "banner", href: null, dismissible: true, startsAt: new Date(now), endsAt: null, targeting: {}, archivedAt: null };
    state.selects = [[{ ...row, archivedAt: new Date() }]];
    expect(await runOp(a.updateAnnouncementOp, { id: "44444444-4444-4444-8444-444444444444", ...good }, web)).toMatchObject({ status: 400, error: "Archived announcements can't be edited. Create a new one." });
    state.selects = [[row]];
    expect(await runOp(a.archiveAnnouncementOp, { id: "44444444-4444-4444-8444-444444444444" }, web)).toMatchObject({ ok: true });
    expect(state.calls.at(-1)).toMatchObject({ op: "update", table: schema.systemAnnouncements });
  });
});

describe("scheduled broadcasts", () => {
  const msg = { title: "New: weekly review", body: "Your weekly review is ready every Friday.", channels: ["in_app", "push"] };

  it("queues the first job at the chosen time instead of sending now", async () => {
    const at = new Date(Date.now() + 24 * H);
    state.returning = [[{ id: "b1" }]];
    expect(await runOp(a.scheduleBroadcastOp, { ...msg, sendAt: at.toISOString() }, web)).toEqual({ ok: true, data: { id: "b1", sendAt: at.toISOString() } });
    expect(state.calls[0]).toMatchObject({ op: "insert", table: schema.broadcasts, values: { status: "queued", title: msg.title } });
    expect(state.enqueued).toEqual([{ type: "broadcast", payload: { broadcastId: "b1" }, opts: { runAt: at, dedupeKey: "broadcast:b1:start" } }]);
  });

  it("refuses a time in the past or too far ahead", async () => {
    expect(await runOp(a.scheduleBroadcastOp, { ...msg, sendAt: new Date(Date.now() - H).toISOString() }, web)).toMatchObject({ status: 400 });
    expect(await runOp(a.scheduleBroadcastOp, { ...msg, sendAt: new Date(Date.now() + 90 * 24 * H).toISOString() }, web)).toMatchObject({ status: 400 });
  });

  it("cancels only before it starts sending", async () => {
    state.selects = [[{ status: "queued", cursor: null }]];
    expect(await runOp(a.cancelScheduledBroadcastOp, { id: "55555555-5555-4555-8555-555555555555" }, web)).toMatchObject({ ok: true });
    expect(state.calls.map((c) => [c.op, c.table])).toEqual([
      ["update", schema.broadcasts],
      ["delete", schema.jobs],
    ]);
    state.selects = [[{ status: "sending", cursor: "x" }]];
    expect(await runOp(a.cancelScheduledBroadcastOp, { id: "55555555-5555-4555-8555-555555555555" }, web)).toMatchObject({ status: 400 });
  });
});
