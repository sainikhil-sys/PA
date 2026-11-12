import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBleTransport } from "../../src/features/connect/ble-transport";
import { createLanTransport } from "../../src/features/connect/lan-transport";
import type { TransportEvent } from "../../src/features/connect/transport";

// vi.mock is hoisted above the imports, so the transports load against the fake.
// The native module is replaced by a fake that records calls and lets tests fire events.
const fake = vi.hoisted(() => {
  const handlers = new Map<string, (e: unknown) => void>();
  const calls: [string, ...unknown[]][] = [];
  const call =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve(result);
    };
  const Bridge = {
    isAvailable: () => true,
    canHostHotspot: () => true,
    canJoinHotspot: () => false,
    lanHostStart: call("lanHostStart", { ssid: "DIRECT-x", passphrase: "pw", port: 4242, host: null }),
    lanHostStop: (...a: unknown[]) => void calls.push(["lanHostStop", ...a]),
    lanBrowseStart: call("lanBrowseStart"),
    lanBrowseStop: (...a: unknown[]) => void calls.push(["lanBrowseStop", ...a]),
    lanConnect: call("lanConnect"),
    lanConnectAddress: call("lanConnectAddress", "lan:addr:192.168.49.1:4242"),
    lanAccept: call("lanAccept"),
    lanReject: call("lanReject"),
    lanSend: call("lanSend"),
    lanDisconnect: (...a: unknown[]) => void calls.push(["lanDisconnect", ...a]),
    joinHotspot: call("joinHotspot"),
    bleStart: call("bleStart"),
    bleStop: (...a: unknown[]) => void calls.push(["bleStop", ...a]),
    bleConnect: call("bleConnect"),
    bleAccept: call("bleAccept"),
    bleReject: call("bleReject"),
    bleSend: call("bleSend"),
    bleDisconnect: (...a: unknown[]) => void calls.push(["bleDisconnect", ...a]),
    addListener: (event: string, fn: (e: unknown) => void) => {
      handlers.set(event, fn);
      return { remove: () => handlers.delete(event) };
    },
  };
  return { Bridge, handlers, calls, fire: (event: string, e: unknown) => handlers.get(event)?.(e) };
});

vi.mock("../../modules/cowork-bridge", () => ({ Bridge: fake.Bridge }));

beforeEach(() => {
  fake.handlers.clear();
  fake.calls.length = 0;
});

describe.each([
  ["Lan", createLanTransport, "lan:svc", 64 * 1024 - 1],
  ["Ble", createBleTransport, "ble:AA:BB", 4 * 1024],
] as const)("%s transport", (prefix, create, link, maxBytes) => {
  it("maps native events to transport events", () => {
    const t = create();
    const seen: TransportEvent[] = [];
    t.subscribe((e) => seen.push(e));
    fake.fire(`on${prefix}Found`, { linkId: link, name: "Asha" });
    fake.fire(`on${prefix}Request`, { linkId: link, name: "Asha", incoming: true });
    fake.fire(`on${prefix}Connected`, { linkId: link, ok: false, status: "REJECTED" });
    fake.fire(`on${prefix}Connected`, { linkId: link, ok: true, status: "OK" });
    fake.fire(`on${prefix}Payload`, { linkId: link, data: "AQID" });
    fake.fire(`on${prefix}Payload`, { linkId: link, data: "not base64!" });
    fake.fire(`on${prefix}Disconnected`, { linkId: link });
    fake.fire(`on${prefix}Lost`, { linkId: link });
    expect(seen).toEqual([
      { type: "found", link, name: "Asha" },
      { type: "request", link, name: "Asha", incoming: true, verifier: "" },
      { type: "failed", link, reason: "REJECTED" },
      { type: "connected", link },
      { type: "data", link, bytes: Uint8Array.of(1, 2, 3) },
      { type: "disconnected", link },
      { type: "lost", link },
    ]);
  });

  it("sends base64, enforces its size limit and refuses other transports' links", async () => {
    const t = create();
    expect(t.maxBytes).toBe(maxBytes);
    await t.send(link, Uint8Array.of(1, 2, 3));
    expect(fake.calls.at(-1)).toEqual([`${prefix.toLowerCase()}Send`, link, "AQID"]);
    await expect(t.send(link, new Uint8Array(maxBytes + 1))).rejects.toThrow();
    await expect(t.connect("nearby-endpoint", "Me")).rejects.toThrow();
    t.disconnect("nearby-endpoint");
    expect(fake.calls.some(([n]) => n.endsWith("Disconnect"))).toBe(false);
  });
});

describe("LAN extras", () => {
  it("starts by browsing and stops hotspot and browsing together", async () => {
    const t = createLanTransport();
    await t.start("Asha");
    expect(fake.calls).toContainEqual(["lanBrowseStart", "Asha"]);
    const info = await t.hostHotspot("Asha");
    expect(info.port).toBe(4242);
    t.stop();
    expect(fake.calls.map(([n]) => n)).toEqual(expect.arrayContaining(["lanBrowseStop", "lanHostStop"]));
  });
});
