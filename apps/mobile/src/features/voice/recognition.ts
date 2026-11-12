import { requireOptionalNativeModule } from "expo";
import * as React from "react";
// Type-only: erased at build time, so it never loads the package.
import type { ExpoSpeechRecognitionNativeEventMap as Events } from "expo-speech-recognition";

/**
 * Safe access to expo-speech-recognition. The package throws as soon as it is imported when its
 * native module is missing (Expo Go, or a build made before the module was added), and because
 * Expo Router loads every screen at start-up, one direct import took the whole app down. Here the
 * package is loaded only after checking the native module exists; without it, voice input is
 * simply unavailable and every caller gets null.
 */
type SpeechPackage = typeof import("expo-speech-recognition");
export type RecognitionModule = SpeechPackage["ExpoSpeechRecognitionModule"];

let cached: SpeechPackage | null | undefined;

function load(): SpeechPackage | null {
  if (cached !== undefined) return cached;
  if (!requireOptionalNativeModule("ExpoSpeechRecognition")) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-speech-recognition") as SpeechPackage;
  } catch {
    cached = null;
  }
  return cached;
}

/** The recognition module, or null when this build doesn't include it. */
export function recognition(): RecognitionModule | null {
  return load()?.ExpoSpeechRecognitionModule ?? null;
}

/** Same as the package's useSpeechRecognitionEvent, but a no-op when the module is missing. */
export function useRecognitionEvent<K extends keyof Events>(event: K, handler: (e: Events[K]) => void) {
  const ref = React.useRef(handler);
  React.useEffect(() => {
    ref.current = handler;
  }, [handler]);
  React.useEffect(() => {
    const mod = recognition();
    if (!mod) return;
    const sub = mod.addListener(event, ((e: Events[K]) => ref.current(e)) as never);
    return () => sub.remove();
  }, [event]);
}
