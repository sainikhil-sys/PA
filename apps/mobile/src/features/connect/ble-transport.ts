import { Bridge } from "../../../modules/cowork-bridge";
import { isBleLink, MAX_BLE_DATA } from "../../../modules/cowork-bridge/protocol";
import { fromBase64, toBase64 } from "./bytes";
import type { LinkId, Transport, TransportEvent } from "./transport";

/**
 * Bluetooth LE text fallback between any two phones (Android and iPhone): a GATT service
 * 6f3d0001-7c5e-4a8b-9a0e-6c6f776f726b, messages up to 4 KB chunked natively. Link ids start with
 * "ble:". Slow, so only for text; files and audio need Nearby or LAN. Moves opaque bytes; the Noise
 * session above encrypts them.
 */
export function createBleTransport(): Transport {
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach((l) => l(e));
  let subs: { remove(): void }[] = [];

  const listen = () => {
    if (subs.length) return;
    subs = [
      Bridge.addListener("onBleFound", (e) => emit({ type: "found", link: e.linkId, name: e.name })),
      Bridge.addListener("onBleLost", (e) => emit({ type: "lost", link: e.linkId })),
      // No pre-shared digits on this transport: people compare the Noise safety code instead.
      Bridge.addListener("onBleRequest", (e) => emit({ type: "request", link: e.linkId, name: e.name, incoming: e.incoming, verifier: "" })),
      Bridge.addListener("onBleConnected", (e) => emit(e.ok ? { type: "connected", link: e.linkId } : { type: "failed", link: e.linkId, reason: e.status })),
      Bridge.addListener("onBleDisconnected", (e) => emit({ type: "disconnected", link: e.linkId })),
      Bridge.addListener("onBlePayload", (e) => {
        try {
          emit({ type: "data", link: e.linkId, bytes: fromBase64(e.data) });
        } catch {
          // Malformed payloads are dropped; the session layer treats silence as nothing received.
        }
      }),
    ].filter((s): s is NonNullable<typeof s> => s != null);
  };

  const own = (link: LinkId) => {
    if (!isBleLink(link)) throw new Error("Not a Bluetooth LE link");
  };

  return {
    name: "Bluetooth LE",
    maxBytes: MAX_BLE_DATA,
    available: () => Bridge.isAvailable(),
    async start(displayName) {
      listen();
      await Bridge.bleStart(displayName);
    },
    pause() {
      Bridge.blePause();
    },
    stop() {
      Bridge.bleStop();
    },
    async connect(link) {
      own(link);
      await Bridge.bleConnect(link);
    },
    async accept(link) {
      own(link);
      await Bridge.bleAccept(link);
    },
    async reject(link) {
      own(link);
      await Bridge.bleReject(link);
    },
    async send(link, bytes) {
      own(link);
      if (bytes.length > MAX_BLE_DATA) throw new Error(`Message is larger than ${MAX_BLE_DATA} bytes`);
      await Bridge.bleSend(link, toBase64(bytes));
    },
    disconnect(link) {
      if (isBleLink(link)) Bridge.bleDisconnect(link);
    },
    subscribe(listener) {
      listen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
