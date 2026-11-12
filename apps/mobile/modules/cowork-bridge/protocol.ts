/**
 * Cowork Bridge wire protocol. This file is the reference: the Kotlin (`Wire.kt`) and Swift
 * (`CoworkBridgeModule.swift`, `Wire` enum) implementations mirror it byte for byte, and the unit
 * tests in `tests/connect/bridge-protocol.test.ts` pin it down. It has no React Native imports so it
 * can be tested in Node.
 *
 * Everything carried in DATA is opaque: the Noise session above encrypts it. The bridge only frames
 * it and enforces "nothing is delivered before both sides accept".
 *
 * Message body (both transports): `[u8 kind][payload]`
 *   1 HELLO   payload = UTF-8 display name (at most MAX_HELLO_BYTES). Each side sends it first.
 *   2 ACCEPT  empty. Sent when this side's person (or, for the side that asked, the app) accepts.
 *   3 REJECT  empty. The sender closes right after.
 *   4 DATA    opaque bytes. Only valid once both sides have sent ACCEPT; earlier DATA closes the link.
 *
 * LAN (TCP): each body travels as `[u32 big-endian length][body]`, 1 <= length <= MAX_LAN_BODY.
 *
 * Bluetooth LE (GATT): each body is split into chunks no larger than the ATT payload. A chunk is
 * `[u8 header][bytes]`; header bit 7 = first chunk of a body, bit 6 = last chunk, bits 0-5 = sequence
 * number (restarts at 0 for each body, wraps at 64). A body is at most MAX_BLE_BODY bytes.
 * Any violation (bad length, unknown kind, gap in the sequence, oversize) closes the link.
 */

export const Kind = { HELLO: 1, ACCEPT: 2, REJECT: 3, DATA: 4 } as const;
export type KindValue = (typeof Kind)[keyof typeof Kind];

/** Largest TCP frame body: 64 KiB. DATA payloads are one byte smaller (the kind byte). */
export const MAX_LAN_BODY = 64 * 1024;
export const MAX_LAN_DATA = MAX_LAN_BODY - 1;
/** Bluetooth LE is a text fallback: 4 KB of opaque data per message. */
export const MAX_BLE_DATA = 4 * 1024;
export const MAX_BLE_BODY = MAX_BLE_DATA + 1;
export const MAX_HELLO_BYTES = 200;
export const MAX_NAME_CHARS = 40;
/** Display name bytes that fit in a BLE scan response (manufacturer data, company 0xFFFF). */
export const MAX_ADV_NAME_BYTES = 24;

export const SERVICE_TYPE = "_coworkconnect._tcp";
export const BLE_SERVICE_UUID = "6f3d0001-7c5e-4a8b-9a0e-6c6f776f726b";
/** Central writes here (write with response). */
export const BLE_RX_UUID = "6f3d0002-7c5e-4a8b-9a0e-6c6f776f726b";
/** Peripheral notifies here. */
export const BLE_TX_UUID = "6f3d0003-7c5e-4a8b-9a0e-6c6f776f726b";

export const CHUNK_FIRST = 0x80;
export const CHUNK_LAST = 0x40;
const SEQ_MASK = 0x3f;

export class ProtocolError extends Error {}

export function body(kind: KindValue, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

export function parseBody(b: Uint8Array): { kind: KindValue; payload: Uint8Array } {
  if (b.length < 1) throw new ProtocolError("Empty body");
  const kind = b[0]!;
  if (kind < Kind.HELLO || kind > Kind.DATA) throw new ProtocolError("Unknown kind");
  const payload = b.subarray(1);
  if ((kind === Kind.ACCEPT || kind === Kind.REJECT) && payload.length) throw new ProtocolError("Unexpected payload");
  if (kind === Kind.HELLO && payload.length > MAX_HELLO_BYTES) throw new ProtocolError("Name too long");
  return { kind: kind as KindValue, payload };
}

/** Trims, strips control characters, caps at MAX_NAME_CHARS code points; never empty. */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const capped = Array.from(stripped).slice(0, MAX_NAME_CHARS).join("").trim();
  return capped || "Cowork user";
}

/** UTF-8 bytes of `s`, cut to at most `maxBytes` without splitting a character. */
export function truncateUtf8(s: string, maxBytes: number): Uint8Array {
  const enc = new TextEncoder();
  let out = new Uint8Array(0);
  for (const ch of Array.from(s)) {
    const next = enc.encode(ch);
    if (out.length + next.length > maxBytes) break;
    const grown = new Uint8Array(out.length + next.length);
    grown.set(out);
    grown.set(next, out.length);
    out = grown;
  }
  return out;
}

// ---------- LAN framing ----------

export function lanFrame(b: Uint8Array): Uint8Array {
  if (b.length < 1 || b.length > MAX_LAN_BODY) throw new ProtocolError("Bad frame length");
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, false);
  out.set(b, 4);
  return out;
}

/** Turns a TCP byte stream back into bodies. Throws ProtocolError (close the link) on a bad length. */
export class LanDecoder {
  // Growable buffer: bytes [start, end) are unread. Appends are amortised O(1).
  private buf = new Uint8Array(1024);
  private start = 0;
  private end = 0;

