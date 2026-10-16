import { describe, expect, it } from "vitest";
import { generateOtpCode, hashEmail, hashOtp, isEmailAllowed, normalizeEmail, verifyOtpHash } from "@/lib/auth/otp-core";
import { isAllowedRedirectUri, metadata, pkceChallengeS256, resolveRequestedScopes, tokenRequestSchema, verifyPkce } from "@/lib/mcp/oauth-core";

const SECRET = "test-secret-test-secret-test-secret-1234";

describe("email OTP", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
  it("binds codes to the email and verifies only the right code", () => {
    const h = hashOtp("Me@Example.com", "123456", SECRET);
    expect(verifyOtpHash("me@example.com ", "123456", h, SECRET)).toBe(true);
    expect(verifyOtpHash("me@example.com", "123457", h, SECRET)).toBe(false);
    expect(verifyOtpHash("other@example.com", "123456", h, SECRET)).toBe(false);
    expect(verifyOtpHash("me@example.com", "12345", h, SECRET)).toBe(false);
  });
  it("never stores the plain email or code", () => {
    expect(hashEmail("me@example.com", SECRET)).not.toContain("example");
    expect(hashOtp("me@example.com", "123456", SECRET)).not.toContain("123456");
  });
  it("enforces the allowlist case-insensitively", () => {
    expect(normalizeEmail(" Me@Example.COM ")).toBe("me@example.com");
    expect(isEmailAllowed("ME@example.com", ["me@example.com"])).toBe(true);
    expect(isEmailAllowed("intruder@example.com", ["me@example.com"])).toBe(false);
    expect(isEmailAllowed("me@example.com", [])).toBe(false);
  });
});

describe("OAuth 2.1 for Claude", () => {
  it("verifies PKCE S256", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallengeS256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce("short", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });
  it("only allows Claude (and loopback) redirect URIs by default", () => {
    const hosts = ["claude.ai", "claude.com", "localhost", "127.0.0.1"];
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback", hosts)).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/callback", hosts)).toBe(true);
    expect(isAllowedRedirectUri("https://evil.com/callback", hosts)).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai.evil.com/cb", hosts)).toBe(false);
    expect(isAllowedRedirectUri("http://claude.ai/cb", hosts)).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag", hosts)).toBe(false);
  });
  it("advertises PKCE-only public clients", () => {
    const m = metadata("https://pa.example.com");
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(m.authorization_endpoint).toBe("https://pa.example.com/oauth/authorize");
  });
  it("defaults to PA scopes and rejects unknown grants", () => {
    expect(resolveRequestedScopes("tasks:read bogus")).toEqual(["tasks:read"]);
    expect(resolveRequestedScopes(undefined).length).toBeGreaterThan(3);
    expect(tokenRequestSchema.safeParse({ grant_type: "password", username: "x" }).success).toBe(false);
  });
});
