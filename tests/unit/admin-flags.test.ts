import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const flagState = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/flags/store", () => ({
  flagContext: async () => ({ userId: "u", platform: "web", appVersion: null, isAdmin: false, userCreatedAt: null, now: new Date() }),
  isFlagOn: async () => flagState.on,
}));
vi.mock("@/lib/env", () => ({ appUrl: () => "https://cowork.test" }));

const { bucket, evaluateAll, evaluateFlag, inWindow, targetingDecision, targetingSchema } = await import("@/lib/flags/evaluate");
const { FLAG_DEFS } = await import("@/lib/flags/registry");
const { requireFlag } = await import("@/lib/flags/require");

type Ctx = Parameters<typeof evaluateFlag>[2];
type Row = NonNullable<Parameters<typeof evaluateFlag>[1]>;

const KEY = FLAG_DEFS[0]!.key;
const NOW = new Date("2026-11-12T12:00:00Z");
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ userId: "8a6f3c1e-0000-4000-8000-000000000001", platform: "web", appVersion: null, isAdmin: false, userCreatedAt: new Date("2026-01-01"), now: NOW, ...over });
const row = (over: Partial<Row> = {}): Row => ({ key: KEY, enabled: true, rolloutPercent: 100, targeting: {}, startsAt: null, endsAt: null, archivedAt: null, ...over });

/** Deterministic ids that look like the real ones. */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);

describe("bucketing", () => {
  it("is stable for the same flag and person", () => {
    for (const id of ids(50)) expect(bucket(KEY, id)).toBe(bucket(KEY, id));
    expect(bucket("a.flag", "same-user")).toBe(bucket("a.flag", "same-user"));
  });

  it("differs between flags, so the same people aren't always first", () => {
    const people = ids(1000);
    const same = people.filter((id) => bucket("flag.one", id) === bucket("flag.two", id)).length;
    expect(same).toBeLessThan(50);
  });

  it.each([1, 10, 25, 50, 90])("lands within 1 percent of a %i percent rollout over 10,000 ids", (pct) => {
    const people = ids(10_000);
    const on = people.filter((id) => evaluateFlag(KEY, row({ rolloutPercent: pct }), ctx({ userId: id }))).length;
    expect(Math.abs(on / 100 - pct)).toBeLessThanOrEqual(1);
  });

  it("raising the percentage only adds people", () => {
    const people = ids(2000);
    const at20 = new Set(people.filter((id) => evaluateFlag(KEY, row({ rolloutPercent: 20 }), ctx({ userId: id }))));
    const at40 = new Set(people.filter((id) => evaluateFlag(KEY, row({ rolloutPercent: 40 }), ctx({ userId: id }))));
    for (const id of at20) expect(at40.has(id)).toBe(true);
  });

  it("0 percent is nobody and 100 percent is everybody", () => {
    const people = ids(500);
    expect(people.some((id) => evaluateFlag(KEY, row({ rolloutPercent: 0 }), ctx({ userId: id })))).toBe(false);
    expect(people.every((id) => evaluateFlag(KEY, row({ rolloutPercent: 100 }), ctx({ userId: id })))).toBe(true);
  });
});

