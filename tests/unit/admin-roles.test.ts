import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_ROLES, can, isAdminRole, OWNER_ONLY, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/admin/permissions";
import { __resetEnvCache, adminEmails } from "@/lib/env";

describe("admin permissions", () => {
  it("gives the owner every permission", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });

  it("keeps owner-only permissions away from every other role", () => {
    for (const role of ADMIN_ROLES.filter((r) => r !== "owner")) {
      for (const p of OWNER_ONLY) expect(can(role, p)).toBe(false);
    }
  });

  it("never lets a role manage roles except the owner", () => {
    expect(ADMIN_ROLES.filter((r) => can(r, "roles.manage"))).toEqual(["owner"]);
  });

  it("gives admin everything that is not owner-only", () => {
    for (const p of PERMISSIONS) expect(can("admin", p)).toBe(!OWNER_ONLY.has(p));
  });

  it("limits the narrower roles", () => {
    expect(can("support", "users.suspend")).toBe(false);
    expect(can("support", "users.sessions.revoke")).toBe(true);
    expect(can("moderator", "notifications.send")).toBe(false);
    expect(can("analyst", "users.read")).toBe(false);
    expect(can("analyst", "analytics.read")).toBe(true);
  });

  it("only uses permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ADMIN_ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(known.has(p)).toBe(true);
  });

  it("denies everything without a role", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("recognises role names", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("superuser")).toBe(false);
    expect(isAdminRole(1)).toBe(false);
  });
});

describe("adminEmails", () => {
  const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, ALLOWED_EMAILS: process.env.ALLOWED_EMAILS };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetEnvCache();
  });

  it("does not fall back to the sign-in allowlist", () => {
    delete process.env.ADMIN_EMAILS;
    process.env.ALLOWED_EMAILS = "a@example.com,b@example.com";
    __resetEnvCache();
    expect(adminEmails()).toEqual([]);
  });

  it("parses the list", () => {
    process.env.ADMIN_EMAILS = " Owner@Example.com , ops@example.com ,";
    __resetEnvCache();
    expect(adminEmails()).toEqual(["owner@example.com", "ops@example.com"]);
  });
});
