import * as React from "react";
import { View } from "react-native";
import { Orb } from "@/components/orb";
import { Button, Txt } from "@/components/ui";
import { color, radius, space } from "@/theme/tokens";
import type { VoiceState } from "./use-voice";

/**
 * Compact listening panel above the composer: the orb, the live transcript, and Stop and Cancel.
 * Stop keeps what was heard and puts it in the composer for review; Cancel discards it.
 */
export function VoiceOverlay({ state, transcript, onStop, onCancel }: { state: VoiceState; transcript: string; onStop: () => void; onCancel: () => void }) {
  if (state === "idle") return null;
  const listening = state === "listening";
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.sm,
        padding: space.md,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: color.border,
        backgroundColor: color.surface,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Orb size={56} state={listening ? "listening" : "thinking"} onPress={listening ? onStop : undefined} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="caption">{listening ? "Listening" : "Starting the microphone"}</Txt>
          <Txt variant={transcript ? "body" : "bodyMuted"} numberOfLines={4}>
            {transcript || "Say what you need. You can edit it before sending."}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Stop" variant="secondary" onPress={onStop} disabled={!listening} style={{ flex: 1 }} accessibilityLabel="Stop listening and review the text" />
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} accessibilityLabel="Cancel and discard what was heard" />
      </View>
    </View>
  );
}
