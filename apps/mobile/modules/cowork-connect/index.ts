import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { Platform } from "react-native";

/** Status of a FILE transfer, in either direction. */
export type TransferStatus = "in_progress" | "success" | "failure" | "canceled";

export type TransferUpdateEvent = {
  endpointId: string;
  /** Nearby payload id as a decimal string (64-bit, so not a JS number). */
  payloadId: string;
  incoming: boolean;
  bytesTransferred: number;
  totalBytes: number;
  status: TransferStatus;
};

export type FileReceivedEvent = {
  endpointId: string;
  payloadId: string;
  /** Encrypted copy in app cache (cache/connect/incoming/<payloadId>.enc). Pass it to decryptFile. */
  path: string;
};

export type DecryptedFile = {
  /** file:// uri inside app storage (files/connect/<safe name>). */
  uri: string;
  size: number;
  /** Hex SHA-256 of the plaintext; compare it with the sender's offer before showing the file. */
  sha256: string;
};

export type AudioMode = "walkie" | "call";

export type AudioStartOptions = {
  /** Base64 32-byte key this phone seals its frames with. Never reuse it for another sender or file. */
  sendKey: string;
  peers: { endpointId: string; recvKey: string }[];
  mode: AudioMode;
};

export type AudioLevelEvent = {
  /** "self" for the microphone. */
  endpointId: string;
  /** 0..1 */
  level: number;
};

export type AudioStateEvent = { state: "idle" | "active" | "error"; message?: string };

export type ServiceOptions = { kind: AudioMode; title: string; body: string };

export type IncomingCallOptions = { callId: string; name: string };

export type CallActionEvent = { callId: string; action: "accept" | "decline" };

export type NearbyEvents = {
  onEndpointFound: (e: { endpointId: string; name: string }) => void;
  onEndpointLost: (e: { endpointId: string }) => void;
  onConnectionInitiated: (e: { endpointId: string; name: string; incoming: boolean; authDigits: string }) => void;
  onConnectionResult: (e: { endpointId: string; ok: boolean; status: string }) => void;
  onDisconnected: (e: { endpointId: string }) => void;
  onPayload: (e: { endpointId: string; data: string }) => void;
  onTransferUpdate: (e: TransferUpdateEvent) => void;
  onFileReceived: (e: FileReceivedEvent) => void;
  onAudioLevel: (e: AudioLevelEvent) => void;
  onAudioState: (e: AudioStateEvent) => void;
  /** Android only (iOS has no offline incoming-call notification). */
  onCallAction: (e: CallActionEvent) => void;
};

type Native = {
  startAdvertising(name: string): Promise<void>;
  startDiscovery(): Promise<void>;
  stopAdvertising(): void;
  stopDiscovery(): void;
  stopAll(): void;
  requestConnection(name: string, endpointId: string): Promise<void>;
  acceptConnection(endpointId: string): Promise<void>;
  rejectConnection(endpointId: string): Promise<void>;
  sendBytes(endpointId: string, base64: string): Promise<void>;
  disconnect(endpointId: string): void;

  sha256File(uri: string): Promise<string>;
  sendFile(endpointId: string, uri: string, keyB64: string): Promise<string>;
  cancelPayload(payloadId: string): void;
  decryptFile(path: string, keyB64: string, fileName: string): Promise<DecryptedFile>;
  deleteFile(uri: string): boolean | void;

  audioStart(options: AudioStartOptions): Promise<void>;
  audioAddPeer(endpointId: string, recvKey: string): void;
  audioRemovePeer(endpointId: string): void;
  audioTransmit(on: boolean): Promise<boolean>;
  audioSetMuted(muted: boolean): void;
  audioSetSpeaker(on: boolean): void;
  audioStop(): void;

  startService(options: ServiceOptions): Promise<void>;
  stopService(): void;
  showIncomingCall(options: IncomingCallOptions): Promise<boolean>;
  clearIncomingCall(callId: string): void;

  addListener<E extends keyof NearbyEvents>(event: E, listener: NearbyEvents[E]): EventSubscription;
};

