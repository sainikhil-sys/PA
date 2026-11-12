import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { Platform } from "react-native";

export * from "./protocol";

/**
 * Events. Link ids are prefixed "lan:" or "ble:". `onLanConnected` / `onBleConnected` mirror Nearby's
 * onConnectionResult: `ok: false` means the other side rejected or the link failed before both
 * accepted (`status` says which, e.g. "REJECTED", "TIMEOUT", "CONNECTION_LOST", "PROTOCOL_ERROR").
 * `onLanDisconnected` / `onBleDisconnected` only follow a successful connection.
 */
export type BridgeEvents = {
  onLanFound: (e: { linkId: string; name: string }) => void;
  onLanLost: (e: { linkId: string }) => void;
  onLanRequest: (e: { linkId: string; name: string; incoming: boolean }) => void;
  onLanConnected: (e: { linkId: string; ok: boolean; status: string }) => void;
  onLanDisconnected: (e: { linkId: string }) => void;
  onLanPayload: (e: { linkId: string; data: string }) => void;
  /** Android: the system stopped the LocalOnlyHotspot (another app, tethering, Wi-Fi turned off). */
  onLanHostStopped: (e: { reason: string }) => void;
  onBleFound: (e: { linkId: string; name: string }) => void;
  onBleLost: (e: { linkId: string }) => void;
  onBleRequest: (e: { linkId: string; name: string; incoming: boolean }) => void;
  onBleConnected: (e: { linkId: string; ok: boolean; status: string }) => void;
  onBleDisconnected: (e: { linkId: string }) => void;
  onBlePayload: (e: { linkId: string; data: string }) => void;
};

export type HotspotInfo = {
  ssid: string;
  passphrase: string;
  port: number;
  /** Best-effort IPv4 address of the hotspot interface, for `lanConnectAddress` if Bonjour fails. */
  host: string | null;
};

type Native = {
  lanHostStart(name: string): Promise<HotspotInfo>;
  lanHostStop(): void;
  lanBrowseStart(name: string): Promise<void>;
  lanBrowseStop(): void;
  lanBrowsePause(): void;
  lanConnect(linkId: string): Promise<void>;
  lanConnectAddress(host: string, port: number): Promise<string>;
  lanAccept(linkId: string): Promise<void>;
  lanReject(linkId: string): Promise<void>;
  lanSend(linkId: string, base64: string): Promise<void>;
  lanDisconnect(linkId: string): void;
  /** iOS only. */
  joinHotspot?(ssid: string, passphrase: string): Promise<void>;
  bleStart(name: string): Promise<void>;
  bleStop(): void;
  blePause(): void;
  bleConnect(linkId: string): Promise<void>;
  bleAccept(linkId: string): Promise<void>;
  bleReject(linkId: string): Promise<void>;
  bleSend(linkId: string, base64: string): Promise<void>;
  bleDisconnect(linkId: string): void;
  addListener<E extends keyof BridgeEvents>(event: E, listener: BridgeEvents[E]): EventSubscription;
};

// Null on web and in builds without the module (Expo Go).
const native: Native | null = Platform.OS === "android" || Platform.OS === "ios" ? requireOptionalNativeModule<Native>("CoworkBridge") : null;

/**
 * Cross-platform transports for Cowork Connect (hotspot/LAN and Bluetooth LE). Moves opaque bytes only:
 * identity and encryption (Noise) live above it in features/connect.
 */
export const Bridge = {
  isAvailable: () => native != null,
  /** True where this platform can host a hotspot (Android) rather than join one (iOS). */
  canHostHotspot: () => native != null && Platform.OS === "android",
  canJoinHotspot: () => native?.joinHotspot != null && Platform.OS === "ios",

  lanHostStart: (name: string) => req().lanHostStart(name),
  lanHostStop: () => native?.lanHostStop(),
  lanBrowseStart: (name: string) => req().lanBrowseStart(name),
  lanBrowseStop: () => native?.lanBrowseStop(),
  /** Stops browsing and advertising on the network but keeps the server and every link (app in background). */
  lanBrowsePause: () => native?.lanBrowsePause(),
  lanConnect: (linkId: string) => req().lanConnect(linkId),
  lanConnectAddress: (host: string, port: number) => req().lanConnectAddress(host, port),
  lanAccept: (linkId: string) => req().lanAccept(linkId),
  lanReject: (linkId: string) => req().lanReject(linkId),
  lanSend: (linkId: string, base64: string) => req().lanSend(linkId, base64),
  lanDisconnect: (linkId: string) => native?.lanDisconnect(linkId),
  joinHotspot: (ssid: string, passphrase: string) => {
    const n = req();
    if (!n.joinHotspot) return Promise.reject(new Error("Joining a hotspot from the app is only supported on iPhone"));
    return n.joinHotspot(ssid, passphrase);
  },

  bleStart: (name: string) => req().bleStart(name),
  bleStop: () => native?.bleStop(),
  /** Stops scanning and advertising but keeps the GATT server and every link (app in background). */
  blePause: () => native?.blePause(),
  bleConnect: (linkId: string) => req().bleConnect(linkId),
  bleAccept: (linkId: string) => req().bleAccept(linkId),
  bleReject: (linkId: string) => req().bleReject(linkId),
  bleSend: (linkId: string, base64: string) => req().bleSend(linkId, base64),
  bleDisconnect: (linkId: string) => native?.bleDisconnect(linkId),

  addListener<E extends keyof BridgeEvents>(event: E, listener: BridgeEvents[E]): EventSubscription | null {
    return native?.addListener(event, listener) ?? null;
  },
};

function req(): Native {
  if (!native) throw new Error("Cowork Bridge is not available on this device");
  return native;
}
