import { describe, expect, it } from "vitest";
import {
  BleReassembler,
  CHUNK_FIRST,
  CHUNK_LAST,
  Kind,
  LanDecoder,
  LinkRules,
  MAX_BLE_BODY,
  MAX_BLE_DATA,
  MAX_LAN_BODY,
  ProtocolError,
  bleChunks,
  body,
  cleanName,
  isBleLink,
  isLanLink,
  lanFrame,
  parseBody,
  truncateUtf8,
} from "../../modules/cowork-bridge/protocol";

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

describe("LAN framing", () => {
  it("writes a big-endian u32 length before the body", () => {
    const f = lanFrame(body(Kind.DATA, Uint8Array.of(9, 8, 7)));
    expect(Array.from(f)).toEqual([0, 0, 0, 4, Kind.DATA, 9, 8, 7]);
  });

  it("round-trips frames split and merged at arbitrary points", () => {
    const bodies = [body(Kind.HELLO, new TextEncoder().encode("Asha")), body(Kind.ACCEPT), body(Kind.DATA, bytes(MAX_LAN_BODY - 1))];
    const stream = Uint8Array.from(bodies.flatMap((b) => Array.from(lanFrame(b))));
    for (const step of [1, 3, 4, 5, 1000, stream.length]) {
      const d = new LanDecoder();
      const out: Uint8Array[] = [];
      for (let i = 0; i < stream.length; i += step) out.push(...d.push(stream.subarray(i, i + step)));
      expect(out.map((b) => Array.from(b))).toEqual(bodies.map((b) => Array.from(b)));
    }
  });

  it("refuses a zero length or one above 64 KiB", () => {
    expect(() => new LanDecoder().push(Uint8Array.of(0, 0, 0, 0))).toThrow(ProtocolError);
    expect(() => new LanDecoder().push(Uint8Array.of(0, 1, 0, 1))).toThrow(ProtocolError);
    expect(() => lanFrame(new Uint8Array(MAX_LAN_BODY + 1))).toThrow(ProtocolError);
    expect(lanFrame(new Uint8Array(MAX_LAN_BODY)).length).toBe(MAX_LAN_BODY + 4);
  });
});

describe("Bluetooth LE chunking", () => {
  it("marks first and last chunks and numbers them", () => {
    const chunks = bleChunks(body(Kind.DATA, bytes(45)), 20);
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 9]) // 46-byte body, 19 bytes of room per chunk;
    expect(chunks.map((c) => c[0])).toEqual([CHUNK_FIRST | 0, 1, CHUNK_LAST | 2]);
    const single = bleChunks(body(Kind.ACCEPT), 20);
    expect(Array.from(single[0]!)).toEqual([CHUNK_FIRST | CHUNK_LAST, Kind.ACCEPT]);
  });

  it("reassembles the largest message at several MTUs, sequence wrapping past 63", () => {
    const b = body(Kind.DATA, bytes(MAX_BLE_DATA, 7));
    for (const size of [20, 182, 509]) {
      const r = new BleReassembler();
      const chunks = bleChunks(b, size);
      const results = chunks.map((c) => r.push(c));
      expect(results.slice(0, -1).every((x) => x === null)).toBe(true);
      expect(Array.from(results.at(-1)!)).toEqual(Array.from(b));
    }
    expect(bleChunks(b, 20).length).toBeGreaterThan(64);
  });

  it("handles back-to-back messages", () => {
    const r = new BleReassembler();
    const a = body(Kind.HELLO, new TextEncoder().encode("Bilal"));
    const c = body(Kind.DATA, bytes(100));
    const got = [...bleChunks(a, 23), ...bleChunks(c, 23)].map((x) => r.push(x)).filter((x): x is Uint8Array => x !== null);
    expect(got.map((x) => Array.from(x))).toEqual([Array.from(a), Array.from(c)]);
  });

  it("fails closed on a lost, repeated or unstarted chunk, or an oversize body", () => {
    const chunks = bleChunks(body(Kind.DATA, bytes(100)), 20);
    const lost = new BleReassembler();
    lost.push(chunks[0]!);
    expect(() => lost.push(chunks[2]!)).toThrow(ProtocolError);

    const repeated = new BleReassembler();
    repeated.push(chunks[0]!);
    expect(() => repeated.push(chunks[0]!)).toThrow(ProtocolError);

    expect(() => new BleReassembler().push(chunks[1]!)).toThrow(ProtocolError);
    expect(() => bleChunks(new Uint8Array(MAX_BLE_BODY + 1), 20)).toThrow(ProtocolError);

    // A forged stream that never sets "last" must stop at the size cap.
    const r = new BleReassembler();
    const part = new Uint8Array(200);
    expect(() => {
      for (let seq = 0; seq < 64; seq++) {
        const c = new Uint8Array(201);
        c[0] = (seq === 0 ? CHUNK_FIRST : 0) | seq;
        c.set(part, 1);
        r.push(c);
      }
    }).toThrow(ProtocolError);
  });
});

