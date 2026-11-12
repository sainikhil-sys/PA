import { Bridge, type HotspotInfo } from "../../../modules/cowork-bridge";
import { isLanLink, MAX_LAN_DATA } from "../../../modules/cowork-bridge/protocol";
import { fromBase64, toBase64 } from "./bytes";
import type { LinkId, Transport, TransportEvent } from "./transport";

export type LanTransport = Transport & {
  /** Android: start a LocalOnlyHotspot plus the LAN server, for a QR code an iPhone can scan. */
  hostHotspot(displayName: string): Promise<HotspotInfo>;
  stopHotspot(): void;
  /** iPhone: join the hotspot from a scanned QR code (system prompt). Browse afterwards with start(). */
  joinHotspot(ssid: string, passphrase: string): Promise<void>;
  /** Connect straight to an address (from a QR code) when Bonjour/NSD cannot see the host. Resolves the link id. */
  connectAddress(host: string, port: number): Promise<LinkId>;
  canHostHotspot(): boolean;
  canJoinHotspot(): boolean;
};

/**
 * Phones on the same Wi-Fi, or an iPhone joined to an Android LocalOnlyHotspot: TCP framed as
 * [u32 length][bytes], found over Bonjour/NSD `_coworkconnect._tcp`. Link ids start with "lan:".
 * Moves opaque bytes; the Noise session above encrypts them.
 */
export function createLanTransport(): LanTransport {
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach((l) => l(e));
  let subs: { remove(): void }[] = [];

  const listen = () => {
    if (subs.length) return;
    subs = [
      Bridge.addListener("onLanFound", (e) => emit({ type: "found", link: e.linkId, name: e.name })),
      Bridge.addListener("onLanLost", (e) => emit({ type: "lost", link: e.linkId })),
      // No pre-shared digits on this transport: people compare the Noise safety code instead.
      Bridge.addListener("onLanRequest", (e) => emit({ type: "request", link: e.linkId, name: e.name, incoming: e.incoming, verifier: "" })),
      Bridge.addListener("onLanConnected", (e) => emit(e.ok ? { type: "connected", link: e.linkId } : { type: "failed", link: e.linkId, reason: e.status })),
      Bridge.addListener("onLanDisconnected", (e) => emit({ type: "disconnected", link: e.linkId })),
      Bridge.addListener("onLanPayload", (e) => {
        try {
          emit({ type: "data", link: e.linkId, bytes: fromBase64(e.data) });
        } catch {
          // Malformed payloads are dropped; the session layer treats silence as nothing received.
        }
      }),
    ].filter((s): s is NonNullable<typeof s> => s != null);
  };

  const own = (link: LinkId) => {
    if (!isLanLink(link)) throw new Error("Not a LAN link");
  };

  return {
    name: "LAN",
    maxBytes: MAX_LAN_DATA,
    available: () => Bridge.isAvailable(),
    async start(displayName) {
      listen();
      await Bridge.lanBrowseStart(displayName);
    },
    pause() {
      Bridge.lanBrowsePause();
    },
    stop() {
      Bridge.lanBrowseStop();
      Bridge.lanHostStop();
    },
    async connect(link) {
      own(link);
      await Bridge.lanConnect(link);
    },
    async accept(link) {
      own(link);
      await Bridge.lanAccept(link);
    },
    async reject(link) {
      own(link);
      await Bridge.lanReject(link);
    },
    async send(link, bytes) {
      own(link);
      if (bytes.length > MAX_LAN_DATA) throw new Error(`Message is larger than ${MAX_LAN_DATA} bytes`);
      await Bridge.lanSend(link, toBase64(bytes));
    },
    disconnect(link) {
      if (isLanLink(link)) Bridge.lanDisconnect(link);
    },
    subscribe(listener) {
      listen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async hostHotspot(displayName) {
      listen();
      return Bridge.lanHostStart(displayName);
    },
    stopHotspot() {
      Bridge.lanHostStop();
    },
    joinHotspot: (ssid, passphrase) => Bridge.joinHotspot(ssid, passphrase),
    async connectAddress(host, port) {
      listen();
      return Bridge.lanConnectAddress(host, port);
    },
    canHostHotspot: () => Bridge.canHostHotspot(),
    canJoinHotspot: () => Bridge.canJoinHotspot(),
  };
}
