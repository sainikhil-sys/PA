/**
 * One-shot hand-off from an in-app action to the chat screen (the Home orb, "Speak instead",
 * the first onboarding prompt). Kept in memory, never in the URL: a cowork:// link from outside
 * the app can only prefill the composer, never send a message or open the microphone.
 */
export type ChatIntent = { send?: string; listen?: boolean };

let pending: ChatIntent | null = null;

export function setChatIntent(intent: ChatIntent) {
  pending = intent;
}

/** Returns the pending intent once, then clears it. */
export function takeChatIntent(): ChatIntent | null {
  const i = pending;
  pending = null;
  return i;
}
