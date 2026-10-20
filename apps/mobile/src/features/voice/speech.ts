import * as Speech from "expo-speech";
import * as React from "react";
import { toPlainText } from "@/features/chat/markdown";
import { deviceLanguage } from "./use-voice";

/** Reads answers aloud with expo-speech, and stops when asked or when the screen closes. */
export function useSpeaker() {
  const [speaking, setSpeaking] = React.useState(false);
  /** Bumped per utterance, so a stopped one's late callback can't clear the next one's state. */
  const turn = React.useRef(0);

  React.useEffect(
    () => () => {
      void Speech.stop();
    },
    [],
  );

  const speak = React.useCallback((markdown: string) => {
    const text = toPlainText(markdown);
    if (!text) return;
    void Speech.stop();
    const mine = ++turn.current;
    setSpeaking(true);
    const end = () => {
      if (turn.current === mine) setSpeaking(false);
    };
    Speech.speak(text, { language: deviceLanguage(), onDone: end, onStopped: end, onError: end });
  }, []);

  const stop = React.useCallback(() => {
    turn.current++;
    void Speech.stop();
    setSpeaking(false);
  }, []);

  return { speaking, speak, stop };
}
