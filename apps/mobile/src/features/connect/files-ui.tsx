import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import { EyeIcon, FileTextIcon, FilmStripIcon, ImageIcon, PauseIcon, PlayIcon, StopIcon, TrashIcon, WaveformIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, IconButton, Txt } from "@/components/ui";
import { color, radius, space, TOUCH } from "@/theme/tokens";
import type { TransferRow } from "./files-db";
import { formatBytes, formatDuration, MAX_VOICE_MS, mediaClass, percent, typeLabel } from "./files-logic";
import { useFiles } from "./files";
import { connectAccent } from "./theme";

const thumbUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

function TypeIcon({ t, size = 24 }: { t: Pick<TransferRow, "mime" | "kind">; size?: number }) {
  const c = t.kind === "voice" ? "audio" : mediaClass(t.mime);
  if (c === "image") return <ImageIcon size={size} color={color.muted} />;
  if (c === "video") return <FilmStripIcon size={size} color={color.muted} />;
  if (c === "audio") return <WaveformIcon size={size} color={color.muted} />;
  return <FileTextIcon size={size} color={color.muted} />;
}

export function statusText(t: TransferRow, progress?: number): string {
  const pct = percent(progress ?? t.bytesDone, t.size);
  switch (t.status) {
    case "offered":
      return `Waiting for ${t.peerName} to accept`;
    case "incoming":
      return `${t.peerName} wants to send you this`;
    case "accepted":
      return "Accepted. Waiting for the file";
    case "sending":
      return `Sending, ${pct}%`;
    case "receiving":
      return `Receiving, ${pct}%`;
    case "sent":
      return t.disappearing ? "Sent. It opens once on their phone" : "Sent";
    case "received":
      return t.disappearing ? "Opens once. It is deleted after you close it" : "Received and checked";
    case "viewed":
      return t.outgoing ? "Opened" : "Opened and deleted from this phone";
    case "declined":
      return t.outgoing ? `${t.peerName} declined` : "Declined";
    case "canceled":
      return t.error ?? "Canceled";
    case "expired":
      return "Expired before it was accepted";
    case "failed":
      return t.error ?? "Did not go through";
  }
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: value }}
      style={{ height: 4, borderRadius: 2, backgroundColor: color.surface3, overflow: "hidden" }}
    >
      <View style={{ width: `${value}%`, height: 4, backgroundColor: connectAccent.main }} />
    </View>
  );
}

function Preview({ t, size = 56 }: { t: TransferRow; size?: number }) {
  if (t.thumb) {
    return <Image source={{ uri: thumbUri(t.thumb) }} style={{ width: size, height: size, borderRadius: radius.control - 4 }} contentFit="cover" accessibilityIgnoresInvertColors />;
  }
  if (t.uri && !t.outgoing && !t.disappearing && mediaClass(t.mime) === "image" && t.status === "received") {
    return <Image source={{ uri: t.uri }} style={{ width: size, height: size, borderRadius: radius.control - 4 }} contentFit="cover" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius.control - 4, backgroundColor: color.surface3, alignItems: "center", justifyContent: "center" }}>
      <TypeIcon t={t} />
    </View>
  );
}

/** Inline player for a voice message or audio file on this phone. */
export function VoicePlayer({ uri, durationMs }: { uri: string; durationMs: number | null }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const total = status.duration > 0 ? status.duration * 1000 : (durationMs ?? 0);
  const at = status.currentTime * 1000;
  React.useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <IconButton
        icon={status.playing ? PauseIcon : PlayIcon}
        label={status.playing ? "Pause voice message" : "Play voice message"}
        onPress={() => (status.playing ? player.pause() : player.play())}
      />
      <View style={{ flex: 1, gap: space.xs }}>
        <ProgressBar value={total ? Math.min(100, Math.round((at / total) * 100)) : 0} />
        <Txt variant="small">
          {status.playing || at > 0 ? `${formatDuration(at)} of ${formatDuration(total)}` : formatDuration(total)}
        </Txt>
      </View>
    </View>
  );
}