describe("evaluation order", () => {
  it("uses the code default when there is no row or the row is archived", () => {
    const def = FLAG_DEFS[0]!.default;
    expect(evaluateFlag(KEY, null, ctx())).toBe(def);
    expect(evaluateFlag(KEY, row({ enabled: !def, archivedAt: new Date() }), ctx())).toBe(def);
  });

  it("a flag in the database but not in code does nothing", () => {
    expect(evaluateFlag("not.in.code", row({ key: "not.in.code" }), ctx())).toBe(false);
    expect(Object.keys(evaluateAll([row({ key: "not.in.code" })], ctx()))).not.toContain("not.in.code");
  });

  it("disabled is off for everyone, even the allow list", () => {
    expect(evaluateFlag(KEY, row({ enabled: false, targeting: { allowUserIds: [ctx().userId!] } }), ctx())).toBe(false);
  });

  it("respects the time window", () => {
    expect(inWindow(new Date("2026-11-13T00:00:00Z"), null, NOW)).toBe(false);
    expect(inWindow(null, new Date("2026-11-12T12:00:00Z"), NOW)).toBe(false);
    expect(inWindow(new Date("2026-11-12T11:59:59Z"), new Date("2026-11-12T12:00:01Z"), NOW)).toBe(true);
    expect(evaluateFlag(KEY, row({ startsAt: new Date("2026-11-13T00:00:00Z") }), ctx())).toBe(false);
    expect(evaluateFlag(KEY, row({ endsAt: new Date("2026-11-11T00:00:00Z") }), ctx())).toBe(false);
    expect(evaluateFlag(KEY, row({ startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: new Date("2026-12-01T00:00:00Z") }), ctx())).toBe(true);
  });

  it("deny list wins over the allow list, and the allow list skips the rollout", () => {
    const id = ctx().userId!;
    expect(evaluateFlag(KEY, row({ targeting: { allowUserIds: [id], denyUserIds: [id] } }), ctx())).toBe(false);
    expect(evaluateFlag(KEY, row({ rolloutPercent: 0, targeting: { allowUserIds: [id], platforms: ["android"] } }), ctx())).toBe(true);
  });

  it("matches platform, app version and segments", () => {
    expect(targetingDecision({ platforms: ["android"] }, ctx())).toBe("no_match");
    expect(targetingDecision({ platforms: ["android"] }, ctx({ platform: "android" }))).toBe("match");
    expect(targetingDecision({ minAppVersion: "1.2.0" }, ctx({ appVersion: null }))).toBe("no_match");
    expect(targetingDecision({ minAppVersion: "1.2.0" }, ctx({ appVersion: "1.10.0" }))).toBe("match");
    expect(targetingDecision({ maxAppVersion: "1.2.0" }, ctx({ appVersion: "1.2.1" }))).toBe("no_match");
    expect(targetingDecision({ segments: ["admins"] }, ctx())).toBe("no_match");
    expect(targetingDecision({ segments: ["admins"] }, ctx({ isAdmin: true }))).toBe("match");
    expect(targetingDecision({ segments: ["new_users_30d"] }, ctx({ userCreatedAt: new Date("2026-11-01") }))).toBe("match");
    expect(targetingDecision({ segments: ["new_users_30d"] }, ctx())).toBe("no_match");
    expect(targetingDecision({ segments: ["signed_up_before"], signedUpBefore: "2026-06-01T00:00:00Z" }, ctx())).toBe("match");
    expect(targetingDecision({ segments: ["beta"] }, ctx())).toBe("no_match");
    expect(targetingDecision({ segments: ["admins"] }, ctx({ userId: null, isAdmin: true }))).toBe("no_match");
  });

  it("validates targeting from the console", () => {
    expect(targetingSchema.safeParse({ platforms: ["ios"] }).success).toBe(false);
    expect(targetingSchema.safeParse({ allowUserIds: ["not-a-uuid"] }).success).toBe(false);
    expect(targetingSchema.safeParse({ segments: ["signed_up_before"] }).success).toBe(false);
    expect(targetingSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(targetingSchema.safeParse({ platforms: ["web"], minAppVersion: "1.0.0" }).success).toBe(true);
  });
});

describe("requireFlag", () => {
  const user = { id: "u", createdAt: new Date(), disabledAt: null };
  const req = new Request("https://cowork.test/api/chat/attach", { method: "POST" });

  it("answers 403 feature_off when the flag is off, so the API refuses it", async () => {
    flagState.on = false;
    const res = await requireFlag(KEY, user, req);
    expect(res?.status).toBe(403);
    expect(await res!.json()).toMatchObject({ code: "feature_off" });
  });

  it("lets the request through when the flag is on", async () => {
    flagState.on = true;
    expect(await requireFlag(KEY, user, req)).toBeNull();
  });

  it("refuses keys that aren't in the registry", async () => {
    await expect(requireFlag("not.in.code", user, req)).rejects.toThrow();
  });
});
