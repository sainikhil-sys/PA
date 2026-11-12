import { describe, expect, it } from "vitest";
import { cleanBody, deliveryState, directKey, handleProblem, isFresh, normalizeHandle, pair, previewText, suggestHandle } from "@/lib/social/rules";

describe("handles", () => {
  it("normalizes a typed handle", () => {
    expect(normalizeHandle("  @Asha.Rao ")).toBe("asha.rao");
  });

  it("accepts valid handles and explains invalid ones", () => {
    expect(handleProblem("asha.rao")).toBeNull();
    expect(handleProblem("a_1")).toBeNull();
    expect(handleProblem("ab")).toMatch(/at least/);
    expect(handleProblem("a".repeat(25))).toMatch(/at most/);
    expect(handleProblem("asha rao")).toMatch(/letters, numbers/);
    expect(handleProblem(".asha")).toMatch(/Start and end/);
    expect(handleProblem("asha_")).toMatch(/Start and end/);
    expect(handleProblem("as..ha")).toMatch(/next to each other/);
    expect(handleProblem("admin")).toMatch(/reserved/);
    expect(handleProblem("cowork.team")).toMatch(/reserved/);
  });

  it("suggests a valid handle from a name or email", () => {
    expect(suggestHandle("Asha Rao")).toBe("asha.rao");
    expect(suggestHandle("José.Núñez@example.com")).toBe("jose.nunez");
    for (const s of ["A", "!!", "admin", "x@y.z"]) expect(handleProblem(suggestHandle(s))).toBeNull();
  });
});

describe("pairs", () => {
  it("orders a pair the same way from either side", () => {
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    expect(pair(a, b)).toEqual(pair(b, a));
    expect(directKey(a, b)).toBe(directKey(b, a));
    expect(pair(b, a).low).toBe(a);
  });
});

describe("delivery state", () => {
  const sharing = (deliveredSeq: number, readSeq: number) => ({ deliveredSeq, readSeq, readReceipts: true });

  it("is sent until every other member received it", () => {
    expect(deliveryState(10, [sharing(9, 0)], true)).toBe("sent");
    expect(deliveryState(10, [sharing(10, 0), sharing(5, 0)], true)).toBe("sent");
    expect(deliveryState(10, [sharing(10, 0), sharing(12, 0)], true)).toBe("delivered");
  });

  it("is read only when everyone read it", () => {
    expect(deliveryState(10, [sharing(10, 10)], true)).toBe("read");
    expect(deliveryState(10, [sharing(10, 10), sharing(10, 3)], true)).toBe("delivered");
  });

  it("hides read marks when either side turned read receipts off", () => {
    expect(deliveryState(10, [{ deliveredSeq: 10, readSeq: 10, readReceipts: false }], true)).toBe("delivered");
    expect(deliveryState(10, [sharing(10, 10)], false)).toBe("delivered");
  });

  it("stays sent when nobody else is in the chat", () => {
    expect(deliveryState(1, [], true)).toBe("sent");
  });
});

describe("previews and bodies", () => {
  it("writes plain previews", () => {
    expect(previewText({ body: "hello\n there", kind: "text", deletedAt: null }, true, null)).toBe("You: hello there");
    expect(previewText({ body: "hi", kind: "text", deletedAt: null }, false, "Asha")).toBe("Asha: hi");
    expect(previewText({ body: "x", kind: "text", deletedAt: new Date() }, false, null)).toBe("Message deleted");
    expect(previewText({ body: "Asha created the group.", kind: "system", deletedAt: null }, false, "Asha")).toBe("Asha created the group.");
    expect(previewText({ body: "a".repeat(200), kind: "text", deletedAt: null }, false, null)).toHaveLength(120);
  });

  it("cleans message text", () => {
    expect(cleanBody("  hi\u0000 ")).toBe("hi");
    expect(cleanBody("   \n ")).toBeNull();
    expect(cleanBody("a\n\n\n\n\n\nb")).toBe("a\n\n\nb");
  });

  it("treats marks as fresh only inside the window", () => {
    const now = Date.now();
    expect(isFresh(new Date(now - 1000), 6000, now)).toBe(true);
    expect(isFresh(new Date(now - 7000), 6000, now)).toBe(false);
    expect(isFresh(null, 6000, now)).toBe(false);
  });
});
