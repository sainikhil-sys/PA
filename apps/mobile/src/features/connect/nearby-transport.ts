import { Nearby } from "../../../modules/cowork-connect";
import { fromBase64, toBase64 } from "./bytes";
import type { Transport, TransportEvent } from "./transport";

/** Android to Android over Google Nearby Connections (Bluetooth, BLE and Wi-Fi, fully offline). */
export function createNearbyTransport(): Transport {
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach((l) => l(e));
  let subs: { remove(): void }[] = [];

  const listen = () => {
    if (subs.length) return;
    subs = [
      Nearby.addListener("onEndpointFound", (e) => emit({ type: "found", link: e.endpointId, name: e.name })),
      Nearby.addListener("onEndpointLost", (e) => emit({ type: "lost", link: e.endpointId })),
      Nearby.addListener("onConnectionInitiated", (e) => emit({ type: "request", link: e.endpointId, name: e.name, incoming: e.incoming, verifier: e.authDigits })),
      Nearby.addListener("onConnectionResult", (e) => emit(e.ok ? { type: "connected", link: e.endpointId } : { type: "failed", link: e.endpointId, reason: e.status })),
      Nearby.addListener("onDisconnected", (e) => emit({ type: "disconnected", link: e.endpointId })),
      Nearby.addListener("onPayload", (e) => {
        try {
          emit({ type: "data", link: e.endpointId, bytes: fromBase64(e.data) });
        } catch {
          // Malformed payloads are dropped; the session layer treats silence as nothing received.
        }
      }),
    ].filter((s): s is NonNullable<typeof s> => s != null);
  };

  return {
    name: "Nearby",
    maxBytes: 32 * 1024,
    available: () => Nearby.isAvailable(),
    async start(displayName) {
      listen();
      await Nearby.startAdvertising(displayName);
      await Nearby.startDiscovery();
    },
    pause() {
      Nearby.stopAdvertising();
      Nearby.stopDiscovery();
    },
    stop() {
      Nearby.stopAll();
    },
    connect: (link, displayName) => Nearby.requestConnection(displayName, link),
    accept: (link) => Nearby.acceptConnection(link),
    reject: (link) => Nearby.rejectConnection(link),
    send: (link, bytes) => Nearby.sendBytes(link, toBase64(bytes)),
    disconnect: (link) => Nearby.disconnect(link),
    subscribe(listener) {
      listen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