  push(bytes: Uint8Array): Uint8Array[] {
    if (this.end + bytes.length > this.buf.length) {
      const unread = this.end - this.start;
      const next = unread + bytes.length > this.buf.length ? new Uint8Array(Math.max(this.buf.length * 2, unread + bytes.length)) : this.buf;
      next.set(this.buf.subarray(this.start, this.end));
      this.buf = next;
      this.start = 0;
      this.end = unread;
    }
    this.buf.set(bytes, this.end);
    this.end += bytes.length;
    const out: Uint8Array[] = [];
    while (this.end - this.start >= 4) {
      const b = this.buf;
      const len = ((b[this.start]! << 24) | (b[this.start + 1]! << 16) | (b[this.start + 2]! << 8) | b[this.start + 3]!) >>> 0;
      if (len < 1 || len > MAX_LAN_BODY) throw new ProtocolError("Bad frame length");
      if (this.end - this.start - 4 < len) break;
      out.push(b.slice(this.start + 4, this.start + 4 + len));
      this.start += 4 + len;
    }
    if (this.start === this.end) this.start = this.end = 0;
    return out;
  }
}

// ---------- Bluetooth LE chunking ----------

/** Splits a body into GATT chunks of at most `chunkSize` bytes each (header included). */
export function bleChunks(b: Uint8Array, chunkSize: number): Uint8Array[] {
  if (b.length < 1 || b.length > MAX_BLE_BODY) throw new ProtocolError("Bad body length");
  if (chunkSize < 2) throw new ProtocolError("Chunk size too small");
  const room = chunkSize - 1;
  const out: Uint8Array[] = [];
  for (let at = 0, seq = 0; at < b.length; at += room, seq++) {
    const part = b.subarray(at, Math.min(at + room, b.length));
    const header = (at === 0 ? CHUNK_FIRST : 0) | (at + room >= b.length ? CHUNK_LAST : 0) | (seq & SEQ_MASK);
    const chunk = new Uint8Array(1 + part.length);
    chunk[0] = header;
    chunk.set(part, 1);
    out.push(chunk);
  }
  return out;
}

/** Reassembles chunks for one direction of one link. Returns a body when complete, else null. */
export class BleReassembler {
  private parts: Uint8Array[] | null = null;
  private size = 0;
  private nextSeq = 0;

  push(chunk: Uint8Array): Uint8Array | null {
    if (chunk.length < 2) throw new ProtocolError("Empty chunk");
    const header = chunk[0]!;
    const seq = header & SEQ_MASK;
    if (header & CHUNK_FIRST) {
      if (this.parts) throw new ProtocolError("Body restarted");
      if (seq !== 0) throw new ProtocolError("Bad sequence");
      this.parts = [];
      this.size = 0;
      this.nextSeq = 0;
    } else if (!this.parts) {
      throw new ProtocolError("Chunk without a start");
    }
    if (seq !== this.nextSeq) throw new ProtocolError("Bad sequence");
    this.nextSeq = (this.nextSeq + 1) & SEQ_MASK;
    const part = chunk.subarray(1);
    this.size += part.length;
    if (this.size > MAX_BLE_BODY) throw new ProtocolError("Body too large");
    this.parts!.push(part.slice());
    if (!(header & CHUNK_LAST)) return null;
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts!) {
      out.set(p, at);
      at += p.length;
    }
    this.parts = null;
    this.size = 0;
    return out;
  }
}

// ---------- Link state (what the native side enforces) ----------

export type LinkStep = "hello" | "pending" | "connected" | "closed";

/**
 * The accept rules as a tiny state machine. Native code implements the same transitions; this one
 * exists so the rules are tested. `onBody` returns what the native layer should emit.
 */
export class LinkRules {
  peerName: string | null = null;
  localAccepted = false;
  remoteAccepted = false;
  step: LinkStep = "hello";

  onBody(b: Uint8Array): { emit: "request"; name: string } | { emit: "connected" } | { emit: "data"; bytes: Uint8Array } | { emit: "rejected" } | { emit: null } {
    if (this.step === "closed") throw new ProtocolError("Closed");
    const { kind, payload } = parseBody(b);
    switch (kind) {
      case Kind.HELLO:
        if (this.peerName !== null) throw new ProtocolError("Second hello");
        this.peerName = cleanName(new TextDecoder().decode(payload));
        this.step = "pending";
        return { emit: "request", name: this.peerName };
      case Kind.ACCEPT:
        if (this.peerName === null || this.remoteAccepted) throw new ProtocolError("Unexpected accept");
        this.remoteAccepted = true;
        return this.maybeConnected();
      case Kind.REJECT:
        this.step = "closed";
        return { emit: "rejected" };
      case Kind.DATA:
        if (this.step !== "connected") throw new ProtocolError("Data before accept");
        return { emit: "data", bytes: payload };
    }
    throw new ProtocolError("Unknown kind");
  }

  /** This side accepts. Valid once the peer's hello arrived. */
  accept(): { emit: "connected" } | { emit: null } {
    if (this.peerName === null || this.step === "closed") throw new ProtocolError("Nothing to accept");
    if (this.localAccepted) return { emit: null };
    this.localAccepted = true;
    return this.maybeConnected();
  }

  private maybeConnected(): { emit: "connected" } | { emit: null } {
    if (this.localAccepted && this.remoteAccepted && this.step !== "connected") {
      this.step = "connected";
      return { emit: "connected" };
    }
    return { emit: null };
  }
}

// ---------- Link ids ----------

export const isLanLink = (link: string) => link.startsWith("lan:");
export const isBleLink = (link: string) => link.startsWith("ble:");
