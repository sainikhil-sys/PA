import "./random";
import * as SecureStore from "expo-secure-store";
import { fromHex, toHex } from "./bytes";
import { generateKeyPair, keyPairFromPrivate, type KeyPair } from "./noise";

/**
 * This phone's Connect identity: a long-term X25519 key pair made once and kept in SecureStore
 * (encrypted with an Android Keystore key). Peers recognise this phone by its public key, never by
 * a hardware identifier. Deleting the app or "Reset Connect identity" makes a new one.
 */
const KEY = "cowork.connect.identity";
const NAME = "cowork.connect.name";

let cached: KeyPair | null = null;
let pending: Promise<KeyPair> | null = null;

/**
 * Single-flight: Connect, Calls, Walkie and Groups all ask for the identity at the same moment
 * when Connect opens. Before this, on a fresh install each caller found no stored key and made its
 * own, so the link and Calls/Walkie used different keys and every call invite and Walkie join was
 * rejected as "not from this person". Every caller now waits for the same load-or-create.
 */
export function loadIdentity(): Promise<KeyPair> {
  if (cached) return Promise.resolve(cached);
  pending ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) {
      cached = keyPairFromPrivate(fromHex(stored));
      return cached;
    }
    const kp = generateKeyPair();
    await SecureStore.setItemAsync(KEY, toHex(kp.privateKey));
    cached = kp;
    return kp;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function resetIdentity(): Promise<void> {
  cached = null;
  pending = null;
  await SecureStore.deleteItemAsync(KEY);
}

/** The name people nearby see. Only this is advertised; nothing else about you. */
export async function loadDisplayName(fallback: string): Promise<string> {
  return (await SecureStore.getItemAsync(NAME))?.trim() || fallback.trim() || "Cowork user";
}

export async function saveDisplayName(name: string): Promise<string> {
  const clean = name.trim().slice(0, 40) || "Cowork user";
  await SecureStore.setItemAsync(NAME, clean);
  return clean;
}

/** Short fingerprint of a public key, for display ("ab12 cd34"). */
export const fingerprint = (peerKey: string) => `${peerKey.slice(0, 4)} ${peerKey.slice(4, 8)}`;
