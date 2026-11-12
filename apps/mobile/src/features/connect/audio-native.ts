import { PermissionsAndroid, Platform, type Permission } from "react-native";
import { Nearby, type AudioMode, type AudioStateEvent, type CallActionEvent } from "../../../modules/cowork-connect";

export type { AudioMode, AudioStateEvent, CallActionEvent };

/**
 * The audio, foreground service and incoming call parts of the native CoworkConnect module
 * (docs/connect/NATIVE_CONTRACT.md, "Audio" and "Foreground service"), as Walkie and calls use them.
 * Android only for now: that is where the foreground service, the incoming call notification and
 * the microphone permission flow below exist.
 */
const android = Platform.OS === "android";

export const ConnectAudio = {
  /** True when this phone and build can run Walkie and calls. */
  isAvailable: () => android && Nearby.isAvailable(),
  start: async (opts: { sendKey: string; peers: { endpointId: string; recvKey: string }[]; mode: AudioMode }) => {
    if (!ConnectAudio.isAvailable()) throw new Error("AUDIO_UNAVAILABLE");
    await Nearby.audioStart(opts);
  },
  addPeer: async (endpointId: string, recvKey: string) => {
    Nearby.audioAddPeer(endpointId, recvKey);
  },
  removePeer: async (endpointId: string) => {
    Nearby.audioRemovePeer(endpointId);
  },
  /** Native resolves false when the microphone permission is off. */
  transmit: async (on: boolean) => {
    const ok = await Nearby.audioTransmit(on);
    if (on && ok === false) throw new Error("RECORD_AUDIO permission is off");
  },
  setMuted: async (muted: boolean) => {
    Nearby.audioSetMuted(muted);
  },
  setSpeaker: async (on: boolean) => {
    Nearby.audioSetSpeaker(on);
  },
  stop: async () => {
    Nearby.audioStop();
  },
  startService: async (opts: { kind: AudioMode; title: string; body: string }) => {
    if (android) await Nearby.startService(opts);
  },
  stopService: async () => {
    Nearby.stopService();
  },
  /** False when the notification could not be shown (the caller then shows the call in the app). */
  showIncomingCall: async (opts: { callId: string; name: string }): Promise<boolean> => (android ? Nearby.showIncomingCall(opts) : false),
  clearIncomingCall: async (callId: string) => {
    Nearby.clearIncomingCall(callId);
  },
  addListener: Nearby.addListener,
};

export type MicResult = { ok: true } | { ok: false; blocked: boolean };

/** Asks for the microphone only when someone joins a channel or a call. */
export async function requestMicrophone(): Promise<MicResult> {
  if (Platform.OS !== "android") return { ok: false, blocked: false };
  const p = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(p)) return { ok: true };
  const r = await PermissionsAndroid.request(p);
  if (r === PermissionsAndroid.RESULTS.GRANTED) return { ok: true };
  return { ok: false, blocked: r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN };
}

/**
 * Android 13 and later hide the ongoing and incoming call notifications without this. Optional:
 * audio still works if it is refused.
 */
export async function requestNotificationsQuietly(): Promise<void> {
  if (Platform.OS !== "android") return;
  const api = typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (api < 33) return;
  const p = "android.permission.POST_NOTIFICATIONS" as Permission;
  try {
    if (!(await PermissionsAndroid.check(p))) await PermissionsAndroid.request(p);
  } catch {
    // Not fatal: only the notification is affected.
  }
}

/** Plain-language text for a native audio failure. Never includes key material. */
export function audioErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/AUDIO_UNAVAILABLE/.test(msg)) return "Voice is not available in this version of the app. Update Cowork and try again.";
  if (/PERMISSION|RECORD_AUDIO/i.test(msg)) return "Cowork needs the microphone permission for voice.";
  if (/BUSY|IN_USE/i.test(msg)) return "The microphone is in use by another app. Close it and try again.";
  return "Voice could not start on this phone. Try again.";
}
