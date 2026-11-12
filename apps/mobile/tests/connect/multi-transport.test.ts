import { describe, expect, it } from "vitest";
import { createMultiTransport, kindOfLink } from "../../src/features/connect/multi-transport";
import type { Transport, TransportEvent } from "../../src/features/connect/transport";

type Fake = Transport & { calls: string[]; fire: (e: TransportEvent) => void };

function fake(name: string, maxBytes: number, opts: { available?: boolean; startFails?: boolean } = {}): Fake {
  const listeners = new Set<(e: TransportEvent) => void>();
  const calls: string[] = [];
  const log = (c: string) => {
    calls.push(c);
  };
  return {
    name,
    maxBytes,
    calls,
    fire: (e) => listeners.forEach((l) => l(e)),
    available: () => opts.available ?? true,
    start: async () => {
      log("start");
      if (opts.startFails) throw new Error(`${name} failed`);
    },
    pause: () => log("pause"),
    stop: () => log("stop"),
    connect: async (link) => log(`connect ${link}`),
    accept: async (link) => log(`accept ${link}`),
    reject: async (link) => log(`reject ${link}`),
    send: async (link, bytes) => log(`send ${link} ${bytes.length}`),
    disconnect: (link) => log(`disconnect ${link}`),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function setup(opts: { lan?: Parameters<typeof fake>[2]; ble?: Parameters<typeof fake>[2]; nearby?: Parameters<typeof fake>[2] } = {}) {
  const nearby = fake("Nearby", 32 * 1024, opts.nearby);
  const lan = fake("LAN", 64 * 1024 - 1, opts.lan);
  const ble = fake("BLE", 4096, opts.ble);
  const multi = createMultiTransport({ nearby, lan, ble });
  const events: TransportEvent[] = [];
  multi.subscribe((e) => events.push(e));
  return { nearby, lan, ble, multi, events };
}

describe("multi transport", () => {
  it("routes by link prefix", async () => {
    const { nearby, lan, ble, multi } = setup();
    await multi.connect("lan:abc", "Me");
    await multi.accept("ble:c:AA");
    await multi.send("X1Y2", new Uint8Array(10));
    multi.disconnect("lan:abc");
    expect(lan.calls).toEqual(["connect lan:abc", "disconnect lan:abc"]);
    expect(ble.calls).toEqual(["accept ble:c:AA"]);
    expect(nearby.calls).toEqual(["send X1Y2 10"]);
    expect(kindOfLink("lan:in:3")).toBe("lan");
    expect(kindOfLink("ble:AA:BB")).toBe("ble");
    expect(kindOfLink("A1B2")).toBe("nearby");
  });

  it("enforces each link's size limit (Bluetooth LE 4 KB)", async () => {
    const { ble, multi } = setup();
    expect(multi.maxBytesFor("ble:x")).toBe(4096);
    expect(multi.maxBytesFor("abcd")).toBe(32 * 1024);
    await expect(multi.send("ble:x", new Uint8Array(5000))).rejects.toThrow("TOO_LARGE");
    await multi.send("ble:x", new Uint8Array(4096));
    expect(ble.calls).toEqual(["send ble:x 4096"]);
  });

  it("starts every available transport and succeeds if one does", async () => {
    const { nearby, lan, ble, multi } = setup({ nearby: { startFails: true }, ble: { available: false } });
    await multi.start("Me");
    expect(nearby.calls).toEqual(["start"]);
    expect(lan.calls).toEqual(["start"]);
    expect(ble.calls).toEqual([]);
  });

  it("fails with the first reason when nothing starts", async () => {
    const { multi } = setup({ nearby: { startFails: true }, lan: { startFails: true }, ble: { startFails: true } });
    await expect(multi.start("Me")).rejects.toThrow("Nearby failed");
  });

  it("pause keeps links: it never calls stop", () => {
    const { nearby, lan, ble, multi } = setup();
    multi.pause();
    for (const t of [nearby, lan, ble]) expect(t.calls).toEqual(["pause"]);
    multi.stop();
    for (const t of [nearby, lan, ble]) expect(t.calls).toEqual(["pause", "stop"]);
  });

  it("lists a phone found on several radios once, on the fastest", () => {
    const { nearby, ble, events } = setup();
    ble.fire({ type: "found", link: "ble:1", name: "Sam" });
    expect(events).toEqual([{ type: "found", link: "ble:1", name: "Sam" }]);
    nearby.fire({ type: "found", link: "N1", name: "Sam" });
    expect(events.slice(1)).toEqual([
      { type: "lost", link: "ble:1" },
      { type: "found", link: "N1", name: "Sam" },
    ]);
    nearby.fire({ type: "lost", link: "N1" });
    expect(events.slice(3)).toEqual([
      { type: "lost", link: "N1" },
      { type: "found", link: "ble:1", name: "Sam" },
    ]);
  });

  it("keeps two people with the same name on the same radio", () => {
    const { nearby, events } = setup();
    nearby.fire({ type: "found", link: "N1", name: "Sam" });
    nearby.fire({ type: "found", link: "N2", name: "Sam" });
    expect(events.filter((e) => e.type === "found")).toHaveLength(2);
  });

  it("passes link events through", () => {
    const { lan, events } = setup();
    lan.fire({ type: "data", link: "lan:1", bytes: new Uint8Array([1]) });
    lan.fire({ type: "disconnected", link: "lan:1" });
    expect(events.map((e) => e.type)).toEqual(["data", "disconnected"]);
  });
});
