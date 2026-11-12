import { describe, expect, it } from "vitest";
import { cleanGroupName, deliverySummary, localGroupId, MAX_MEMBERS, maySend, parseGroupMsg, parseInvite, parseLeave } from "../../src/features/connect/groups-logic";

const A = "a".repeat(64);
const B = "b".repeat(64);
const GID = "4f1c2d3e-aaaa-4bbb-8ccc-0123456789ab";

describe("parseInvite", () => {
  it("reads an invite with a member list", () => {
    const m = parseInvite({ groupId: GID, action: "invite", name: "  Study\ngroup ", members: [{ key: A, name: "Asha" }, { key: A, name: "dup" }] });
    expect(m).toEqual({ action: "invite", groupId: GID, name: "Study group", members: [{ key: A, name: "Asha" }] });
  });

  it("rejects bad keys, oversized lists, missing names and unknown actions", () => {
    expect(parseInvite({ groupId: GID, action: "invite", name: "x", members: [{ key: "zz", name: "n" }] })).toBeNull();
    const many = Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => ({ key: i.toString(16).padStart(64, "0"), name: "n" }));
    expect(parseInvite({ groupId: GID, action: "roster", name: "x", members: many })).toBeNull();
    expect(parseInvite({ groupId: GID, action: "invite", name: "   ", members: [] })).toBeNull();
    expect(parseInvite({ groupId: GID, action: "kick", owner: A })).toBeNull();
    expect(parseInvite({ groupId: "short", action: "accept", owner: A })).toBeNull();
  });

  it("reads accept and decline answers", () => {
    expect(parseInvite({ groupId: GID, action: "accept", owner: A })).toEqual({ action: "accept", groupId: GID, owner: A });
    expect(parseInvite({ groupId: GID, action: "decline", owner: B })?.action).toBe("decline");
    expect(parseInvite({ groupId: GID, action: "accept" })).toBeNull();
  });
});

describe("group messages", () => {
  it("validates and trims text", () => {
    expect(parseGroupMsg({ groupId: GID, owner: A, id: "12345678-aaaa", text: "  hi  ", ts: 5 })).toEqual({ groupId: GID, owner: A, id: "12345678-aaaa", text: "hi", ts: 5 });
    expect(parseGroupMsg({ groupId: GID, owner: A, id: "12345678-aaaa", text: "   " })).toBeNull();
    expect(parseGroupMsg({ groupId: GID, owner: "nope", id: "12345678-aaaa", text: "x" })).toBeNull();
    expect(parseGroupMsg({ groupId: GID, owner: A, id: "x", text: "x" })).toBeNull();
    expect(parseGroupMsg({ groupId: GID, owner: A, id: "12345678-aaaa", text: "y".repeat(5000) })?.text.length).toBe(4000);
  });

  it("reads leave messages", () => {
    expect(parseLeave({ groupId: GID, owner: A })).toEqual({ groupId: GID, owner: A });
    expect(parseLeave({ groupId: GID })).toBeNull();
  });

  it("only lets members post", () => {
    expect(maySend(A, [A, B])).toBe(true);
    expect(maySend("c".repeat(64), [A, B])).toBe(false);
  });
});

describe("helpers", () => {
  it("scopes group ids by owner so two owners never collide", () => {
    expect(localGroupId(A, GID)).not.toBe(localGroupId(B, GID));
  });

  it("cleans names", () => {
    expect(cleanGroupName("x".repeat(60))?.length).toBe(40);
    expect(cleanGroupName(5)).toBeNull();
  });

  it("summarises delivery truthfully", () => {
    expect(deliverySummary(0, [])).toBe("Nobody else in this group yet");
    expect(deliverySummary(1, [])).toBe("Sent");
    expect(deliverySummary(3, [])).toBe("Sent to all 3");
    expect(deliverySummary(3, ["Asha"])).toBe("Not delivered to Asha");
    expect(deliverySummary(4, ["Asha", "Bilal", "Chen"])).toBe("Not delivered to Asha, Bilal and 1 more");
    expect(deliverySummary(2, ["Asha", "Bilal"])).toBe("Not delivered: nobody is connected");
  });
});
