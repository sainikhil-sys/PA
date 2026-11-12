import { describe, expect, it } from "vitest";
import { toBase64 } from "../../src/features/connect/bytes";
import {
  channelMessage,
  cleanChannelName,
  codesMatch,
  decideJoin,
  formatCode,
  MAX_CODE_ATTEMPTS,
  MAX_MEMBERS,
  newChannelId,
  newJoinCode,
  normalizeCode,
  parseChannelMessage,
  parseJoinMessage,
  parseKeyMessage,
  parsePing,
  PingTracker,
  PING_LOST_MS,
  qualityFor,
  removeMember,
  rosterDiff,
  type Channel,
  type HostState,
} from "../../src/features/connect/walkie-logic";

const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const key = (c: string) => c.repeat(64);
const HOST = key("a");
const B = key("b");
const C = key("c");

function channel(open: boolean, members = [{ key: HOST, name: "Asha" }]): Channel {
  return { id: "0123456789abcdef", name: "Trail", open, host: HOST, members, count: members.length };
}

describe("codes and ids", () => {
  it("makes six-digit codes and 16-hex ids", () => {
    for (let i = 0; i < 200; i++) expect(newJoinCode(rand)).toMatch(/^\d{6}$/);
    expect(newChannelId(rand)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects biased draws instead of using modulo", () => {
    let calls = 0;
    // First draw is above the limit (0xffffffff), second is 1234567 -> 234567.
    const code = newJoinCode(() => (++calls === 1 ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array([0x00, 0x12, 0xd6, 0x87])));
    expect(calls).toBe(2);
    expect(code).toBe("234567");
  });

  it("normalizes typed codes and compares them", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("abcdef")).toBeNull();
    expect(normalizeCode(123456)).toBeNull();
    expect(codesMatch("123456", "123456")).toBe(true);
    expect(codesMatch("123456", "123457")).toBe(false);
    expect(codesMatch("123456", "12345")).toBe(false);
    expect(formatCode("123456")).toBe("123 456");
  });

  it("cleans channel names", () => {
    expect(cleanChannelName("  Trail\n crew ")).toBe("Trail crew");
    expect(cleanChannelName("   ")).toBeNull();
    expect(cleanChannelName("x".repeat(80))).toHaveLength(32);
    expect(cleanChannelName(5)).toBeNull();
  });
});

describe("walkie.channel", () => {
  it("round-trips an announcement from its host", () => {
    const c = channel(true, [
      { key: HOST, name: "Asha" },
      { key: B, name: "Bilal" },
    ]);
    const parsed = parseChannelMessage(HOST, channelMessage(c, true));
    expect(parsed).toEqual({ kind: "announce", channel: c });
  });

  it("shares the member list only with members", () => {
    const c = channel(false, [
      { key: HOST, name: "Asha" },
      { key: B, name: "Bilal" },
    ]);
    const parsed = parseChannelMessage(HOST, channelMessage(c, false));
    expect(parsed?.kind === "announce" && parsed.channel.members).toEqual([{ key: HOST, name: "Asha" }]);
    expect(parsed?.kind === "announce" && parsed.channel.count).toBe(2);
  });

  it("refuses an announcement for someone else's channel", () => {
    expect(parseChannelMessage(B, channelMessage(channel(true), true))).toBeNull();
  });

  it("refuses malformed members and oversized rosters", () => {
    expect(parseChannelMessage(HOST, { ...channelMessage(channel(true), true), members: [{ key: "zz", name: "x" }] })).toBeNull();
    const many = Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => ({ key: i.toString(16).padStart(64, "0"), name: "p" }));
    expect(parseChannelMessage(HOST, { ...channelMessage(channel(true), true), members: [{ key: HOST, name: "A" }, ...many] })).toBeNull();
    expect(parseChannelMessage(HOST, { t: "walkie.channel", id: "nothex", name: "x", open: true, members: [] })).toBeNull();
  });

  it("parses a close", () => {
    expect(parseChannelMessage(HOST, { t: "walkie.channel", id: "0123456789abcdef", closed: true })).toEqual({ kind: "closed", id: "0123456789abcdef" });
  });
});

