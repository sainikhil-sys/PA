import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ policy: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => null }));
vi.mock("@/lib/config/store", async () => {
  const reg = await import("@/lib/config/registry");
  return {
    getMaintenance: async () => reg.maintenanceFrom(reg.resolveValues([])),
    getUpdatePolicy: async () => {
      const r = reg.updatePolicySchema.safeParse(state.policy);
      return r.success ? r.data : reg.DEFAULT_UPDATE_POLICY;
    },
  };
});

const { compareVersions, parseVersion, readClientHeaders } = await import("@/lib/config/version");
const { classifyChange, effectiveMinBuild, updatePolicySchema, updateStatus, DEFAULT_UPDATE_POLICY } = await import("@/lib/config/registry");
const { updateRequiredResponse } = await import("@/lib/config/enforce");

// The pure guard from the releases ops, without loading the database module.
vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
vi.mock("@/lib/auth/action", () => ({ UserFacingError: class extends Error {} }));
const { minimumBlockedReason } = await import("@/lib/admin/ops/releases");

const policy = (over: Partial<typeof DEFAULT_UPDATE_POLICY> = {}) => ({ ...DEFAULT_UPDATE_POLICY, storeUrl: "https://play.google.com/store/apps/details?id=x", ...over });

function req(path: string, headers: Record<string, string>, method = "GET") {
  return new Request(`https://cowork.test${path}`, { method, headers });
}
const BEARER = { authorization: `Bearer ${"t".repeat(40)}` };

beforeEach(() => {
  state.policy = null;
});