// Null on web and builds without the module (Expo Go). Android uses Nearby Connections; iOS uses the
// Network framework over peer-to-peer Wi-Fi (iPhone to iPhone only, and only while the app is open).
const native: Native | null =
  Platform.OS === "android" || Platform.OS === "ios" ? requireOptionalNativeModule<Native>("CoworkConnect") : null;

/**
 * Google Nearby Connections, offline, through Cowork's local Expo module. Moves opaque bytes only:
 * encryption and identity are handled above it (features/connect).
 */
export const Nearby = {
  isAvailable: () => native != null,
  startAdvertising: (name: string) => req().startAdvertising(name),
  startDiscovery: () => req().startDiscovery(),
  /** Stops being found. Connected endpoints stay connected. */
  stopAdvertising: () => native?.stopAdvertising(),
  /** Stops looking for others. Connected endpoints stay connected. */
  stopDiscovery: () => native?.stopDiscovery(),
  /** Stops advertising and discovery and disconnects every endpoint. */
  stopAll: () => native?.stopAll(),
  requestConnection: (name: string, endpointId: string) => req().requestConnection(name, endpointId),
  acceptConnection: (endpointId: string) => req().acceptConnection(endpointId),
  rejectConnection: (endpointId: string) => req().rejectConnection(endpointId),
  sendBytes: (endpointId: string, base64: string) => req().sendBytes(endpointId, base64),
  disconnect: (endpointId: string) => native?.disconnect(endpointId),

  // Files (C2). Keys are base64 32-byte keys made in JS and shared inside the Noise session.
  /** Streamed SHA-256 (hex) of a file:// or content:// file. */
  sha256File: (uri: string) => req().sha256File(uri),
  /** Encrypts the file in 64 KiB sealed chunks and sends it. Resolves with the payload id. */
  sendFile: (endpointId: string, uri: string, keyB64: string) => req().sendFile(endpointId, uri, keyB64),
  /** Cancels a send or a receive. An onTransferUpdate with status "canceled" follows. */
  cancelPayload: (payloadId: string) => native?.cancelPayload(payloadId),
  /** Decrypts a received file into app storage and deletes the encrypted copy. Rejects ERR_CONNECT_DECRYPT on a failed tag. */
  decryptFile: (path: string, keyB64: string, fileName: string) => req().decryptFile(path, keyB64, fileName),
  /** Deletes a file inside Connect's own folders only; anything else throws. */
  deleteFile: (uri: string): void => {
    req().deleteFile(uri);
  },

  // Audio (C3 Walkie, C4 calls). The microphone stays off until audioTransmit(true).
  audioStart: (options: AudioStartOptions) => req().audioStart(options),
  /** Ignored when audio is not active. */
  audioAddPeer: (endpointId: string, recvKey: string) => req().audioAddPeer(endpointId, recvKey),
  audioRemovePeer: (endpointId: string) => native?.audioRemovePeer(endpointId),
  /** Resolves false when microphone permission is off (an onAudioState error follows). Rejects when audio is not active. */
  audioTransmit: (on: boolean) => req().audioTransmit(on),
  audioSetMuted: (muted: boolean) => native?.audioSetMuted(muted),
  audioSetSpeaker: (on: boolean) => native?.audioSetSpeaker(on),
  audioStop: () => native?.audioStop(),

  // Foreground service and incoming calls (Android; no-ops on iOS).
  /** Keeps Walkie or a call running with the screen off. Start it while the app is open. */
  startService: (options: ServiceOptions) => req().startService(options),
  stopService: () => native?.stopService(),
  /** Resolves false when the notification could not be shown: show the call in the app instead. */
  showIncomingCall: (options: IncomingCallOptions) => (native ? native.showIncomingCall(options) : Promise.resolve(false)),
  clearIncomingCall: (callId: string) => native?.clearIncomingCall(callId),

  addListener<E extends keyof NearbyEvents>(event: E, listener: NearbyEvents[E]): EventSubscription | null {
    return native?.addListener(event, listener) ?? null;
  },
};

function req(): Native {
  if (!native) throw new Error("Nearby is not available on this device");
  return native;
}
