import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { likePattern } = await import("@/lib/agent/chat");

describe("conversation search pattern", () => {
  it("wraps the query for a contains match", () => {
    expect(likePattern("invoice")).toBe("%invoice%");
  });
  it("matches %, _ and backslash literally", () => {
    expect(likePattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
  });
});
