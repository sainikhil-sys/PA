import { describe, expect, it } from "vitest";
import { fromBase64, fromHex, toBase64, toHex } from "../../src/features/connect/bytes";
import { generateKeyPair } from "../../src/features/connect/noise";
import { SecureSession, type AppMessage } from "../../src/features/connect/session";

function pair() {
  const log = { a: [] as AppMessage[], b: [] as AppMessage[], secureA: null as null | { peerKey: string; peerName: string; safetyCode: string }, secureB: null as null | { peerKey: string; peerName: string; safetyCode: string }, failA: "", failB: "" };
  const idA = generateKeyPair();
  const idB = generateKeyPair();
  let a!: SecureSession;
  let b!: SecureSession;
  // A tiny in-memory link that delivers frames in order.
  a = new SecureSession({ initiator: true, identity: idA, myName: "Asha", on: { send: (x) => b.receive(x), secure: (i) => (log.secureA = i), message: (m) => log.a.push(m), fail: (r) => (log.failA = r) } });
  b = new SecureSession({ initiator: false, identity: idB, myName: "Bilal", on: { send: (x) => a.receive(x), secure: (i) => (log.secureB = i), message: (m) => log.b.push(m), fail: (r) => (log.failB = r) } });
  return { a, b, log, idA, idB };
}

describe("SecureSession", () => {
  it("authenticates both sides, exchanges names and agrees on the safety code", () => {
    const { a, b, log, idA, idB } = pair();
    a.begin();
    expect(a.isSecure && b.isSecure).toBe(true);
    expect(log.secureA?.peerName).toBe("Bilal");
    expect(log.secureB?.peerName).toBe("Asha");
    expect(log.secureA?.peerKey).toBe(toHex(idB.publicKey));
    expect(log.secureB?.peerKey).toBe(toHex(idA.publicKey));
    expect(log.secureA?.safetyCode).toBe(log.secureB?.safetyCode);
  });

  it("delivers messages both ways", () => {
    const { a, b, log } = pair();
    a.begin();
    a.sendMessage({ t: "msg", id: "1", text: "Meet at the library?", ts: 1 });
    b.sendMessage({ t: "msg", id: "2", text: "Yes, 5pm", ts: 2 });
    b.sendMessage({ t: "ack", id: "1" });
    expect(log.b).toEqual([{ t: "msg", id: "1", text: "Meet at the library?", ts: 1 }]);
    expect(log.a).toEqual([{ t: "msg", id: "2", text: "Yes, 5pm", ts: 2 }, { t: "ack", id: "1" }]);
  });

  it("fails closed on a forged or tampered frame", () => {
    const { a, b, log } = pair();
    a.begin();
    b.receive(Uint8Array.of(1, 2, 9, 9, 9));
    expect(log.failB).not.toBe("");
    // A failed session ignores everything after.
    a.sendMessage({ t: "msg", id: "3", text: "hello", ts: 3 });
    expect(log.b).toEqual([]);
  });

  it("will not send before the handshake", () => {
    const { a } = pair();
    expect(() => a.sendMessage({ t: "msg", id: "x", text: "too early", ts: 0 })).toThrow();
  });
});

describe("bytes", () => {
  it("round-trips base64 and hex", () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33, 1000]) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37) & 255);
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
      expect(Array.from(fromHex(toHex(b)))).toEqual(Array.from(b));
    }
    expect(toBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
    expect(toBase64(new TextEncoder().encode("Ma"))).toBe("TWE=");
  });
});
