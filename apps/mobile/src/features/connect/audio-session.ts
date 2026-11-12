import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { newSendKey } from "./audio-keys";
import { ConnectAudio, type AudioMode, type AudioStateEvent } from "./audio-native";
import { linkForPeer, peerForLink, useConnect } from "./connect-store";

/**
 * The one native audio session, shared by Walkie and calls (only one runs at a time). It maps
 * people (public keys) to radio endpoints, which is what native audio works with.
 */
export type AudioOwner = "walkie" | "call";

let owner: AudioOwner | null = null;
let sendKey: string | null = null;
/** peerKey -> the endpoint and key native currently has for them. */
const added = new Map<string, { endpointId: string; recvKey: string }>();
let subscribed = false;
const stateListeners = new Set<(e: AudioStateEvent) => void>();

/** Live voice levels (0..1), keyed by peer key or "self". Separate store: it changes ten times a second. */
export const useAudioLevels = create<{ levels: Record<string, number> }>(() => ({ levels: {} }));

/** Levels at or above this count as speaking. */
export const SPEAKING_LEVEL = 0.08;

function listen() {
  if (subscribed) return;
  subscribed = true;
  ConnectAudio.addListener("onAudioLevel", (e) => {
    if (!owner || typeof e?.level !== "number" || typeof e.endpointId !== "string") return;
    const who = e.endpointId === "self" ? "self" : peerForLink(e.endpointId);
    if (!who) return;
    const level = Math.max(0, Math.min(1, e.level));
    useAudioLevels.setState((s) => (s.levels[who] === level ? s : { levels: { ...s.levels, [who]: level } }));
  });
  ConnectAudio.addListener("onAudioState", (e) => {
    if (!owner || !e || typeof e.state !== "string") return;
    stateListeners.forEach((l) => l({ state: e.state, message: typeof e.message === "string" ? e.message.slice(0, 200) : undefined }));
  });
}

export function audioOwner(): AudioOwner | null {
  return owner;
}

export function onAudioStateChange(l: (e: AudioStateEvent) => void): () => void {
  stateListeners.add(l);
  return () => stateListeners.delete(l);
}

/** Native audio runs only over Nearby links; LAN and Bluetooth LE links (prefixed) carry text only. */
export function endpointForPeer(peerKey: string): string | null {
  const live = linkForPeer(useConnect.getState(), peerKey);
  if (!live || /^(lan|ble):/.test(live.link)) return null;
  return live.link;
}

/**
 * Starts native audio for `who` with a fresh send key and returns that key (to send to others).
 * Throws "AUDIO_BUSY" if the other feature holds the session.
 */
export async function startAudio(who: AudioOwner, mode: AudioMode): Promise<string> {
  if (owner && owner !== who) throw new Error("AUDIO_BUSY");
  if (owner === who && sendKey) return sendKey;
  listen();
  const key = newSendKey((n) => Crypto.getRandomBytes(n));
  owner = who;
  added.clear();
  try {
    await ConnectAudio.start({ sendKey: key, peers: [], mode });
  } catch (err) {
    owner = null;
    throw err;
  }
  sendKey = key;
  return key;
}

/**
 * Gives native the key for a person's voice (and starts sending to them). False when they are not
 * on a Nearby link right now. Replacing a key replaces their native track.
 */
export async function setPeerKey(who: AudioOwner, peerKey: string, recvKey: string): Promise<boolean> {
  if (owner !== who) return false;
  const endpointId = endpointForPeer(peerKey);
  if (!endpointId) return false;
  const have = added.get(peerKey);
  if (have && have.endpointId === endpointId && have.recvKey === recvKey) return true;
  try {
    if (have) await ConnectAudio.removePeer(have.endpointId);
    await ConnectAudio.addPeer(endpointId, recvKey);
    added.set(peerKey, { endpointId, recvKey });
    return true;
  } catch {
    added.delete(peerKey);
    return false;
  }
}

export function hasPeer(peerKey: string): boolean {
  return added.has(peerKey);
}

export async function dropPeer(who: AudioOwner, peerKey: string) {
  if (owner !== who) return;
  const have = added.get(peerKey);
  added.delete(peerKey);
  useAudioLevels.setState((s) => {
    if (!(peerKey in s.levels)) return s;
    const levels = { ...s.levels };
    delete levels[peerKey];
    return { levels };
  });
  if (have) await ConnectAudio.removePeer(have.endpointId).catch(() => {});
}

export async function transmit(who: AudioOwner, on: boolean) {
  if (owner !== who) return;
  await ConnectAudio.transmit(on);
  if (!on) useAudioLevels.setState((s) => ({ levels: { ...s.levels, self: 0 } }));
}

export async function setMuted(who: AudioOwner, muted: boolean) {
  if (owner !== who) return;
  await ConnectAudio.setMuted(muted);
}

export async function setSpeaker(who: AudioOwner, on: boolean) {
  if (owner !== who) return;
  await ConnectAudio.setSpeaker(on);
}

/** Ends the session: mic off, tracks released, key forgotten. */
export async function stopAudio(who: AudioOwner) {
  if (owner !== who) return;
  owner = null;
  sendKey = null;
  added.clear();
  useAudioLevels.setState({ levels: {} });
  await ConnectAudio.stop().catch(() => {});
}
