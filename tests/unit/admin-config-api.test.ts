import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/config with the database replaced by queued query results.
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; disabledAt: null; createdAt: Date }; sessionId: string },
  values: [] as { key: string; value: unknown }[],
  tables: {} as Record<string, unknown[]>,
  flagRows: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => null }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/env", () => ({ appUrl: () => "https://cowork.test" }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/config/store", async () => {
  const reg = await import("@/lib/config/registry");
  return {
    getConfigSnapshot: async () => ({ values: reg.resolveValues(state.values), configVersion: state.values.length, loadedAt: Date.now(), fromDatabase: true }),
  };
});
vi.mock("@/lib/flags/store", async () => {
  const ev = await import("@/lib/flags/evaluate");
  return {
    flagContext: async (user: { id: string; createdAt: Date }) => ({ userId: user.id, platform: "web", appVersion: null, isAdmin: false, userCreatedAt: user.createdAt, now: new Date() }),
    evaluateFlagsFor: async (ctx: Parameters<typeof ev.evaluateAll>[1]) => ev.evaluateAll(state.flagRows as Parameters<typeof ev.evaluateAll>[0], ctx),
  };
});
vi.mock("@/lib/db", () => {
  // Each query resolves to the rows given for the table it reads (.from(schema.x)).
  const schema = new Proxy({}, { get: (_t, name) => new Proxy({ __name: name }, { get: (o, p) => (p === "__name" ? o.__name : {}) }) });
  const db = () => {
    let table = "";
    const chain: unknown = new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(state.tables[table] ?? []);
        if (prop === "from")
          return (t: { __name: string }) => {
            table = t.__name;
            return chain;
          };
        return () => chain;
      },
      apply: () => chain,
    });
    return chain;
  };
  return { db, schema };
});
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}), gt: () => ({}), isNull: () => ({}), lte: () => ({}), or: () => ({}) }));

const { GET } = await import("@/app/api/config/route");

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "p@example.com", disabledAt: null, createdAt: new Date("2026-01-01") };
const ann = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `T ${id}`, body: "B", severity: "info", placement: "banner", href: null, dismissible: true, targeting: {}, startsAt: new Date(0), ...extra });

function get(headers: Record<string, string> = {}) {
  return GET(new Request("https://cowork.test/api/config", { headers }));
}

beforeEach(() => {
  state.session = null;
  state.values = [];
  state.tables = {};
  state.flagRows = [];
});

describe("GET /api/config", () => {
  it("without a session: public subset, public cache headers and an ETag", async () => {
    state.tables = { systemAnnouncements: [ann("a1"), ann("a2", { targeting: { segments: ["admins"] } })] };
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    expect(res.headers.get("etag")).toMatch(/^".+"$/);
    const body = await res.json();
    expect(body.maintenance).toEqual({ active: false, message: null, endsAt: null });
    expect(body.update.status).toBe("ok");
    expect(body.settings.uploads.maxMb).toBe(4);
    expect(body.flags).toBeUndefined();
    expect(body.restrictions).toBeUndefined();
    // Targeted announcements need a session.
    expect(body.announcements.map((a: { id: string }) => a.id)).toEqual(["a1"]);
    expect(JSON.stringify(body)).not.toContain("targeting");
  });

  it("answers 304 when the ETag matches", async () => {
    const first = await get();
    const etag = first.headers.get("etag")!;
    const second = await get({ "if-none-match": etag });
    expect(second.status).toBe(304);
  });

  it("stays up during maintenance and reports it", async () => {
    state.values = [
      { key: "maintenance.active", value: true },
      { key: "maintenance.message", value: "Back at noon." },
    ];
    const body = await (await get()).json();
    expect(body.maintenance).toMatchObject({ active: true, message: "Back at noon." });
  });

  it("with a session: flags, restrictions, private cache, dismissed announcements removed", async () => {
    state.session = { user: USER, sessionId: "s1" };
    state.tables = {
      systemAnnouncements: [ann("a1"), ann("a2"), ann("a3", { dismissible: false })],
      announcementDismissals: [{ id: "a2" }, { id: "a3" }],
      userRestrictions: [{ feature: "uploads", expiresAt: null }],
    };
    const res = await get();
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    const body = await res.json();
    expect(body.announcements.map((a: { id: string }) => a.id)).toEqual(["a1", "a3"]);
    expect(body.flags).toMatchObject({ "chat.attachments": true });
    expect(body.restrictions).toEqual([{ feature: "uploads", expiresAt: null }]);
  });

  it("tells an outdated app build that an update is required", async () => {
    state.values = [{ key: "updates.android", value: { minBuild: 5, latestVersion: "1.3.0", latestBuild: 7, mode: "optional", message: "Please update.", storeUrl: "https://play.google.com/store/apps/details?id=x" } }];
    const old = await (await get({ "x-cowork-platform": "android", "x-cowork-build": "4" })).json();
    expect(old.update).toMatchObject({ status: "required", latestVersion: "1.3.0", message: "Please update." });
    const mid = await (await get({ "x-cowork-platform": "android", "x-cowork-build": "6" })).json();
    expect(mid.update.status).toBe("optional");
    const none = await (await get({ authorization: `Bearer ${"t".repeat(40)}` })).json();
    expect(none.update.status).toBe("required");
    const web = await (await get()).json();
    expect(web.update.status).toBe("ok");
  });
});
