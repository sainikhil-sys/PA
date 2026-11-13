import { createHmac, createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => null, schema: {} }));
vi.mock("@/lib/spaces/service", () => ({ getSpace: async () => null }));
vi.mock("@/lib/social/service", () => ({ SocialError: class extends Error {} }));

const keys = await import("@/lib/connect/keys");
const rules = await import("@/lib/spaces/room-rules");

const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const rawPublic = (k: KeyObject) => Buffer.from(k.export({ format: "der", type: "spki" })).subarray(-32).toString("hex");

/** What the app does: X25519 with the server key, then HMAC over the account and key. */
function appProof(privateKey: KeyObject, serverHex: string, account: string, publicHex: string) {
  const serverKey = createPublicKey({ key: Buffer.concat([SPKI_X25519, Buffer.from(serverHex, "hex")]), format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey, publicKey: serverKey });
  return createHmac("sha256", shared).update(`cowork-connect-key-v1|${account}|${publicHex}`).digest("hex");
}

describe("Connect key proof", () => {
  const ALICE = "11111111-1111-4111-8111-111111111111";
  const BOB = "22222222-2222-4222-8222-222222222222";
  let serverHex: string;
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-secret-for-connect-keys";
    keys.resetServerKeyForTests();
    serverHex = keys.serverPublicKeyHex()!;
  });

  it("derives a stable 32-byte server key from the secret", () => {
    expect(serverHex).toMatch(keys.KEY_HEX);
    keys.resetServerKeyForTests();
    expect(keys.serverPublicKeyHex()).toBe(serverHex);
  });

  it("accepts a proof made with the matching private key", () => {
    const pair = generateKeyPairSync("x25519");
    const pub = rawPublic(pair.publicKey);
    expect(keys.verifyKeyProof(ALICE, pub, appProof(pair.privateKey, serverHex, ALICE, pub))).toBe(true);
  });

  it("refuses a proof bound to another account, another key, or made without the private key", () => {
    const pair = generateKeyPairSync("x25519");
    const other = generateKeyPairSync("x25519");
    const pub = rawPublic(pair.publicKey);
    const proof = appProof(pair.privateKey, serverHex, ALICE, pub);
    expect(keys.verifyKeyProof(BOB, pub, proof)).toBe(false);
    expect(keys.verifyKeyProof(ALICE, rawPublic(other.publicKey), proof)).toBe(false);
    expect(keys.verifyKeyProof(ALICE, pub, appProof(other.privateKey, serverHex, ALICE, pub))).toBe(false);
    expect(keys.verifyKeyProof(ALICE, pub, "0".repeat(64))).toBe(false);
  });

  it("refuses malformed input and the all-zero (low-order) key", () => {
    expect(keys.verifyKeyProof(ALICE, "xyz", "0".repeat(64))).toBe(false);
    expect(keys.verifyKeyProof(ALICE, "0".repeat(64), "0".repeat(64))).toBe(false);
    const pair = generateKeyPairSync("x25519");
    expect(keys.verifyKeyProof(ALICE, rawPublic(pair.publicKey), "abc")).toBe(false);
  });

  it("has no server key without a secret", () => {
    const saved = { e: process.env.ENCRYPTION_KEY, a: process.env.AUTH_SECRET };
    delete process.env.ENCRYPTION_KEY;
    delete process.env.AUTH_SECRET;
    keys.resetServerKeyForTests();
    expect(keys.serverPublicKeyHex()).toBeNull();
    process.env.ENCRYPTION_KEY = saved.e;
    if (saved.a) process.env.AUTH_SECRET = saved.a;
    keys.resetServerKeyForTests();
  });
});

describe("who may be recognised by key", () => {
  const me = "me";
  const rel = (o: Partial<Record<"spaceMates" | "friends" | "blocked", string[]>> = {}) => ({
    spaceMates: new Set(o.spaceMates ?? []),
    friends: new Set(o.friends ?? []),
    blocked: new Set(o.blocked ?? []),
  });
  it("yourself, Space mates and friends yes; strangers no", () => {
    expect(keys.mayRecognise(me, me, rel())).toBe(true);
    expect(keys.mayRecognise(me, "a", rel({ spaceMates: ["a"] }))).toBe(true);
    expect(keys.mayRecognise(me, "f", rel({ friends: ["f"] }))).toBe(true);
    expect(keys.mayRecognise(me, "s", rel({ spaceMates: ["a"], friends: ["f"] }))).toBe(false);
  });
  it("blocked either way: no, even when sharing a Space or friends", () => {
    expect(keys.mayRecognise(me, "a", rel({ spaceMates: ["a"], friends: ["a"], blocked: ["a"] }))).toBe(false);
  });
});