function VideoBody({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" />;
}

/** Full-screen view of a received photo or video. View-once files are deleted when this closes. */
export function MediaViewer({ t, onClose }: { t: TransferRow | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const markViewed = useFiles((s) => s.markViewed);
  const close = () => {
    if (t && !t.outgoing && t.disappearing) void markViewed(t.id);
    onClose();
  };
  const c = t ? mediaClass(t.mime) : "document";
  return (
    <Modal visible={Boolean(t?.uri)} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm }}>
          <IconButton icon={XIcon} label={t?.disappearing && !t.outgoing ? "Close and delete" : "Close"} tone="plain" onPress={close} />
          <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {t?.name}
          </Txt>
        </View>
        {t?.disappearing && !t.outgoing ? (
          <Txt variant="small" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            This is deleted from your phone when you close it. A screenshot or another camera can still keep a copy.
          </Txt>
        ) : null}
        <View style={{ flex: 1 }}>
          {t?.uri ? c === "video" ? <VideoBody uri={t.uri} /> : <Image source={{ uri: t.uri }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={t.name} /> : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * One transfer: preview, name, size and type, live status, and the actions that fit its state
 * (accept or decline an incoming file, cancel, send again, open).
 */
export function FileBubble({ t, onOpen, wide }: { t: TransferRow; onOpen?: (t: TransferRow) => void; wide?: boolean }) {
  // Subscribe to this transfer's progress only, so one moving file does not redraw every bubble.
  const live = useFiles((x) => x.progress[t.id]);
  const s = useFiles.getState();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const mine = t.outgoing === 1;
  const c = mediaClass(t.mime);
  const moving = t.status === "sending" || t.status === "receiving";
  const canRetry = mine && Boolean(t.uri) && ["failed", "declined", "canceled", "expired"].includes(t.status);
  const failed = t.status === "failed" || (t.status === "declined" && mine);
  const label = `${typeLabel(t.mime, t.kind)}, ${t.name}, ${formatBytes(t.size)}. ${statusText(t, live)}`;

  const open = async () => {
    if (!t.uri) return;
    if (c === "image" || c === "video") return onOpen?.(t);
    try {
      await Sharing.shareAsync(t.uri, { mimeType: t.mime, dialogTitle: t.name });
    } catch {
      setNote("No app on this phone could open it.");
    }
  };

  return (
    <View
      style={{
        alignSelf: wide ? "stretch" : mine ? "flex-end" : "flex-start",
        maxWidth: wide ? undefined : "86%",
        minWidth: wide ? undefined : 240,
        marginVertical: space.xs,
        backgroundColor: mine ? color.surface3 : color.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: t.status === "incoming" ? connectAccent.main : color.border,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View accessible accessibilityLabel={label} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
        {t.kind === "voice" ? null : <Preview t={t} />}
        <View style={{ flex: 1 }}>
          {t.kind === "voice" ? (
            <Txt variant="label">Voice message{t.durationMs ? `, ${formatDuration(t.durationMs)}` : ""}</Txt>
          ) : (
            <Txt variant="label" numberOfLines={2}>
              {t.disappearing && !mine && t.status !== "viewed" ? `${typeLabel(t.mime, t.kind)}, opens once` : t.name}
            </Txt>
          )}
          <Txt variant="small">
            {typeLabel(t.mime, t.kind)} · {formatBytes(t.size)}
          </Txt>
          <Txt variant="small" style={failed ? { color: color.danger } : t.status === "incoming" ? { color: color.text } : undefined} accessibilityLiveRegion="polite">
            {statusText(t, live)}
          </Txt>
        </View>
      </View>

      {moving ? <ProgressBar value={percent(live ?? t.bytesDone, t.size)} /> : null}

      {t.kind === "voice" && t.uri && (mine || t.status === "received") ? <VoicePlayer uri={t.uri} durationMs={t.durationMs} /> : null}

      {t.status === "incoming" ? (
        <>
          <Txt variant="small">Only accept files you expected from someone you know.</Txt>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label="Accept"
              variant="primary"
              compact
              loading={busy}
              style={{ flex: 1 }}
              accessibilityLabel={`Accept ${typeLabel(t.mime, t.kind)} from ${t.peerName}`}
              onPress={async () => {
                setBusy(true);
                await s.accept(t.id);
                setBusy(false);
              }}
            />
            <Button label="Decline" compact style={{ flex: 1 }} accessibilityLabel={`Decline ${typeLabel(t.mime, t.kind)} from ${t.peerName}`} onPress={() => void s.decline(t.id)} />
          </View>
        </>
      ) : null}

      {["offered", "accepted", "sending", "receiving"].includes(t.status) ? <Button label="Cancel" compact icon={XIcon} onPress={() => void s.cancel(t.id)} style={{ alignSelf: "flex-start" }} /> : null}

      {canRetry ? (
        <Button
          label="Send again"
          compact
          loading={busy}
          style={{ alignSelf: "flex-start" }}
          onPress={async () => {
            setBusy(true);
            setNote(null);
            const r = await s.retry(t.id);
            setBusy(false);
            if (r.failed.length) setNote(r.failed[0]!.reason);
          }}
        />
      ) : null}

      {!mine && t.status === "received" && t.kind !== "voice" ? (
        <Button
          label={t.disappearing ? "View once" : c === "image" || c === "video" ? "View" : "Open"}
          compact
          icon={EyeIcon}
          style={{ alignSelf: "flex-start" }}
          onPress={() => void open()}
        />
      ) : null}

      {note ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Records a voice message with expo-audio. Tap the microphone to start; while recording, Send or
 * Discard. Recording stops on its own at five minutes.
 */
export function VoiceRecorder({ onDone, onClose }: { onDone: (r: { uri: string; durationMs: number }) => void; onClose: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);
  const stopped = React.useRef(false);

  const finish = React.useCallback(
    async (send: boolean) => {
      if (stopped.current) return;
      stopped.current = true;
      const durationMs = recorder.getStatus().durationMillis;
      try {
        await recorder.stop();
      } catch {
        // Already stopped.
      }
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (send && recorder.uri && durationMs >= 500) onDone({ uri: recorder.uri, durationMs });
      onClose();
    },
    [recorder, onDone, onClose],
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setError(perm.canAskAgain ? "Cowork needs the microphone to record a voice message." : "Microphone permission is off. Turn it on for Cowork in Android settings.");
          setStarting(false);
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setStarting(false);
      } catch {
        setError("Could not start recording.");
        setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      if (!stopped.current) {
        stopped.current = true;
        void recorder.stop().catch(() => {});
      }
    };
    // Start once when shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (state.durationMillis >= MAX_VOICE_MS) void finish(true);
  }, [state.durationMillis, finish]);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: color.border }}>
      <IconButton icon={TrashIcon} label="Discard recording" onPress={() => void finish(false)} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH }} accessibilityLiveRegion="polite">
        {error ? (
          <Txt variant="small" style={{ color: color.danger, flex: 1 }}>
            {error}
          </Txt>
        ) : (
          <>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: state.isRecording ? connectAccent.live : color.subtle }} />
            <Txt variant="label">{starting ? "Starting the microphone" : `Recording ${formatDuration(state.durationMillis)}`}</Txt>
          </>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop and send voice message"
        disabled={Boolean(error) || starting}
        onPress={() => void finish(true)}
        style={({ pressed }) => ({
          width: TOUCH,
          height: TOUCH,
          borderRadius: radius.control,
          backgroundColor: connectAccent.main,
          alignItems: "center",
          justifyContent: "center",
          opacity: error || starting ? 0.4 : pressed ? 0.8 : 1,
        })}
      >
        <StopIcon size={20} color={connectAccent.onMain} weight="fill" />
      </Pressable>
    </View>
  );
}
