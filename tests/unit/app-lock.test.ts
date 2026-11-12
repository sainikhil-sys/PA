import { pbkdf2Sync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  encodeRecord,
  FREE_ATTEMPTS,
  hashPin,
  isPinLength,
  isPolicy,
  isValidPin,
  lockoutDelayMs,
  NO_ATTEMPTS,
  parseAttempts,
  parseRecord,
  PBKDF2_ITERATIONS,
  POLICIES,
  registerFailure,
  remainingLockoutMs,
  shouldLockOnReturn,
  verifyPin,
  waitText,
  type Attempts,
} from "../../apps/mobile/src/features/lock/logic";

/** App lock rules (apps/mobile/src/features/lock/logic.ts): PIN hashing, attempt limits, lock timing. */

describe("PIN hashing", () => {
  it("matches PBKDF2-HMAC-SHA256 from Node's crypto", async () => {
    const salt = randomBytes(16);
    const record = await hashPin("482913", new Uint8Array(salt), 1000);
    const expected = pbkdf2Sync("482913", salt, 1000, 32, "sha256");
    expect(Buffer.from(record.hash).equals(expected)).toBe(true);
  });

  it("matches the RFC 7914 PBKDF2-HMAC-SHA256 test vector", async () => {
    const record = await hashPin("passwd", new TextEncoder().encode("salt"), 1);
    // RFC 7914 section 11 gives 64 bytes; the first 32 are the 32-byte key.
    expect(Buffer.from(record.hash).toString("hex")).toBe("55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc");
  });

  it("verifies the right PIN and rejects others", async () => {
    const record = await hashPin("1234", new Uint8Array(randomBytes(16)), 500);
    expect(await verifyPin("1234", record)).toBe(true);
    expect(await verifyPin("1235", record)).toBe(false);
    expect(await verifyPin("123", record)).toBe(false);
    expect(await verifyPin("123400", record)).toBe(false);
  });

  it("gives different hashes for the same PIN with different salts", async () => {
    const a = await hashPin("1234", new Uint8Array(randomBytes(16)), 100);
    const b = await hashPin("1234", new Uint8Array(randomBytes(16)), 100);
    expect(constantTimeEqual(a.hash, b.hash)).toBe(false);
  });

  it("round-trips a stored record and never stores the PIN", async () => {
    const record = await hashPin("908172", new Uint8Array(randomBytes(16)), 200);
    const stored = encodeRecord(record);
    expect(stored).toMatch(/^pbkdf2-sha256\$200\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(stored).not.toContain("908172");
    const parsed = parseRecord(stored);
    expect(parsed).not.toBeNull();
    expect(await verifyPin("908172", parsed!)).toBe(true);
  });

  it("rejects malformed records", () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord("1234")).toBeNull();
    expect(parseRecord("sha1$1$aa$bb")).toBeNull();
    expect(parseRecord(`pbkdf2-sha256$0$${"a".repeat(32)}$${"b".repeat(64)}`)).toBeNull();
    expect(parseRecord(`pbkdf2-sha256$100$${"a".repeat(32)}$${"b".repeat(10)}`)).toBeNull();
    expect(parseRecord(`pbkdf2-sha256$100$zz$${"b".repeat(64)}`)).toBeNull();
  });

  it("uses a slow default iteration count", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(50_000);
  });
});