describe("room timer maths", () => {
  const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);
  const focus = { kind: "focus" as const, timerStatus: "idle" as const, durationSec: 1500, endsAt: null, remainingSec: null, mediaUrl: null };

  it("start sets a server-time end; the view counts down from it and reads done after", () => {
    const c = rules.applyRoomAction(focus, { action: "start", minutes: 25 }, T0);
    expect(c).toMatchObject({ timerStatus: "running", durationSec: 1500, remainingSec: null });
    expect(c.endsAt!.getTime()).toBe(T0 + 25 * 60_000);
    const running = { ...focus, ...c } as typeof focus & typeof c;
    expect(rules.timerView(running as never, T0 + 60_000)).toMatchObject({ status: "running", remainingSec: 24 * 60 });
    expect(rules.timerView(running as never, T0 + 25 * 60_000).status).toBe("done");
  });

  it("pause keeps the remaining seconds (rounded up); resume continues from them", () => {
    const running = { ...focus, timerStatus: "running" as const, endsAt: new Date(T0 + 600_000) };
    const paused = rules.applyRoomAction(running, { action: "pause" }, T0 + 100_500);
    expect(paused).toEqual({ timerStatus: "paused", remainingSec: 500, endsAt: null });
    const p = { ...running, ...paused } as never;
    expect(rules.timerView(p, T0 + 999_999)).toMatchObject({ status: "paused", remainingSec: 500, endsAt: null });
    const resumed = rules.applyRoomAction(p, { action: "resume" }, T0 + 200_000);
    expect(resumed).toEqual({ timerStatus: "running", endsAt: new Date(T0 + 200_000 + 500_000), remainingSec: null });
  });

  it("refuses pausing a finished or idle timer, resuming one not paused, and timers in listen rooms", () => {
    const finished = { ...focus, timerStatus: "running" as const, endsAt: new Date(T0) };
    expect(() => rules.applyRoomAction(finished, { action: "pause" }, T0 + 1)).toThrow(rules.RoomRuleError);
    expect(() => rules.applyRoomAction(focus, { action: "pause" }, T0)).toThrow("The timer isn't running.");
    expect(() => rules.applyRoomAction(focus, { action: "resume" }, T0)).toThrow("The timer isn't paused.");
    expect(() => rules.applyRoomAction({ ...focus, kind: "listen" }, { action: "start", minutes: 5 }, T0)).toThrow("This room doesn't have a timer.");
    expect(() => rules.applyRoomAction(focus, { action: "media", url: "https://youtu.be/dQw4w9WgXcQ" }, T0)).toThrow("This room doesn't share music.");
  });

  it("reset clears the timer; start clamps minutes to 1 to 180", () => {
    expect(rules.applyRoomAction({ ...focus, timerStatus: "paused", remainingSec: 30 }, { action: "reset" }, T0)).toEqual({ timerStatus: "idle", endsAt: null, remainingSec: null });
    expect(rules.applyRoomAction(focus, { action: "start", minutes: 999 }, T0).durationSec).toBe(180 * 60);
  });

  it("listen together starts a lead time after the link is set; restart needs a link", () => {
    const listen = { ...focus, kind: "listen" as const };
    const c = rules.applyRoomAction(listen, { action: "media", url: "https://youtu.be/dQw4w9WgXcQ?si=track" }, T0);
    expect(c).toEqual({ mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", mediaKind: "youtube", mediaStartAt: new Date(T0 + rules.LISTEN_LEAD_MS) });
    expect(() => rules.applyRoomAction(listen, { action: "restart" }, T0)).toThrow("Add a link first.");
    expect(rules.applyRoomAction({ ...listen, mediaUrl: c.mediaUrl! }, { action: "restart" }, T0 + 5)).toEqual({ mediaStartAt: new Date(T0 + 5 + rules.LISTEN_LEAD_MS) });
    expect(rules.applyRoomAction(listen, { action: "clearMedia" }, T0)).toEqual({ mediaUrl: null, mediaKind: null, mediaStartAt: null });
  });

  it("present means a heartbeat within 45 seconds", () => {
    expect(rules.isPresent(new Date(T0 - 44_999), T0)).toBe(true);
    expect(rules.isPresent(new Date(T0 - 45_000), T0)).toBe(false);
  });
});

describe("listen-together link cleaning", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&utm_source=x", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ?feature=share", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["  https://youtu.be/dQw4w9WgXcQ?t=42  ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "spotify"],
    ["https://open.spotify.com/intl-de/album/4uLU6hMCjMI75M1A2tKUQC", "https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC", "spotify"],
    ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M/", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "spotify"],
  ])("%s", (raw, url, kind) => {
    expect(rules.parseMediaUrl(raw)).toEqual({ url, kind });
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UC123",
    "https://open.spotify.com/artist/4uLU6hMCjMI75M1A2tKUQC/extra",
    "https://open.spotify.com/track/tooShort",
    "javascript:alert(1)",
    "not a link",
  ])("refuses %s", (raw) => {
    expect(rules.parseMediaUrl(raw)).toBeNull();
  });
});
