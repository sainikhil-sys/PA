import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Noise_XX_25519_ChaChaPoly_SHA256 (https://noiseprotocol.org/noise.html, revision 34), built on the
 * audited @noble primitives. Both peers authenticate with long-term X25519 keys, and every session gets
 * fresh ephemeral keys (forward secrecy). Verified against the official cacophony test vector in
 * tests: the handshake hash and the first transport message match byte for byte.
 *
 *   -> e
 *   <- e, ee, s, es
 *   -> s, se
 */

export const PROTOCOL_NAME = "Noise_XX_25519_ChaChaPoly_SHA256";
const DHLEN = 32;
const HASHLEN = 32;
const TAGLEN = 16;
const MAX_NONCE = 2n ** 64n - 1n;

export type KeyPair = { privateKey: Uint8Array; publicKey: Uint8Array };

export function keyPairFromPrivate(privateKey: Uint8Array): KeyPair {
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function generateKeyPair(): KeyPair {
  return keyPairFromPrivate(x25519.utils.randomSecretKey());
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** HKDF as defined by Noise (section 4.3), returning two or three 32-byte outputs. */
function hkdf(chainingKey: Uint8Array, ikm: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const tempKey = hmac(sha256, chainingKey, ikm);
  const o1 = hmac(sha256, tempKey, Uint8Array.of(1));
  const o2 = hmac(sha256, tempKey, concat(o1, Uint8Array.of(2)));
  if (outputs === 2) return [o1, o2];
  return [o1, o2, hmac(sha256, tempKey, concat(o2, Uint8Array.of(3)))];
}

/** 96-bit ChaChaPoly nonce: 32 zero bits, then the 64-bit counter little-endian. */
function nonceBytes(n: bigint): Uint8Array {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setBigUint64(4, n, true);
  return out;
}

export class CipherState {
  private k: Uint8Array | null = null;
  private n = 0n;

  constructor(key?: Uint8Array) {
    if (key) this.initializeKey(key);
  }

  initializeKey(key: Uint8Array) {
    this.k = key;
    this.n = 0n;
  }

  hasKey() {
    return this.k !== null;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.k) return plaintext;
    if (this.n >= MAX_NONCE) throw new Error("Noise nonce exhausted");
    const c = chacha20poly1305(this.k, nonceBytes(this.n), ad).encrypt(plaintext);
    this.n += 1n;
    return c;
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.k) return ciphertext;
    if (this.n >= MAX_NONCE) throw new Error("Noise nonce exhausted");
    // Throws on a failed tag; the nonce only advances on success (Noise section 5.1).
    const p = chacha20poly1305(this.k, nonceBytes(this.n), ad).decrypt(ciphertext);
    this.n += 1n;
    return p;
  }
}

class SymmetricState {
  cipher = new CipherState();
  ck: Uint8Array;
  h: Uint8Array;

  constructor(protocolName: string) {
    const name = new TextEncoder().encode(protocolName);
    if (name.length <= HASHLEN) {
      this.h = new Uint8Array(HASHLEN);
      this.h.set(name);
    } else {
      this.h = sha256(name);
    }
    this.ck = this.h.slice();
  }

  mixKey(ikm: Uint8Array) {
    const [ck, tempK] = hkdf(this.ck, ikm, 2);
    this.ck = ck!;
    this.cipher.initializeKey(tempK!.slice(0, 32));
  }

  mixHash(data: Uint8Array) {
    this.h = sha256(concat(this.h, data));
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const c = this.cipher.encryptWithAd(this.h, plaintext);
    this.mixHash(c);
    return c;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const p = this.cipher.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);
    return p;
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf(this.ck, new Uint8Array(0), 2);
    return [new CipherState(k1!.slice(0, 32)), new CipherState(k2!.slice(0, 32))];
  }
}

const dh = (kp: KeyPair, pub: Uint8Array) => x25519.getSharedSecret(kp.privateKey, pub);

export type Transport = { send: CipherState; recv: CipherState; handshakeHash: Uint8Array; remoteStatic: Uint8Array };

