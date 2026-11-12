import { describe, expect, it } from "vitest";
import { KeyRing, newSendKey, parseAudioKey } from "../../src/features/connect/audio-keys";
import { fromBase64, toBase64 } from "../../src/features/connect/bytes";

const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

describe("audio keys", () => {
  it("makes 32-byte keys that differ every time", () => {
    const a = newSendKey(rand);
    const b = newSendKey(rand);
    expect(fromBase64(a)).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("rejects a random source that returns the wrong length", () => {
    expect(() => newSendKey(() => new Uint8Array(16))).toThrow();
  });

  it("accepts only canonical 32-byte keys from peers", () => {
    const key = toBase64(rand(32));
    expect(parseAudioKey(key)).toBe(key);
    expect(parseAudioKey(toBase64(rand(16)))).toBeNull();
    expect(parseAudioKey(toBase64(rand(33)))).toBeNull();
    expect(parseAudioKey(toBase64(new Uint8Array(32)))).toBeNull();
    expect(parseAudioKey("not base64 at all!")).toBeNull();
    expect(parseAudioKey(42)).toBeNull();
    expect(parseAudioKey("A".repeat(500))).toBeNull();
  });

  it("tracks who has my key and whose keys I hold", () => {
    const ring = new KeyRing("mine");
    expect(ring.needsSend("p1")).toBe(true);
    ring.markSent("p1");
    expect(ring.needsSend("p1")).toBe(false);
    expect(ring.setReceived("p1", "k1")).toBe("new");
    expect(ring.setReceived("p1", "k1")).toBe("same");
    expect(ring.setReceived("p1", "k2")).toBe("changed");
    expect(ring.received("p1")).toBe("k2");
    ring.remove("p1");
    expect(ring.received("p1")).toBeUndefined();
    expect(ring.needsSend("p1")).toBe(true);
  });

  it("a new send key has to be sent again to everyone", () => {
    const ring = new KeyRing("");
    ring.setReceived("p1", "k1");
    ring.markSent("p1");
    ring.rotate("fresh");
    expect(ring.mine).toBe("fresh");
    expect(ring.needsSend("p1")).toBe(true);
    expect(ring.received("p1")).toBe("k1");
    ring.clear();
    expect(ring.mine).toBe("");
    expect(ring.peersWithKeys()).toEqual([]);
  });
});
