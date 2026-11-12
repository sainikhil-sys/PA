import { describe, expect, it } from "vitest";
import { ADMIN_IDLE_MS, ADMIN_MAX_MS, canonicalJson, checkAdminSession, emailHash, inputHash, ipPrefix, redactForAudit } from "@/lib/admin/core";

const NOW = 1_800_000_000_000;
const base = { userId: "u1", userSessionId: "s1", createdAt: new Date(NOW - 60_000), lastSeenAt: new Date(NOW - 1_000), expiresAt: new Date(NOW - 60_000 + ADMIN_MAX_MS), revokedAt: null };
const me = { userId: "u1", userSessionId: "s1" };

describe("admin session rules", () => {
  it("accepts a fresh session bound to this sign-in", () => {
    expect(checkAdminSession(base, me, NOW)).toBe("ok");
  });

  it("ends after 15 minutes idle", () => {
    expect(checkAdminSession({ ...base, lastSeenAt: new Date(NOW - ADMIN_IDLE_MS) }, me, NOW)).toBe("idle");
    expect(checkAdminSession({ ...base, lastSeenAt: new Date(NOW - ADMIN_IDLE_MS + 1) }, me, NOW)).toBe("ok");
  });

  it("ends after 2 hours however active", () => {
    expect(checkAdminSession({ ...base, createdAt: new Date(NOW - ADMIN_MAX_MS), lastSeenAt: new Date(NOW) }, me, NOW)).toBe("expired");
    expect(checkAdminSession({ ...base, expiresAt: new Date(NOW) }, me, NOW)).toBe("expired");
  });

  it("dies with its user session and can't be used by another person or sign-in", () => {
    expect(checkAdminSession(base, { userId: "u1", userSessionId: "s2" }, NOW)).toBe("other_session");
    expect(checkAdminSession(base, { userId: "u2", userSessionId: "s1" }, NOW)).toBe("other_session");
  });

  it("stays dead once revoked", () => {
    expect(checkAdminSession({ ...base, revokedAt: new Date(NOW - 1) }, me, NOW)).toBe("revoked");
  });
});

describe("confirmation binding", () => {
  it("hashes the same input the same way whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: null }] })).toBe('{"a":[2,{"c":null,"d":3}],"b":1}');
    expect(inputHash("user.delete", { id: "x", reason: "r" })).toBe(inputHash("user.delete", { reason: "r", id: "x" }));
  });

  it("changes when the action or any input changes", () => {
    const h = inputHash("user.delete", { id: "x" });
    expect(inputHash("user.suspend", { id: "x" })).not.toBe(h);
    expect(inputHash("user.delete", { id: "y" })).not.toBe(h);
    expect(inputHash("user.delete", { id: "x", extra: true })).not.toBe(h);
  });

  it("ignores undefined fields, like JSON does", () => {
    expect(inputHash("a", { id: "x", note: undefined })).toBe(inputHash("a", { id: "x" }));
  });
});

describe("audit redaction", () => {
  it("removes secret and personal fields at any depth", () => {
    const out = redactForAudit({
      key: "chat.enabled",
      value: true,
      apiKey: "sk-123",
      nested: { totpSecretEnc: "v1.x", token: "t", email: "a@b.c", list: [{ password: "p", ok: 1 }] },
    });
    expect(out).toEqual({ key: "chat.enabled", value: true, apiKey: "[redacted]", nested: { totpSecretEnc: "[redacted]", token: "[redacted]", email: "[redacted]", list: [{ password: "[redacted]", ok: 1 }] } });
  });

  it("caps long strings and deep nesting", () => {
    expect((redactForAudit("x".repeat(3000)) as string).length).toBe(2001);
    let deep: unknown = 1;
    for (let i = 0; i < 10; i++) deep = { d: deep };
    expect(JSON.stringify(redactForAudit(deep))).toContain("[truncated]");
  });
});

describe("privacy helpers", () => {
  it("keeps only a network prefix", () => {
    expect(ipPrefix("203.0.113.77")).toBe("203.0.113.0");
    expect(ipPrefix("2001:db8:1:2:3::9")).toBe("2001:db8:1::");
    expect(ipPrefix(null)).toBeNull();
  });

  it("hashes emails case-insensitively", () => {
    expect(emailHash(" Me@Example.com")).toBe(emailHash("me@example.com"));
  });
});
