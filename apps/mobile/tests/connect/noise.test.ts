import { describe, expect, it } from "vitest";
import { generateKeyPair, HandshakeState, keyPairFromPrivate, safetyCode } from "../../src/features/connect/noise";

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Official cacophony vector for Noise_XX_25519_ChaChaPoly_SHA256
// (github.com/haskell-cryptography/cacophony, vectors/cacophony.txt).
const V = {
  prologue: "4a6f686e2047616c74",
  initStatic: "e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1",
  initEphemeral: "893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
  respStatic: "4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893",
  respEphemeral: "bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
  handshakeHash: "c8e5f64e846193be2a834104c2a009868d6c9f3bd3c186299888b488b2f1f58e",
  payloads: ["4c756477696720766f6e204d69736573", "4d757272617920526f746862617264", "462e20412e20486179656b", "4361726c204d656e676572"],
  msg1: "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c79444c756477696720766f6e204d69736573",
  msg4: "96763ed773f8e47bb3712f0e29b3060ffc956ffc146cee53d5e1df",
};

describe("Noise XX", () => {
  it("matches the official test vector (handshake hash and first transport message)", () => {
    const init = new HandshakeState({ initiator: true, prologue: hex(V.prologue), staticKey: keyPairFromPrivate(hex(V.initStatic)), ephemeral: keyPairFromPrivate(hex(V.initEphemeral)) });
    const resp = new HandshakeState({ initiator: false, prologue: hex(V.prologue), staticKey: keyPairFromPrivate(hex(V.respStatic)), ephemeral: keyPairFromPrivate(hex(V.respEphemeral)) });

    const m1 = init.writeMessage(hex(V.payloads[0]!));
    expect(toHex(m1)).toBe(V.msg1);
    expect(toHex(resp.readMessage(m1))).toBe(V.payloads[0]);

    const m2 = resp.writeMessage(hex(V.payloads[1]!));
    expect(m2.length).toBe(32 + 48 + 15 + 16); // e, encrypted s, encrypted payload
    expect(toHex(init.readMessage(m2))).toBe(V.payloads[1]);

    const m3 = init.writeMessage(hex(V.payloads[2]!));
    expect(m3.length).toBe(48 + 11 + 16);
    expect(toHex(resp.readMessage(m3))).toBe(V.payloads[2]);

    const ti = init.split();
    const tr = resp.split();
    // The handshake hash covers every handshake ciphertext, so this proves messages 2 and 3 too.
    expect(toHex(ti.handshakeHash)).toBe(V.handshakeHash);
    expect(toHex(tr.handshakeHash)).toBe(V.handshakeHash);

    // Message 4 is the responder's first transport message.
    const m4 = tr.send.encryptWithAd(new Uint8Array(0), hex(V.payloads[3]!));
    expect(toHex(m4)).toBe(V.msg4);
    expect(toHex(ti.recv.decryptWithAd(new Uint8Array(0), m4))).toBe(V.payloads[3]);

    expect(toHex(ti.remoteStatic)).toBe(toHex(keyPairFromPrivate(hex(V.respStatic)).publicKey));
    expect(toHex(tr.remoteStatic)).toBe(toHex(keyPairFromPrivate(hex(V.initStatic)).publicKey));
  });

  it("completes with fresh keys and both sides agree on the safety code", () => {
    const a = new HandshakeState({ initiator: true, staticKey: generateKeyPair() });
    const b = new HandshakeState({ initiator: false, staticKey: generateKeyPair() });
    b.readMessage(a.writeMessage());
    a.readMessage(b.writeMessage());
    b.readMessage(a.writeMessage());
    const ta = a.split();
    const tb = b.split();
    expect(safetyCode(ta.handshakeHash)).toBe(safetyCode(tb.handshakeHash));
    expect(safetyCode(ta.handshakeHash)).toMatch(/^\d{6}$/);
    const c = ta.send.encryptWithAd(new Uint8Array(0), new TextEncoder().encode("hello"));
    expect(new TextDecoder().decode(tb.recv.decryptWithAd(new Uint8Array(0), c))).toBe("hello");
  });

  it("rejects a tampered handshake message and a tampered transport message", () => {
    const a = new HandshakeState({ initiator: true, staticKey: generateKeyPair() });
    const b = new HandshakeState({ initiator: false, staticKey: generateKeyPair() });
    b.readMessage(a.writeMessage());
    const m2 = b.writeMessage();
    m2[40] ^= 1; // inside the encrypted static key
    expect(() => a.readMessage(m2)).toThrow();

    const x = new HandshakeState({ initiator: true, staticKey: generateKeyPair() });
    const y = new HandshakeState({ initiator: false, staticKey: generateKeyPair() });
    y.readMessage(x.writeMessage());
    x.readMessage(y.writeMessage());
    y.readMessage(x.writeMessage());
    const tx = x.split();
    const ty = y.split();
    const c = tx.send.encryptWithAd(new Uint8Array(0), new TextEncoder().encode("hi"));
    c[0] ^= 1;
    expect(() => ty.recv.decryptWithAd(new Uint8Array(0), c)).toThrow();
  });

  it("refuses out-of-turn messages", () => {
    const a = new HandshakeState({ initiator: true, staticKey: generateKeyPair() });
    expect(() => a.readMessage(new Uint8Array(32))).toThrow();
  });
});
