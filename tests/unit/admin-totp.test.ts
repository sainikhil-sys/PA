import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  matchRecoveryCode,
  otpauthUri,
  stepAt,
  verifyTotp,
} from "@/lib/admin/totp";

// RFC 6238 appendix B: ASCII seeds, 8 digits.
const SEED_SHA1 = Buffer.from("12345678901234567890");
const SEED_SHA256 = Buffer.from("12345678901234567890123456789012");
const SEED_SHA512 = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234");
const VECTORS: [number, string, string, string][] = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [t, sha1, sha256, sha512] of VECTORS) {
      const step = stepAt(t * 1000);
      expect(hotp(SEED_SHA1, step, 8, "sha1")).toBe(sha1);
      expect(hotp(SEED_SHA256, step, 8, "sha256")).toBe(sha256);
      expect(hotp(SEED_SHA512, step, 8, "sha512")).toBe(sha512);
    }
  });

  it("round-trips base32 (RFC 4648)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it("accepts the current step and one either side, and nothing further", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const code = (s: number) => hotp(base32Decode(secret), s);
    expect(verifyTotp(secret, code(step), now)).toBe(step);
    expect(verifyTotp(secret, code(step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, code(step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, code(step - 2), now)).toBeNull();
    expect(verifyTotp(secret, code(step + 2), now)).toBeNull();
  });

  it("refuses a replayed or older step", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const current = hotp(base32Decode(secret), step);
    expect(verifyTotp(secret, current, now, { lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, hotp(base32Decode(secret), step - 1), now, { lastUsedStep: step - 1 })).toBeNull();
    expect(verifyTotp(secret, current, now, { lastUsedStep: step - 1 })).toBe(step);
  });

  it("refuses malformed codes", () => {
    const secret = generateTotpSecret();
    for (const bad of ["", "12345", "1234567", "12345a", " 123456"]) expect(verifyTotp(secret, bad, Date.now())).toBeNull();
  });

  it("builds an otpauth URI authenticator apps read", () => {
    expect(otpauthUri("ABC", "me@example.com", "Cowork")).toBe("otpauth://totp/Cowork%3Ame%40example.com?secret=ABC&issuer=Cowork&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes", () => {
  it("makes ten distinct codes in the expected shape", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  });

  it("matches regardless of case and separators, and only once per stored hash", () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map(hashRecoveryCode);
    const typed = codes[1]!.toLowerCase().replace("-", " ");
    expect(matchRecoveryCode(typed, hashes)).toBe(hashes[1]);
    expect(matchRecoveryCode(typed, [hashes[0]!, hashes[2]!])).toBeNull();
    expect(matchRecoveryCode("AAAAA-AAAAA", hashes)).toBeNull();
    expect(matchRecoveryCode("short", hashes)).toBeNull();
  });
});
