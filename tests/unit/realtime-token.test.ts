import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mintRealtimeToken, REALTIME_TOKEN_TTL_S, userTopic } = await import("@/lib/realtime/token");

const SECRET = "x".repeat(40);

describe("realtime channel token", () => {
  it("is a valid HS256 JWT for the person, role authenticated, short-lived", () => {
    const now = 1_800_000_000;
    const { token, expiresAt } = mintRealtimeToken("6f1c2d3e-0000-4000-8000-000000000001", SECRET, now);
    const [h, p, s] = token.split(".");
    expect(createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")).toBe(s);
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(claims).toMatchObject({ sub: "6f1c2d3e-0000-4000-8000-000000000001", role: "authenticated", aud: "authenticated", iat: now, exp: now + REALTIME_TOKEN_TTL_S });
    expect(expiresAt).toBe((now + REALTIME_TOKEN_TTL_S) * 1000);
  });

  it("does not verify with another secret", () => {
    const { token } = mintRealtimeToken("u1", SECRET);
    const [h, p, s] = token.split(".");
    expect(createHmac("sha256", "y".repeat(40)).update(`${h}.${p}`).digest("base64url")).not.toBe(s);
  });

  it("uses one private topic per person", () => {
    expect(userTopic("abc")).toBe("user:abc");
  });
});