describe("bodies and names", () => {
  it("rejects unknown kinds, payloads on ACCEPT/REJECT, and long hellos", () => {
    expect(() => parseBody(Uint8Array.of(9))).toThrow(ProtocolError);
    expect(() => parseBody(new Uint8Array(0))).toThrow(ProtocolError);
    expect(() => parseBody(Uint8Array.of(Kind.ACCEPT, 1))).toThrow(ProtocolError);
    expect(() => parseBody(body(Kind.HELLO, new Uint8Array(201)))).toThrow(ProtocolError);
    expect(parseBody(body(Kind.DATA, Uint8Array.of(1, 2))).kind).toBe(Kind.DATA);
  });

  it("cleans display names", () => {
    expect(cleanName("  Asha\u0000\n ")).toBe("Asha");
    expect(cleanName("")).toBe("Cowork user");
    expect(Array.from(cleanName("😀".repeat(50))).length).toBe(40);
  });

  it("truncates UTF-8 without splitting a character", () => {
    expect(truncateUtf8("abc", 24)).toEqual(new TextEncoder().encode("abc"));
    const cut = truncateUtf8("é".repeat(20), 5);
    expect(cut.length).toBe(4);
    expect(new TextDecoder().decode(cut)).toBe("éé");
    expect(truncateUtf8("😀😀", 7).length).toBe(4);
  });

  it("recognises link prefixes", () => {
    expect(isLanLink("lan:in:1")).toBe(true);
    expect(isBleLink("ble:c:AA:BB")).toBe(true);
    expect(isLanLink("ble:x")).toBe(false);
  });
});

describe("accept rules", () => {
  const hello = (name: string) => body(Kind.HELLO, new TextEncoder().encode(name));

  it("delivers nothing before both sides accept", () => {
    const l = new LinkRules();
    expect(l.onBody(hello("Asha"))).toEqual({ emit: "request", name: "Asha" });
    expect(() => l.onBody(body(Kind.DATA, Uint8Array.of(1)))).toThrow(ProtocolError);
  });

  it("connects once both accept, in either order", () => {
    const a = new LinkRules();
    a.onBody(hello("Asha"));
    expect(a.accept()).toEqual({ emit: null });
    expect(a.onBody(body(Kind.ACCEPT))).toEqual({ emit: "connected" });
    expect(a.onBody(body(Kind.DATA, Uint8Array.of(5)))).toMatchObject({ emit: "data" });

    const b = new LinkRules();
    b.onBody(hello("Bilal"));
    expect(b.onBody(body(Kind.ACCEPT))).toEqual({ emit: null });
    expect(() => b.onBody(body(Kind.DATA, Uint8Array.of(1)))).toThrow(ProtocolError);
    expect(b.accept()).toEqual({ emit: "connected" });
  });

  it("refuses accepts before hello, second hellos, and anything after reject", () => {
    expect(() => new LinkRules().accept()).toThrow(ProtocolError);
    expect(() => new LinkRules().onBody(body(Kind.ACCEPT))).toThrow(ProtocolError);
    const l = new LinkRules();
    l.onBody(hello("Asha"));
    expect(() => l.onBody(hello("Mallory"))).toThrow(ProtocolError);
    const r = new LinkRules();
    r.onBody(hello("Asha"));
    expect(r.onBody(body(Kind.REJECT))).toEqual({ emit: "rejected" });
    expect(() => r.onBody(body(Kind.ACCEPT))).toThrow(ProtocolError);
  });
});