describe("joining", () => {
  const host = (open: boolean, code: string | null = "482913"): HostState => ({ channel: channel(open), code, attempts: new Map() });

  it("lets anyone into an open channel", () => {
    const h = host(true, null);
    const d = decideJoin(h, { key: B, name: "Bilal" }, null);
    expect(d.ok && d.channel.members.map((m) => m.key)).toEqual([HOST, B]);
  });

  it("needs the right code for a private channel", () => {
    const h = host(false);
    expect(decideJoin(h, { key: B, name: "Bilal" }, null)).toEqual({ ok: false, reason: "code" });
    expect(decideJoin(h, { key: B, name: "Bilal" }, "000000")).toEqual({ ok: false, reason: "code" });
    const d = decideJoin(h, { key: B, name: "Bilal" }, "482913");
    expect(d.ok).toBe(true);
  });

  it("locks someone out after too many wrong codes", () => {
    const h = host(false);
    let last;
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) last = decideJoin(h, { key: B, name: "Bilal" }, "111111");
    expect(last).toEqual({ ok: false, reason: "locked" });
    // Even the right code is refused now.
    expect(decideJoin(h, { key: B, name: "Bilal" }, "482913")).toEqual({ ok: false, reason: "locked" });
    // Other people are not affected.
    expect(decideJoin(h, { key: C, name: "Chen" }, "482913").ok).toBe(true);
  });

  it("refuses when full", () => {
    const members = Array.from({ length: MAX_MEMBERS }, (_, i) => ({ key: i === 0 ? HOST : i.toString(16).padStart(64, "0"), name: "p" }));
    const h: HostState = { channel: channel(true, members), code: null, attempts: new Map() };
    expect(h.channel.count).toBe(MAX_MEMBERS);
    expect(decideJoin(h, { key: B, name: "Bilal" }, null)).toEqual({ ok: false, reason: "full" });
  });

  it("is idempotent for someone already in", () => {
    const h: HostState = { channel: channel(true, [{ key: HOST, name: "A" }, { key: B, name: "B" }]), code: null, attempts: new Map() };
    const d = decideJoin(h, { key: B, name: "B" }, null);
    expect(d.ok && d.channel.members).toHaveLength(2);
  });

  it("parses join requests and refusals", () => {
    expect(parseJoinMessage({ t: "walkie.join", id: "0123456789abcdef", code: "482 913" })).toEqual({ kind: "request", id: "0123456789abcdef", code: "482913" });
    expect(parseJoinMessage({ t: "walkie.join", id: "0123456789abcdef" })).toEqual({ kind: "request", id: "0123456789abcdef", code: null });
    expect(parseJoinMessage({ t: "walkie.join", id: "0123456789abcdef", ok: false, reason: "full" })).toEqual({ kind: "refused", id: "0123456789abcdef", reason: "full" });
    expect(parseJoinMessage({ t: "walkie.join", id: "0123456789abcdef", ok: true })).toBeNull();
  });
});

describe("roster and keys", () => {
  it("diffs the member list, leaving me out", () => {
    const before = [{ key: HOST, name: "A" }, { key: B, name: "B" }];
    const after = [{ key: HOST, name: "A" }, { key: C, name: "C" }];
    expect(rosterDiff(before, after, HOST)).toEqual({ added: [{ key: C, name: "C" }], removed: [{ key: B, name: "B" }] });
    const left = removeMember(channel(true, before), B);
    expect(left.members).toEqual([{ key: HOST, name: "A" }]);
    expect(left.count).toBe(1);
  });

  it("validates walkie.key", () => {
    const k = toBase64(rand(32));
    expect(parseKeyMessage({ t: "walkie.key", id: "0123456789abcdef", key: k })).toEqual({ id: "0123456789abcdef", key: k });
    expect(parseKeyMessage({ t: "walkie.key", id: "0123456789abcdef", key: toBase64(rand(8)) })).toBeNull();
  });

  it("validates pings", () => {
    expect(parsePing({ t: "walkie.ping", id: "0123456789abcdef", n: 3 })).toEqual({ id: "0123456789abcdef", n: 3 });
    expect(parsePing({ t: "walkie.ping", id: "0123456789abcdef", n: -1 })).toBeNull();
    expect(parsePing({ t: "walkie.ping", id: "0123456789abcdef", n: 1.5 })).toBeNull();
  });
});

describe("connection quality", () => {
  it("grades round trips", () => {
    expect(qualityFor(null, null)).toBe("unknown");
    expect(qualityFor(80, 100)).toBe("good");
    expect(qualityFor(250, 100)).toBe("fair");
    expect(qualityFor(900, 100)).toBe("poor");
    expect(qualityFor(80, PING_LOST_MS + 1)).toBe("lost");
  });

  it("measures against its own send time and ignores unknown pongs", () => {
    const t = new PingTracker();
    const n = t.ping(B, 1000);
    expect(t.pong(B, n + 99, 1050)).toBeNull();
    expect(t.pong(B, n, 1060)).toBe(60);
    expect(t.quality(B, 1100)).toBe("good");
    // A replayed pong for the same ping does not count twice.
    expect(t.pong(B, n, 1200)).toBeNull();
  });

  it("reports lost when pings go unanswered", () => {
    const t = new PingTracker();
    t.ping(C, 0);
    expect(t.quality(C, 1000)).toBe("unknown");
    expect(t.quality(C, PING_LOST_MS + 1)).toBe("lost");
    t.forget(C);
    expect(t.quality(C, PING_LOST_MS + 1)).toBe("unknown");
  });
});