/**
 * One side of an XX handshake. Call writeMessage / readMessage alternately (the initiator writes
 * first), three messages in total, then split() for the transport ciphers.
 */
export class HandshakeState {
  private ss: SymmetricState;
  private e: KeyPair | null;
  private re: Uint8Array | null = null;
  private rs: Uint8Array | null = null;
  private step = 0;

  constructor(
    private readonly opts: {
      initiator: boolean;
      staticKey: KeyPair;
      prologue?: Uint8Array;
      /** Tests only: a fixed ephemeral key. Never set it in the app. */
      ephemeral?: KeyPair;
    },
  ) {
    this.ss = new SymmetricState(PROTOCOL_NAME);
    this.ss.mixHash(opts.prologue ?? new Uint8Array(0));
    this.e = opts.ephemeral ?? null;
  }

  get complete() {
    return this.step >= 3;
  }

  /** Whose turn it is to write the next handshake message. */
  get myTurn() {
    return !this.complete && (this.step % 2 === 0) === this.opts.initiator;
  }

  writeMessage(payload: Uint8Array = new Uint8Array(0)): Uint8Array {
    if (!this.myTurn) throw new Error("Not this side's turn to write");
    const s = this.opts.staticKey;
    const parts: Uint8Array[] = [];
    if (this.step === 0) {
      // -> e
      this.e ??= generateKeyPair();
      parts.push(this.e.publicKey);
      this.ss.mixHash(this.e.publicKey);
    } else if (this.step === 1) {
      // <- e, ee, s, es
      this.e ??= generateKeyPair();
      parts.push(this.e.publicKey);
      this.ss.mixHash(this.e.publicKey);
      this.ss.mixKey(dh(this.e, this.re!));
      parts.push(this.ss.encryptAndHash(s.publicKey));
      this.ss.mixKey(dh(s, this.re!));
    } else {
      // -> s, se
      parts.push(this.ss.encryptAndHash(s.publicKey));
      this.ss.mixKey(dh(s, this.re!));
    }
    parts.push(this.ss.encryptAndHash(payload));
    this.step += 1;
    return concat(...parts);
  }

  readMessage(message: Uint8Array): Uint8Array {
    if (this.myTurn || this.complete) throw new Error("Not this side's turn to read");
    let o = 0;
    const take = (n: number) => {
      if (o + n > message.length) throw new Error("Handshake message too short");
      const part = message.slice(o, o + n);
      o += n;
      return part;
    };
    const keyLen = () => DHLEN + (this.ss.cipher.hasKey() ? TAGLEN : 0);
    if (this.step === 0) {
      this.re = take(DHLEN);
      this.ss.mixHash(this.re);
    } else if (this.step === 1) {
      this.re = take(DHLEN);
      this.ss.mixHash(this.re);
      this.ss.mixKey(dh(this.e!, this.re));
      this.rs = this.ss.decryptAndHash(take(keyLen()));
      this.ss.mixKey(dh(this.e!, this.rs));
    } else {
      this.rs = this.ss.decryptAndHash(take(keyLen()));
      this.ss.mixKey(dh(this.e!, this.rs));
    }
    const payload = this.ss.decryptAndHash(message.slice(o));
    this.step += 1;
    return payload;
  }

  /** Transport ciphers once all three messages are done. The initiator sends with the first. */
  split(): Transport {
    if (!this.complete || !this.rs) throw new Error("Handshake not complete");
    const [c1, c2] = this.ss.split();
    return {
      send: this.opts.initiator ? c1 : c2,
      recv: this.opts.initiator ? c2 : c1,
      handshakeHash: this.ss.h.slice(),
      remoteStatic: this.rs.slice(),
    };
  }
}

/**
 * Six-digit safety code both people compare on screen. It is derived from the handshake hash, which
 * both sides compute identically only when no one is in the middle.
 */
export function safetyCode(handshakeHash: Uint8Array): string {
  const d = sha256(concat(new TextEncoder().encode("cowork-connect safety code v1"), handshakeHash));
  const n = new DataView(d.buffer, d.byteOffset).getUint32(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}
