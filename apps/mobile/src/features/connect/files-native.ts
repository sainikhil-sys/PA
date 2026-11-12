import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { Platform } from "react-native";

/**
 * Narrow typed access to the file functions of the CoworkConnect native module (NATIVE_CONTRACT.md,
 * "Files (C2)"). Read through requireOptionalNativeModule so this file works whether or not the
 * module's index.ts already re-exports them, and so builds without the module (iOS, web, Expo Go)
 * report "not available" instead of crashing. Native never chooses keys: JavaScript passes them in.
 */
export type TransferUpdate = {
  endpointId: string;
  payloadId: string;
  incoming: boolean;
  bytesTransferred: number;
  totalBytes: number;
  status: "in_progress" | "success" | "failure" | "canceled";
};
export type FileReceived = { endpointId: string; payloadId: string; path: string };

type FileEvents = {
  onTransferUpdate: (e: TransferUpdate) => void;
  onFileReceived: (e: FileReceived) => void;
};

type NativeFileApi = {
  sha256File(uri: string): Promise<string>;
  sendFile(endpointId: string, uri: string, keyB64: string): Promise<string>;
  cancelPayload(payloadId: string): void;
  decryptFile(path: string, keyB64: string, fileName: string): Promise<{ uri: string; size: number; sha256: string }>;
  deleteFile(uri: string): void;
  addListener<E extends keyof FileEvents>(event: E, listener: FileEvents[E]): EventSubscription;
};

const native: Partial<NativeFileApi> | null = Platform.OS === "android" ? requireOptionalNativeModule<Partial<NativeFileApi>>("CoworkConnect") : null;

function req<K extends keyof NativeFileApi>(name: K): NativeFileApi[K] {
  const fn = native?.[name];
  if (typeof fn !== "function") throw new Error("File sharing is not available in this build");
  return (fn as (...a: unknown[]) => unknown).bind(native) as NativeFileApi[K];
}

export const ConnectFiles = {
  /** True only when this build has every file function the contract names. */
  isAvailable: () =>
    native != null && (["sha256File", "sendFile", "cancelPayload", "decryptFile", "deleteFile", "addListener"] as const).every((k) => typeof native[k] === "function"),
  sha256File: (uri: string) => req("sha256File")(uri),
  sendFile: (endpointId: string, uri: string, keyB64: string) => req("sendFile")(endpointId, uri, keyB64),
  cancelPayload: (payloadId: string) => {
    try {
      req("cancelPayload")(payloadId);
    } catch {
      // Nothing to cancel in a build without the module.
    }
  },
  decryptFile: (path: string, keyB64: string, fileName: string) => req("decryptFile")(path, keyB64, fileName),
  deleteFile: (uri: string) => {
    try {
      req("deleteFile")(uri);
    } catch {
      // Already gone, or not a Connect file.
    }
  },
  addListener<E extends keyof FileEvents>(event: E, listener: FileEvents[E]): EventSubscription | null {
    if (typeof native?.addListener !== "function") return null;
    return native.addListener(event, listener);
  },
};
