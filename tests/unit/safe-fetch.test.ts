import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isPrivateAddress } = await import("@/lib/security/safe-fetch");
const { mapOutsideCode, stripInvalidCitations } = await import("@/lib/knowledge/rank");

describe("SSRF guard", () => {
  it("rejects private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("citations never touch code", () => {
  it("keeps array indexes inside code blocks and inline code", () => {
    const text = "Use `arr[1]` here [7].\n```js\nconst x = list[2];\n```\nSee [1].";
    expect(stripInvalidCitations(text, 1)).toBe("Use `arr[1]` here .\n```js\nconst x = list[2];\n```\nSee [1].");
  });
  it("applies only to prose", () => {
    expect(mapOutsideCode("a `b` c", (p) => p.toUpperCase())).toBe("A `b` C");
  });
});