describe("version comparison", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(0);
    expect(compareVersions("v1.3.0", "1.2.9")).toBe(1);
  });

  it("sorts invalid versions lowest", () => {
    expect(compareVersions("garbage", "0.0.1")).toBe(-1);
    expect(compareVersions("1.0.0", null)).toBe(1);
    expect(parseVersion("1.2.3.4.5")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("client headers", () => {
  it("keeps only well-formed values", () => {
    const h = new Headers({ "x-cowork-platform": "Android", "x-cowork-app-version": "1.2.0", "x-cowork-build": "12", "x-cowork-runtime": "abc123", "x-cowork-update": "u-1" });
    expect(readClientHeaders(h)).toEqual({ platform: "android", appVersion: "1.2.0", build: 12, runtimeVersion: "abc123", updateId: "u-1" });
    const bad = new Headers({ "x-cowork-platform": "ios<", "x-cowork-app-version": "<script>", "x-cowork-build": "12a", "x-cowork-runtime": "a b" });
    expect(readClientHeaders(bad)).toEqual({ platform: null, appVersion: null, build: null, runtimeVersion: null, updateId: null });
  });
});

describe("update policy", () => {
  it("required mode makes the latest build the minimum", () => {
    expect(effectiveMinBuild(policy({ minBuild: 3 }))).toBe(3);
    expect(effectiveMinBuild(policy({ minBuild: 3, latestBuild: 8, mode: "required" }))).toBe(8);
    expect(effectiveMinBuild(policy({ minBuild: 9, latestBuild: 8, mode: "required" }))).toBe(9);
  });

  it("status: missing build header counts as build 0", () => {
    const p = policy({ minBuild: 5, latestBuild: 7 });
    expect(updateStatus(p, null)).toBe("required");
    expect(updateStatus(p, 4)).toBe("required");
    expect(updateStatus(p, 5)).toBe("optional");
    expect(updateStatus(p, 7)).toBe("ok");
    expect(updateStatus(DEFAULT_UPDATE_POLICY, null)).toBe("ok");
  });

  it("validates the policy", () => {
    expect(updatePolicySchema.safeParse(policy({ mode: "required", latestBuild: null })).success).toBe(false);
    expect(updatePolicySchema.safeParse(policy({ storeUrl: "http://example.com" })).success).toBe(false);
    expect(updatePolicySchema.safeParse(policy({ storeUrl: "javascript:alert(1)" })).success).toBe(false);
    expect(updatePolicySchema.safeParse(policy({ latestVersion: "1.2" })).success).toBe(false);
    expect(updatePolicySchema.safeParse(policy({ minBuild: 2, latestVersion: "1.2.0", latestBuild: 3 })).success).toBe(true);
  });

  it("raising the required build needs the owner and a confirmation; other edits don't", () => {
    expect(classifyChange("updates.android", policy({ minBuild: 4 }), policy({ minBuild: 3 }))).toEqual({ permission: "releases.mandatory", risk: "destructive" });
    expect(classifyChange("updates.android", policy({ latestBuild: 9, mode: "required" }), policy({ latestBuild: 9 }))).toEqual({ permission: "releases.mandatory", risk: "destructive" });
    expect(classifyChange("updates.android", policy({ minBuild: 2 }), policy({ minBuild: 3 }))).toEqual({ permission: "releases.write", risk: "normal" });
    expect(classifyChange("updates.android", policy({ message: "New" }), policy())).toEqual({ permission: "releases.write", risk: "normal" });
  });
});

describe("minimum build guard", () => {
  it("refuses a minimum until a live store build has reported its version", () => {
    expect(minimumBlockedReason(2, [])).toMatch(/No live store build/);
    expect(minimumBlockedReason(2, [{ buildNumber: 2, sendsHeaders: false }])).toMatch(/No live store build/);
    expect(minimumBlockedReason(2, [{ buildNumber: 2, sendsHeaders: true }])).toBeNull();
  });

  it("refuses a minimum above the newest live build", () => {
    expect(minimumBlockedReason(5, [{ buildNumber: 3, sendsHeaders: true }])).toMatch(/newest live store build is 3/);
  });

  it("removing the minimum is always allowed", () => {
    expect(minimumBlockedReason(0, [])).toBeNull();
  });
});

describe("426 Upgrade Required", () => {
  it("answers 426 to app requests below the minimum, treating a missing header as build 0", async () => {
    state.policy = policy({ minBuild: 5, message: "Update Cowork to keep going." });
    const res = await updateRequiredResponse(req("/api/mobile/tasks", BEARER));
    expect(res?.status).toBe(426);
    expect(await res!.json()).toMatchObject({ code: "update_required", message: "Update Cowork to keep going.", storeUrl: "https://play.google.com/store/apps/details?id=x" });
    expect((await updateRequiredResponse(req("/api/mobile/tasks", { ...BEARER, "x-cowork-build": "4" })))?.status).toBe(426);
    expect(await updateRequiredResponse(req("/api/mobile/tasks", { ...BEARER, "x-cowork-build": "5" }))).toBeNull();
  });

  it("never affects website (cookie) requests", async () => {
    state.policy = policy({ minBuild: 5 });
    expect(await updateRequiredResponse(req("/api/tasks", { cookie: "pa_session=x" }))).toBeNull();
    expect(await updateRequiredResponse(req("/api/tasks", { "x-cowork-platform": "android" }))).toBeNull();
  });

  it("keeps config, sign-out, export and account deletion open", async () => {
    state.policy = policy({ minBuild: 5 });
    expect(await updateRequiredResponse(req("/api/config", BEARER))).toBeNull();
    expect(await updateRequiredResponse(req("/api/mobile/auth/sign-out", BEARER, "POST"))).toBeNull();
    expect(await updateRequiredResponse(req("/api/export", BEARER))).toBeNull();
    expect(await updateRequiredResponse(req("/api/mobile/me", BEARER, "DELETE"))).toBeNull();
    expect((await updateRequiredResponse(req("/api/mobile/me", BEARER, "PATCH")))?.status).toBe(426);
  });

  it("does nothing while no minimum is set", async () => {
    expect(await updateRequiredResponse(req("/api/mobile/tasks", BEARER))).toBeNull();
  });
});
