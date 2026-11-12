import { beforeEach, describe, expect, it, vi } from "vitest";

// apiGuard and the enforcement helpers with every server dependency replaced.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; disabledAt: null; createdAt: Date },
  role: null as null | string,
  values: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getOwner: async () => state.user }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/env", () => ({ appUrl: () => "https://cowork.test" }));
vi.mock("@/lib/config/store", async () => {
  const reg = await import("@/lib/config/registry");
  const snap = () => reg.resolveValues([...state.values].map(([key, value]) => ({ key, value })));
  return {
    getMaintenance: async () => reg.maintenanceFrom(snap()),
    getUpdatePolicy: async () => {
      const r = reg.updatePolicySchema.safeParse(snap().get("updates.android"));
      return r.success ? r.data : reg.DEFAULT_UPDATE_POLICY;
    },
  };
});

const reg = await import("@/lib/config/registry");
const { apiGuard } = await import("@/lib/auth/api");
const { isUpdateExempt } = await import("@/lib/config/enforce");

const USER = { id: "u1", email: "person@example.com", disabledAt: null, createdAt: new Date("2026-01-01") };

function req(path: string, init: { method?: string; bearer?: boolean; build?: string } = {}) {
  const h = new Headers();
  if (init.bearer) h.set("authorization", `Bearer ${"t".repeat(40)}`);
  if (init.build !== undefined) h.set("x-cowork-build", init.build);
  return new Request(`https://cowork.test${path}`, { method: init.method ?? "GET", headers: h });
}

beforeEach(() => {
  state.user = USER;
  state.role = null;
  state.values = new Map();
});

describe("configuration registry", () => {
  it("rejects unknown keys on write", () => {
    const r = reg.validateWrite("made.up", true);
    expect(r.ok).toBe(false);
  });

  it("enforces each key's schema", () => {
    expect(reg.validateWrite("uploads.maxMb", 3).ok).toBe(true);
    expect(reg.validateWrite("uploads.maxMb", 50).ok).toBe(false);
    expect(reg.validateWrite("uploads.maxMb", "4").ok).toBe(false);
    expect(reg.validateWrite("registration.open", null).ok).toBe(true);
    expect(reg.validateWrite("appearance.defaultScheme", "purple").ok).toBe(false);
    expect(reg.validateWrite("appearance.loginNotice", "<script>x</script>").ok).toBe(false);
    expect(reg.validateWrite("maintenance.endsAt", "tomorrow").ok).toBe(false);
    expect(reg.validateWrite("ai.priceTable", { "m-1": { inputPerMillion: 1, outputPerMillion: 2 } }).ok).toBe(true);
    expect(reg.validateWrite("ai.priceTable", { "m-1": { inputPerMillion: -1, outputPerMillion: 2 } }).ok).toBe(false);
  });

  it("ignores unknown keys on read and falls back to defaults for invalid stored values", () => {
    const values = reg.resolveValues([
      { key: "made.up", value: 1 },
      { key: "uploads.maxMb", value: 999 },
      { key: "ai.voice", value: false },
    ]);
    expect(values.has("made.up")).toBe(false);
    expect(values.get("uploads.maxMb")).toBe(4);
    expect(values.get("ai.voice")).toBe(false);
  });

  it("sends only public keys to clients, nested by key", () => {
    const s = reg.publicSettings(reg.resolveValues([{ key: "ai.voice", value: false }]));
    expect(s).toMatchObject({ uploads: { maxMb: 4 }, ai: { voice: false, chat: true } });
    expect(JSON.stringify(s)).not.toContain("priceTable");
    expect(JSON.stringify(s)).not.toContain("dailyTokenLimitPerUser");
    expect(s).not.toHaveProperty("maintenance");
    expect(s).not.toHaveProperty("updates");
  });

  it("every key has a valid default, a known group and a field", () => {
    for (const e of reg.CONFIG_ENTRIES) {
      expect(e.schema.safeParse(e.default).success, e.key).toBe(true);
      expect(reg.CONFIG_GROUPS.some((g) => g.id === e.group), e.key).toBe(true);
      expect(e.field.kind, e.key).toBeTruthy();
    }
  });

  it("maintenance keys are owner-only and destructive", () => {
    for (const k of ["maintenance.active", "maintenance.message", "maintenance.endsAt", "maintenance.pauseJobs"]) {
      expect(reg.classifyChange(k, true, false)).toEqual({ permission: "maintenance.write", risk: "destructive" });
    }
    expect(reg.classifyChange("appearance.loginNotice", "x", null)?.permission).toBe("appearance.write");
    expect(reg.classifyChange("nope", 1, 0)).toBeNull();
  });

  it("redacts secret or personal keys for the audit log", () => {
    const e = { ...reg.configEntry("uploads.maxMb")!, secret: true };
    expect(reg.auditValue(e, 4)).toBe("[redacted]");
    expect(reg.auditValue(reg.configEntry("uploads.maxMb")!, 4)).toBe(4);
  });

  it("Retry-After follows the expected end, within a minute and a day", () => {
    const now = Date.parse("2026-11-12T10:00:00Z");
    expect(reg.retryAfterSeconds(null, now)).toBe(300);
    expect(reg.retryAfterSeconds("2026-11-12T10:30:00Z", now)).toBe(1800);
    expect(reg.retryAfterSeconds("2026-11-12T09:00:00Z", now)).toBe(60);
    expect(reg.retryAfterSeconds("2026-11-20T10:00:00Z", now)).toBe(86_400);
  });
});