describe("constantTimeEqual", () => {
  it("compares bytes and lengths", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe("PIN format", () => {
  it("accepts only digits of the chosen length", () => {
    expect(isValidPin("1234", 4)).toBe(true);
    expect(isValidPin("123456", 6)).toBe(true);
    expect(isValidPin("1234", 6)).toBe(false);
    expect(isValidPin("12a4", 4)).toBe(false);
    expect(isValidPin("12 4", 4)).toBe(false);
    expect(isValidPin("١٢٣٤", 4)).toBe(false);
    expect(isPinLength(4)).toBe(true);
    expect(isPinLength(5)).toBe(false);
  });
});

describe("attempt limit", () => {
  it("allows five wrong PINs, then waits longer each time", () => {
    expect(FREE_ATTEMPTS).toBe(5);
    expect([0, 1, 2, 3, 4].map(lockoutDelayMs)).toEqual([0, 0, 0, 0, 0]);
    expect(lockoutDelayMs(5)).toBe(30_000);
    expect(lockoutDelayMs(6)).toBe(60_000);
    expect(lockoutDelayMs(7)).toBe(300_000);
    expect(lockoutDelayMs(8)).toBeGreaterThan(lockoutDelayMs(7));
    expect(lockoutDelayMs(50)).toBe(3_600_000);
  });

  it("starts the wait on the fifth wrong PIN", () => {
    const now = 1_000_000;
    let a: Attempts = NO_ATTEMPTS;
    for (let i = 0; i < 4; i++) a = registerFailure(a, now);
    expect(a).toEqual({ failures: 4, lockedUntil: 0 });
    expect(remainingLockoutMs(a, now)).toBe(0);
    a = registerFailure(a, now);
    expect(a.failures).toBe(5);
    expect(remainingLockoutMs(a, now)).toBe(30_000);
    expect(remainingLockoutMs(a, now + 29_000)).toBe(1_000);
    expect(remainingLockoutMs(a, now + 30_000)).toBe(0);
    a = registerFailure(a, now + 30_000);
    expect(remainingLockoutMs(a, now + 30_000)).toBe(60_000);
  });

  it("caps the wait when the clock moves backwards", () => {
    const a: Attempts = { failures: 5, lockedUntil: 10_000_000 };
    expect(remainingLockoutMs(a, 0)).toBe(30_000);
  });

  it("survives a restart through its stored form", () => {
    const a = registerFailure({ failures: 4, lockedUntil: 0 }, 5000);
    expect(parseAttempts(JSON.stringify(a))).toEqual(a);
    expect(parseAttempts(null)).toEqual(NO_ATTEMPTS);
    expect(parseAttempts("not json")).toEqual(NO_ATTEMPTS);
    expect(parseAttempts(JSON.stringify({ failures: -2, lockedUntil: "x" }))).toEqual(NO_ATTEMPTS);
  });

  it("describes the wait in plain words", () => {
    expect(waitText(30_000)).toBe("30 seconds");
    expect(waitText(1_000)).toBe("1 second");
    expect(waitText(400)).toBe("1 second");
    expect(waitText(60_000)).toBe("1 minute");
    expect(waitText(61_000)).toBe("2 minutes");
    expect(waitText(300_000)).toBe("5 minutes");
  });
});

describe("lock on return", () => {
  const t0 = 1_700_000_000_000;

  it("locks immediately after any time in the background", () => {
    expect(shouldLockOnReturn("immediate", t0, t0)).toBe(true);
    expect(shouldLockOnReturn("immediate", t0, t0 + 100)).toBe(true);
  });

  it("waits for the chosen time", () => {
    expect(shouldLockOnReturn("30s", t0, t0 + 29_999)).toBe(false);
    expect(shouldLockOnReturn("30s", t0, t0 + 30_000)).toBe(true);
    expect(shouldLockOnReturn("1m", t0, t0 + 59_000)).toBe(false);
    expect(shouldLockOnReturn("1m", t0, t0 + 60_000)).toBe(true);
    expect(shouldLockOnReturn("5m", t0, t0 + 299_000)).toBe(false);
    expect(shouldLockOnReturn("5m", t0, t0 + 300_000)).toBe(true);
  });

  it("never locks on return for the launch-only policy", () => {
    expect(shouldLockOnReturn("launch", t0, t0 + 86_400_000)).toBe(false);
  });

  it("does not lock when Cowork never reached the background", () => {
    expect(shouldLockOnReturn("immediate", null, t0)).toBe(false);
  });

  it("locks when the clock moved backwards while away", () => {
    expect(shouldLockOnReturn("5m", t0, t0 - 1000)).toBe(true);
  });

  it("lists every policy once with copy free of em dashes", () => {
    const values = POLICIES.map((p) => p.value);
    expect(new Set(values).size).toBe(values.length);
    for (const p of POLICIES) {
      expect(isPolicy(p.value)).toBe(true);
      expect(`${p.label} ${p.detail}`).not.toMatch(/—/);
    }
    expect(isPolicy("10m")).toBe(false);
  });
});
