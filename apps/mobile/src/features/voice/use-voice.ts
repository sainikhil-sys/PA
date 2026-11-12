import { getLocales } from "expo-localization";
import type { ExpoSpeechRecognitionErrorCode } from "expo-speech-recognition";
import * as React from "react";
import { recognition, useRecognitionEvent } from "./recognition";

export type VoiceState = "idle" | "starting" | "listening";

/** The device language for recognition and speech, e.g. "en-US". */
export function deviceLanguage(): string {
  try {
    return getLocales()[0]?.languageTag || "en-US";
  } catch {
    return "en-US";
  }
}

const ERRORS: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
  "no-speech": "I didn't catch anything. Tap the mic and try again.",
  "speech-timeout": "I didn't catch anything. Tap the mic and try again.",
  network: "Speech recognition needs a connection right now. Check your network or type instead.",
  "not-allowed": "Microphone access is off. Allow it in system settings, or type your message.",
  "service-not-allowed": "Speech recognition isn't available on this device. You can type instead.",
  "language-not-supported": "Speech recognition doesn't support your device language yet. You can type instead.",
  "audio-capture": "The microphone couldn't be used. Another app may be using it.",
  busy: "Speech recognition is busy. Wait a moment and try again.",
  interrupted: "Listening was interrupted. Tap the mic to try again.",
};

/**
 * One-shot speech recognition (expo-speech-recognition). Listens for a single utterance, shows the
 * live transcript, then hands the final text to `onFinal` for review. It never listens continuously.
 */
export function useVoice({ onFinal }: { onFinal: (text: string) => void }) {
  const [state, setState] = React.useState<VoiceState>("idle");
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [denied, setDenied] = React.useState(false);
  /** True only while this hook owns a recognition session. */
  const active = React.useRef(false);
  const cancelled = React.useRef(false);
  const latest = React.useRef("");
  const onFinalRef = React.useRef(onFinal);
  // Always call the latest handler, without restarting listeners when it changes.
  React.useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useRecognitionEvent("start", () => {
    if (active.current) setState("listening");
  });
  useRecognitionEvent("result", (e) => {
    if (!active.current) return;
    const t = e.results[0]?.transcript ?? "";
    latest.current = t;
    setTranscript(t);
  });
  useRecognitionEvent("error", (e) => {
    if (!active.current || e.error === "aborted") return;
    if (e.error === "not-allowed") setDenied(true);
    setError(ERRORS[e.error] ?? "Speech recognition stopped unexpectedly. Try again or type instead.");
  });
  useRecognitionEvent("end", () => {
    if (!active.current) return;
    active.current = false;
    setState("idle");
    const text = latest.current.trim();
    if (!cancelled.current && text) onFinalRef.current(text);
  });

  React.useEffect(
    () => () => {
      if (active.current) {
        active.current = false;
        try {
          recognition()?.abort();
        } catch {}
      }
    },
    [],
  );

  const start = React.useCallback(async () => {
    if (active.current) return;
    setError(null);
    setTranscript("");
    latest.current = "";
    cancelled.current = false;
    const mod = recognition();
    if (!mod) {
      setState("idle");
      setError("Voice input isn't available in this version of Cowork. You can type instead.");
      return;
    }
    setState("starting");
    try {
      const perm = await mod.requestPermissionsAsync();
      if (cancelled.current) {
        setState("idle");
        return;
      }
      if (!perm.granted) {
        setDenied(true);
        setState("idle");
        setError(ERRORS["not-allowed"]!);
        return;
      }
      setDenied(false);
      if (!mod.isRecognitionAvailable()) {
        setState("idle");
        setError(ERRORS["service-not-allowed"]!);
        return;
      }
      active.current = true;
      mod.start({ lang: deviceLanguage(), interimResults: true, continuous: false });
    } catch {
      active.current = false;
      setState("idle");
      setError(ERRORS["service-not-allowed"]!);
    }
  }, []);

  /** Finish listening and keep what was heard. */
  const stop = React.useCallback(() => {
    try {
      recognition()?.stop();
    } catch {
      active.current = false;
      setState("idle");
    }
  }, []);

  /** Stop listening and discard the transcript. */
  const cancel = React.useCallback(() => {
    cancelled.current = true;
    setTranscript("");
    if (!active.current) {
      setState("idle");
      return;
    }
    try {
      recognition()?.abort();
    } catch {
      active.current = false;
      setState("idle");
    }
  }, []);

  const clearError = React.useCallback(() => setError(null), []);

  return { state, transcript, error, denied, start, stop, cancel, clearError };
}
