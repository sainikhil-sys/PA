import { fromBase64, toBase64 } from "./bytes";

/**
 * Audio key handling shared by Walkie and calls. Pure: no React Native, so it is unit tested.
 *
 * Every audio session gets a fresh random 32-byte send key. It goes to the other people only inside
 * the Noise-encrypted session (walkie.key, call.invite, call.key) and to native as base64. Native
 * seals each frame with it and a counter nonce, so a key must never outlive its audio session:
 * restarting native audio restarts the counter, which is why `newSendKey` runs on every start.
 * Keys are never logged or stored.
 */
export const AUDIO_KEY_BYTES = 32;

/** A new send key from the platform's secure random source. */
export function newSendKey(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(AUDIO_KEY_BYTES);
  if (bytes.length !== AUDIO_KEY_BYTES) throw new Error("Random source returned the wrong length");
  const key = toBase64(bytes);
  bytes.fill(0);
  return key;
}

/** A peer's key from an untrusted message: canonical base64 of exactly 32 bytes, or null. */
export function parseAudioKey(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 64) return null;
  try {
    const bytes = fromBase64(v);
    if (bytes.length !== AUDIO_KEY_BYTES) return null;
    // An all-zero key is what a broken random source produces; refuse it.
    if (bytes.every((b) => b === 0)) return null;
    const canonical = toBase64(bytes);
    bytes.fill(0);
    return canonical;
  } catch {
    return null;
  }
}

export type KeyUpdate = "new" | "same" | "changed";

/**
 * Who has my current send key, and whose keys I hold, for one audio session.
 * A peer may send a new key when it restarts its audio; the caller then replaces the native track.
 */
export class KeyRing {
  private sentTo = new Set<string>();
  private recv = new Map<string, string>();

  constructor(private sendKey: string) {}

  get mine(): string {
    return this.sendKey;
  }

  needsSend(peer: string): boolean {
    return !this.sentTo.has(peer);
  }

  markSent(peer: string) {
    this.sentTo.add(peer);
  }

  /** Records a validated key from a peer. */
  setReceived(peer: string, key: string): KeyUpdate {
    const before = this.recv.get(peer);
    this.recv.set(peer, key);
    if (before === undefined) return "new";
    return before === key ? "same" : "changed";
  }

  received(peer: string): string | undefined {
    return this.recv.get(peer);
  }

  peersWithKeys(): string[] {
    return [...this.recv.keys()];
  }

  /** Forgets a peer entirely (they left or disconnected). If they come back, keys are exchanged again. */
  remove(peer: string) {
    this.sentTo.delete(peer);
    this.recv.delete(peer);
  }

  /** New audio session: a new send key that nobody has yet. Received keys are kept. */
  rotate(sendKey: string) {
    this.sendKey = sendKey;
    this.sentTo.clear();
  }

  clear() {
    this.sentTo.clear();
    this.recv.clear();
    this.sendKey = "";
  }
}
