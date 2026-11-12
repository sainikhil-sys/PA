import { fromUtf8, toHex, utf8 } from "./bytes";
import { HandshakeState, safetyCode, type KeyPair, type Transport as NoiseTransport } from "./noise";

/**
 * One secure conversation over one link. Wire format, every frame:
 *   byte 0: version (1)   byte 1: kind (1 = handshake, 2 = sealed)   rest: Noise message
 * The handshake carries each side's display name inside the encrypted payload (messages 2 and 3),
 * so names are never sent in the clear after discovery. Sealed frames carry JSON app messages.
 */
const VERSION = 1;
const KIND_HANDSHAKE = 1;
const KIND_SEALED = 2;
const EMPTY = new Uint8Array(0);
export const MAX_TEXT = 4000;

/** Any feature message: `t` names it (at most 32 characters), the rest is that feature's JSON. */
export type FeatureMessage = { t: string } & Record<string, unknown>;
export type AppMessage = { t: "msg"; id: string; text: string; ts: number } | { t: "ack"; id: string } | FeatureMessage;
/** Largest JSON body per sealed frame (Nearby byte payloads are 32 KB; Noise adds 16 + 2 bytes). */
export const MAX_SEALED_JSON = 30_000;

export type SessionEvents = {
  /** Send these bytes over the link. */
  send: (bytes: Uint8Array) => void;
  /** Handshake done: the peer is who holds `peerKey`. */
  secure: (info: { peerKey: string; peerName: string; safetyCode: string }) => void;
  message: (m: AppMessage) => void;
  /** Anything malformed or forged: the caller should drop the link. */
  fail: (reason: string) => void;
};

function frame(kind: number, body: Uint8Array) {
  const out = new Uint8Array(body.length + 2);
  out[0] = VERSION;
  out[1] = kind;
  out.set(body, 2);
  return out;
}

function profile(name: string) {
  return utf8(JSON.stringify({ v: 1, name: name.slice(0, 40) }));
}

function readName(payload: Uint8Array): string {
  try {
    const p = JSON.parse(fromUtf8(payload)) as { name?: unknown };
    return typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : "Cowork user";
  } catch {
    return "Cowork user";
  }
}

export class SecureSession {
  private hs: HandshakeState;
  private noise: NoiseTransport | null = null;
  private closed = false;

  constructor(
    private readonly opts: {
      initiator: boolean;
      identity: KeyPair;
      myName: string;
      on: SessionEvents;
      /** Largest frame the link carries (Bluetooth LE: 4 KB). Larger messages throw instead of being cut. */
      maxFrame?: number;
    },
  ) {
    // The prologue binds both sides to this protocol and version.
    this.hs = new HandshakeState({ initiator: opts.initiator, staticKey: opts.identity, prologue: utf8("cowork-connect/1") });
  }

  get isSecure() {
    return this.noise !== null;
  }

  /** The initiator calls this once the link is up. */
  begin() {
    if (this.opts.initiator) this.opts.on.send(frame(KIND_HANDSHAKE, this.hs.writeMessage(EMPTY)));
  }

  receive(bytes: Uint8Array) {
    if (this.closed) return;
    try {
      if (bytes.length < 2 || bytes[0] !== VERSION) throw new Error("Unknown protocol version");
      const body = bytes.slice(2);
      if (bytes[1] === KIND_HANDSHAKE && !this.noise) this.onHandshake(body);
      else if (bytes[1] === KIND_SEALED && this.noise) this.onSealed(body);
      else throw new Error("Unexpected frame");
    } catch (err) {
      this.closed = true;
      this.opts.on.fail(err instanceof Error ? err.message : "Bad frame");
    }
  }

  private onHandshake(body: Uint8Array) {
    const payload = this.hs.readMessage(body);
    let peerName: string | null = null;
    if (payload.length) peerName = readName(payload);
    if (peerName) this.peerNameFromEarlier = peerName;
    if (!this.hs.complete && this.hs.myTurn) {
      // Responder answers message 1 with message 2 (its name inside); initiator answers 2 with 3.
      this.opts.on.send(frame(KIND_HANDSHAKE, this.hs.writeMessage(profile(this.opts.myName))));
    }
    // A fast link can deliver the reply (and finish the handshake) during the send above.
    if (this.noise) return;
    if (this.hs.complete) {
      this.noise = this.hs.split();
      this.opts.on.secure({ peerKey: toHex(this.noise.remoteStatic), peerName: peerName ?? this.peerNameFromEarlier ?? "Cowork user", safetyCode: safetyCode(this.noise.handshakeHash) });
    } else if (peerName) {
      this.peerNameFromEarlier = peerName;
    }
  }

  private peerNameFromEarlier: string | null = null;

  private onSealed(body: Uint8Array) {
    const plain = this.noise!.recv.decryptWithAd(EMPTY, body);
    const m = JSON.parse(fromUtf8(plain)) as AppMessage;
    if (!m || typeof m !== "object" || typeof m.t !== "string" || m.t.length > 32) return;
    if (m.t === "msg") {
      if (typeof m.id === "string" && typeof m.text === "string" && typeof m.ts === "number") this.opts.on.message({ t: "msg", id: m.id.slice(0, 64), text: m.text.slice(0, MAX_TEXT), ts: m.ts });
    } else if (m.t === "ack") {
      if (typeof m.id === "string") this.opts.on.message({ t: "ack", id: m.id.slice(0, 64) });
    } else {
      // Feature messages are validated by the feature that registered the type.
      this.opts.on.message(m);
    }
  }

  /** Encrypts and sends an app message. Only after the handshake. */
  sendMessage(m: AppMessage) {
    if (!this.noise || this.closed) throw new Error("Not connected securely");
    const json = utf8(JSON.stringify(m));
    // Frame header (2 bytes) and Noise tag (16 bytes) on top of the JSON.
    const limit = Math.min(MAX_SEALED_JSON, (this.opts.maxFrame ?? Infinity) - 2 - 16);
    if (json.length > limit) throw new Error("Message too large");
    this.opts.on.send(frame(KIND_SEALED, this.noise.send.encryptWithAd(EMPTY, json)));
  }

  close() {
    this.closed = true;
  }
}
