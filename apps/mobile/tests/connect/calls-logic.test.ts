import { describe, expect, it } from "vitest";
import { toBase64 } from "../../src/features/connect/bytes";
import {
  callTitle,
  formatDuration,
  historyStatus,
  incomingCall,
  liveParticipants,
  MAX_CALL_PEOPLE,
  newCallId,
  outgoingCall,
  parseCallKey,
  parseInvite,
  reduceCall,
  type Call,
  type CallEvent,
} from "../../src/features/connect/calls-logic";

const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const ME = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const ID = "0123456789abcdef0123456789abcdef";

function run(call: Call, ...events: CallEvent[]): Call {
  let t = 1000;
  return events.reduce((c, e) => reduceCall(c, e, (t += 1000)), call);
}

describe("messages", () => {
  it("makes 32-hex call ids", () => {
    expect(newCallId(rand)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("parses a valid invite", () => {
    const key = toBase64(rand(32));
    const inv = parseInvite(B, ME, { t: "call.invite", callId: ID, key, members: [{ key: B, name: "Bilal" }, { key: ME, name: "Asha" }] });
    expect(inv).toEqual({ callId: ID, key, members: [{ key: B, name: "Bilal" }, { key: ME, name: "Asha" }] });
  });

  it("refuses invites that leave out the caller or me, or are too big, or carry a bad key", () => {
    const key = toBase64(rand(32));
    expect(parseInvite(B, ME, { callId: ID, key, members: [{ key: C, name: "x" }, { key: ME, name: "y" }] })).toBeNull();
    expect(parseInvite(B, ME, { callId: ID, key, members: [{ key: B, name: "x" }, { key: C, name: "y" }] })).toBeNull();
    const five = [B, ME, C, D, E].map((k) => ({ key: k, name: "p" }));
    expect(five.length).toBeGreaterThan(MAX_CALL_PEOPLE);
    expect(parseInvite(B, ME, { callId: ID, key, members: five })).toBeNull();
    expect(parseInvite(B, ME, { callId: ID, key: "short", members: [{ key: B, name: "x" }, { key: ME, name: "y" }] })).toBeNull();
    expect(parseInvite(B, ME, { callId: "xyz", key, members: [{ key: B, name: "x" }, { key: ME, name: "y" }] })).toBeNull();
  });

  it("parses call.key", () => {
    const key = toBase64(rand(32));
    expect(parseCallKey({ callId: ID, key })).toEqual({ callId: ID, key });
    expect(parseCallKey({ callId: ID, key: toBase64(rand(31)) })).toBeNull();
  });
});

describe("outgoing calls", () => {
  const start = () => outgoingCall(ID, ME, [{ key: B, name: "Bilal" }], 0);

  it("rings, connects when the other side answers, and is active once voice has a key", () => {
    let c = start();
    expect(c.phase).toBe("ringing");
    c = run(c, { type: "accepted", peer: B });
    expect(c.phase).toBe("connecting");
    expect(c.connectedAt).toBeNull();
    c = run(c, { type: "key", peer: B });
    expect(c.phase).toBe("active");
    expect(c.connectedAt).not.toBeNull();
    c = run(c, { type: "hangup" });
    expect(c.phase).toBe("ended");
    expect(c.endReason).toBe("hangup");
    expect(historyStatus(c)).toBe("completed");
  });

  it("ends as declined, busy, or no answer", () => {
    expect(run(start(), { type: "declined", peer: B }).endReason).toBe("declined");
    const busy = run(start(), { type: "declined", peer: B, busy: true });
    expect(busy.endReason).toBe("busy");
    expect(historyStatus(busy)).toBe("busy");
    const quiet = run(start(), { type: "ring_timeout" });
    expect(quiet.endReason).toBe("no_answer");
    expect(historyStatus(quiet)).toBe("no_answer");
  });

  it("ends when the connection is lost mid-call", () => {
    const c = run(start(), { type: "accepted", peer: B }, { type: "key", peer: B }, { type: "lost", peer: B });
    expect(c.phase).toBe("ended");
    expect(c.endReason).toBe("lost");
    expect(historyStatus(c)).toBe("completed");
  });

  it("ends when the other person hangs up", () => {
    const c = run(start(), { type: "accepted", peer: B }, { type: "key", peer: B }, { type: "left", peer: B });
    expect(c.endReason).toBe("remote_ended");
  });

  it("keeps a group call going while anyone is left", () => {
    let c = outgoingCall(ID, ME, [{ key: B, name: "Bilal" }, { key: C, name: "Chen" }], 0);
    c = run(c, { type: "accepted", peer: B }, { type: "key", peer: B }, { type: "declined", peer: C });
    expect(c.phase).toBe("active");
    c = run(c, { type: "left", peer: B });
    expect(c.phase).toBe("ended");
  });

  it("ring timeout only drops the people still ringing", () => {
    let c = outgoingCall(ID, ME, [{ key: B, name: "Bilal" }, { key: C, name: "Chen" }], 0);
    c = run(c, { type: "accepted", peer: B }, { type: "key", peer: B }, { type: "ring_timeout" });
    expect(c.phase).toBe("active");
    expect(c.participants.find((p) => p.key === C)?.state).toBe("no_answer");
    expect(liveParticipants(c).map((p) => p.key)).toEqual([B]);
  });

  it("ignores events after the end", () => {
    const ended = run(start(), { type: "hangup" });
    expect(run(ended, { type: "accepted", peer: B })).toBe(ended);
  });
});

describe("incoming calls", () => {
  const invite = { callId: ID, key: toBase64(rand(32)), members: [{ key: B, name: "Bilal" }, { key: ME, name: "Asha" }, { key: C, name: "Chen" }] };

  it("starts ringing with the caller already in the call", () => {
    const c = incomingCall(invite, B, ME, 0);
    expect(c.phase).toBe("incoming");
    expect(c.participants.map((p) => [p.key, p.state])).toEqual([
      [B, "joined"],
      [C, "invited"],
    ]);
  });

  it("is missed if the caller hangs up or nobody answers", () => {
    const left = run(incomingCall(invite, B, ME, 0), { type: "left", peer: B });
    expect(left.endReason).toBe("missed");
    expect(historyStatus(left)).toBe("missed");
    expect(run(incomingCall(invite, B, ME, 0), { type: "ring_timeout" }).endReason).toBe("missed");
    expect(run(incomingCall(invite, B, ME, 0), { type: "lost", peer: B }).endReason).toBe("missed");
  });

  it("files a declined call as declined", () => {
    const c = run(incomingCall(invite, B, ME, 0), { type: "decline" });
    expect(historyStatus(c)).toBe("declined");
  });

  it("answers, then becomes active when the caller's key is in use", () => {
    let c = run(incomingCall(invite, B, ME, 0), { type: "answer" });
    expect(c.phase).toBe("connecting");
    c = run(c, { type: "key", peer: B });
    expect(c.phase).toBe("active");
    // Another invitee declining does not end it.
    c = run(c, { type: "declined", peer: C });
    expect(c.phase).toBe("active");
  });
});

describe("display", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_900)).toBe("0:42");
    expect(formatDuration(725_000)).toBe("12:05");
    expect(formatDuration(3_729_000)).toBe("1:02:09");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("titles calls", () => {
    expect(callTitle([])).toBe("Call");
    expect(callTitle([{ key: B, name: "Bilal" }])).toBe("Bilal");
    expect(callTitle([{ key: B, name: "Bilal" }, { key: C, name: "Chen" }])).toBe("Bilal and Chen");
    expect(callTitle([{ key: B, name: "Bilal" }, { key: C, name: "Chen" }, { key: D, name: "Dee" }])).toBe("Bilal and 2 others");
  });
});
