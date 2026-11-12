/* eslint-disable import/no-duplicates -- the ?raw import reads the source text of a module also imported for its exports. */
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, can, flagIsOn, killSwitchState, sectionsFor, type FlagItem } from "../src/features/admin/permissions";
import { adminHeaders, BIOMETRIC_LOCK_AFTER_MS, shouldBiometricLock, useAdminToken } from "../src/features/admin/token-store";
import source from "../src/features/admin/token-store.ts?raw";

describe("admin token store", () => {
  it("never persists: no storage module and no persist middleware", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/async-storage|expo-secure-store|expo-file-system|zustand\/middleware|persist\(/);
    expect((useAdminToken as unknown as { persist?: unknown }).persist).toBeUndefined();
  });

  it("holds the token in memory and forgets it on end", () => {
    useAdminToken.getState().unlock("tok_123", "2026-11-12T12:00:00Z");
    expect(useAdminToken.getState().token).toBe("tok_123");
    expect(adminHeaders(useAdminToken.getState().token)).toEqual({ "X-Cowork-Admin": "tok_123" });
    useAdminToken.getState().end("Your admin session ended.");
    expect(useAdminToken.getState()).toMatchObject({ token: null, expiresAt: null, notice: "Your admin session ended.", biometricLocked: false });
    expect(adminHeaders(null)).toEqual({});
  });
});

describe("biometric lock timing", () => {
  const now = 10_000_000;
  it("locks after 5 minutes in the background when on", () => {
    expect(shouldBiometricLock(true, now - BIOMETRIC_LOCK_AFTER_MS, now)).toBe(true);
    expect(shouldBiometricLock(true, now - BIOMETRIC_LOCK_AFTER_MS + 1, now)).toBe(false);
  });
  it("does nothing when off or never backgrounded", () => {
    expect(shouldBiometricLock(false, now - 10 * BIOMETRIC_LOCK_AFTER_MS, now)).toBe(false);
    expect(shouldBiometricLock(true, null, now)).toBe(false);
  });
});

describe("sections by permission", () => {
  it("shows only what the role may open", () => {
    expect(sectionsFor(["overview.read", "users.read", "users.sessions.revoke"]).map((s) => s.key)).toEqual(["overview", "users"]);
    expect(sectionsFor([]).length).toBe(0);
    expect(sectionsFor(undefined).length).toBe(0);
    expect(sectionsFor(ADMIN_SECTIONS.map((s) => s.permission)).length).toBe(ADMIN_SECTIONS.length);
  });
  it("keeps maintenance behind the owner-only permission", () => {
    expect(can(["config.write", "flags.write"], "maintenance.write")).toBe(false);
    expect(sectionsFor(["maintenance.write"]).map((s) => s.key)).toEqual(["maintenance"]);
  });
});

describe("kill switch", () => {
  const flag: FlagItem = { key: "chat.attachments", label: "Chat attachments", description: "", default: true, state: null, version: 0, updatedAt: null };
  it("starts from the code default when nothing is stored", () => {
    expect(flagIsOn(flag)).toBe(true);
    expect(killSwitchState(flag, false)).toEqual({ enabled: false, rolloutPercent: 100, targeting: {}, startsAt: null, endsAt: null, description: "" });
  });
  it("changes only on or off and keeps rollout, targeting and window", () => {
    const stored: FlagItem = { ...flag, state: { enabled: true, rolloutPercent: 40, targeting: { platforms: ["android"] }, startsAt: null, endsAt: "2027-01-01T00:00:00Z", description: "Pilot" } };
    expect(killSwitchState(stored, false)).toEqual({ ...stored.state, enabled: false });
  });
  it("turning on a flag stored at 0 percent turns it on for everyone it targets", () => {
    const off: FlagItem = { ...flag, default: false };
    expect(killSwitchState(off, true)).toMatchObject({ enabled: true, rolloutPercent: 100 });
  });
});