describe("maintenance enforcement in apiGuard", () => {
  it("passes everyone when maintenance is off", async () => {
    const g = await apiGuard(req("/api/tasks"));
    expect("user" in g).toBe(true);
  });

  it("answers 503 with code, message, endsAt and Retry-After to people without a role", async () => {
    state.values.set("maintenance.active", true);
    state.values.set("maintenance.message", "Back soon.");
    state.values.set("maintenance.endsAt", new Date(Date.now() + 600_000).toISOString());
    const g = await apiGuard(req("/api/tasks"));
    expect("response" in g).toBe(true);
    if (!("response" in g)) return;
    expect(g.response.status).toBe(503);
    expect(Number(g.response.headers.get("retry-after"))).toBeGreaterThanOrEqual(590);
    const body = await g.response.json();
    expect(body).toMatchObject({ code: "maintenance", message: "Back soon." });
    expect(body.endsAt).toBeTruthy();
  });

  it("lets role holders through so they can check the system", async () => {
    state.values.set("maintenance.active", true);
    state.role = "support";
    const g = await apiGuard(req("/api/tasks"));
    expect("user" in g).toBe(true);
  });

  it("keeps sign-out up during maintenance", async () => {
    state.values.set("maintenance.active", true);
    const g = await apiGuard(req("/api/mobile/auth/sign-out", { method: "POST", bearer: true }));
    expect("user" in g).toBe(true);
  });

  it("still answers 401 before anything else without a session", async () => {
    state.user = null;
    state.values.set("maintenance.active", true);
    const g = await apiGuard(req("/api/tasks"));
    expect("response" in g && g.response.status).toBe(401);
  });
});

describe("exempt routes", () => {
  it("config, sign-out, export and account deletion are exempt from the update check", () => {
    expect(isUpdateExempt("/api/config", "GET")).toBe(true);
    expect(isUpdateExempt("/api/config/announcements/x/dismiss", "POST")).toBe(true);
    expect(isUpdateExempt("/api/mobile/auth/sign-out", "POST")).toBe(true);
    expect(isUpdateExempt("/api/export", "GET")).toBe(true);
    expect(isUpdateExempt("/api/mobile/me", "DELETE")).toBe(true);
    expect(isUpdateExempt("/api/mobile/me", "GET")).toBe(false);
    expect(isUpdateExempt("/api/mobile/tasks", "GET")).toBe(false);
  });
});
