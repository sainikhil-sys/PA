import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * registration.open from the console: null follows SIGNUP_MODE, open admits anyone, closed stops new
 * accounts only. Existing accounts keep signing in. Covers the pure rule, mayUseApp and the email-code flow.
 */
const state = vi.hoisted(() => ({
  envOpen: true,
  allowed: [] as string[],
  registration: null as boolean | null,
  existing: null as null | { id: string; disabledAt: null },
  otpRow: null as null | Record<string, unknown>,
  sent: [] as string[],
  inserts: 0,
}));

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy", "set", "values", "onConflictDoNothing", "onConflictDoUpdate"]) c[m] = () => c;
  c.returning = () => Promise.resolve([]);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}
const fakeDb = {
  select: () => chain(() => (state.otpRow ? [state.otpRow] : [])),
  update: () => chain(() => []),
  insert: () => {
    state.inserts++;
    return chain(() => []);
  },
  query: { users: { findFirst: async () => state.existing } },
};

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/db", async () => ({ db: () => fakeDb, schema: await import("@/lib/db/schema") }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/env", () => ({
  signupOpen: () => state.envOpen,
  allowedEmails: () => state.allowed,
  adminEmails: () => [],
  requireEnv: () => "test-secret-test-secret-test-secret",
  isTestMode: () => true,
}));
vi.mock("@/lib/config/store", () => ({
  getConfigValue: async (key: string) => (key === "registration.open" ? state.registration : undefined),
  newAccountNotificationDefaults: async () => ({}),
}));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }) }));
vi.mock("@/lib/auth/mail", () => ({
  sendOtpEmail: async (email: string) => {
    state.sent.push(email);
  },
  sendWelcomeEmail: async () => {},
}));
vi.mock("@/lib/auth/session", () => ({ createSession: async () => "token" }));
vi.mock("@/lib/db/queries/activity", () => ({ logActivity: async () => {} }));

const { signInAllowed } = await import("@/lib/auth/otp-core");
const { mayUseApp } = await import("@/lib/auth/policy");
const otp = await import("@/lib/auth/otp");

beforeEach(() => {
  state.envOpen = true;
  state.allowed = [];
  state.registration = null;
  state.existing = null;
  state.otpRow = null;
  state.sent = [];
  state.inserts = 0;
});

describe("signInAllowed", () => {
  const rule = (email: string, hasAccount: boolean, envOpen: boolean, registrationOpen: boolean | null, allowed: string[] = []) => signInAllowed(email, { hasAccount, envOpen, registrationOpen, allowed });

  it("null follows the server setting", () => {
    expect(rule("new@example.com", false, true, null)).toBe(true);
    expect(rule("new@example.com", false, false, null)).toBe(false);
    expect(rule("ok@example.com", false, false, null, ["ok@example.com"])).toBe(true);
    expect(rule("old@example.com", true, false, null)).toBe(false);
  });
  it("closed stops new accounts but not existing ones", () => {
    expect(rule("new@example.com", false, true, false)).toBe(false);
    expect(rule("old@example.com", true, true, false)).toBe(true);
    // The allowlist still works as an invite list.
    expect(rule("invited@example.com", false, true, false, ["invited@example.com"])).toBe(true);
  });
  it("closing never admits an account the server setting refuses", () => {
    expect(rule("old@example.com", true, false, false)).toBe(false);
  });
  it("open admits anyone with a well-formed address, even over an allowlist", () => {
    expect(rule("new@example.com", false, false, true)).toBe(true);
    expect(rule("not-an-email", false, false, true)).toBe(false);
  });
});

describe("mayUseApp", () => {
  it("existing accounts keep their session when registration closes", async () => {
    state.registration = false;
    expect(await mayUseApp("old@example.com", { hasAccount: true })).toBe(true);
    expect(await mayUseApp("new@example.com", { hasAccount: false })).toBe(false);
  });
  it("opening from the console overrides an allowlist server setting", async () => {
    state.envOpen = false;
    state.registration = true;
    expect(await mayUseApp("new@example.com", { hasAccount: false })).toBe(true);
    state.registration = null;
    expect(await mayUseApp("new@example.com", { hasAccount: false })).toBe(false);
  });
});

describe("email codes with registration closed", () => {
  it("a new address gets the same answer but no code is created or sent", async () => {
    state.registration = false;
    const r = await otp.requestOtp("new@example.com", "203.0.113.9");
    expect(r).toEqual({ ok: true, message: otp.GENERIC_SENT });
    expect(state.sent).toEqual([]);
    expect(state.inserts).toBe(0);
  });
  it("an existing account still gets a code", async () => {
    state.registration = false;
    state.existing = { id: "u1", disabledAt: null };
    const r = await otp.requestOtp("old@example.com", "203.0.113.9");
    expect(r).toEqual({ ok: true, message: otp.GENERIC_SENT });
    expect(state.sent).toEqual(["old@example.com"]);
  });
  it("a code for a new address is refused at verification once registration closes", async () => {
    const { hashOtp, TEST_OTP_CODE } = await import("@/lib/auth/otp-core");
    state.otpRow = { id: "c1", attempts: 0, codeHash: hashOtp("new@example.com", TEST_OTP_CODE, "test-secret-test-secret-test-secret") };
    state.registration = false;
    const r = await otp.verifyOtp("new@example.com", TEST_OTP_CODE, "203.0.113.9");
    expect(r).toEqual({ ok: false, message: otp.GENERIC_INVALID });
    expect(state.inserts).toBe(0);
  });
});
