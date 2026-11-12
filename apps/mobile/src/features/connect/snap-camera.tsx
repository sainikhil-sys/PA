import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraMode, type CameraType } from "expo-camera";
import { CameraRotateIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { Linking, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, IconButton, Txt } from "@/components/ui";
import { color, radius, space, TOUCH } from "@/theme/tokens";
import type { Picked } from "./files-pick";
import { connectAccent } from "./theme";

const MAX_VIDEO_SECONDS = 60;

/** Full-screen camera for SnapShare: one photo, or a video up to a minute. Nothing is saved to the gallery. */
export function SnapCamera(props: { open: boolean; onCaptured: (p: Picked) => void; onClose: () => void }) {
  // Mounted only while open, so every visit starts fresh.
  return props.open ? <CameraScreen {...props} /> : null;
}

function CameraScreen({ open, onCaptured, onClose }: { open: boolean; onCaptured: (p: Picked) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const ref = React.useRef<CameraView>(null);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [mode, setMode] = React.useState<CameraMode>("picture");
  const [facing, setFacing] = React.useState<CameraType>("back");
  const [ready, setReady] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && cam && !cam.granted && cam.canAskAgain) void requestCam();
  }, [open, cam, requestCam]);

  const shoot = async () => {
    if (!ref.current || !ready || busy) return;
    setError(null);
    if (mode === "picture") {
      setBusy(true);
      try {
        const pic = await ref.current.takePictureAsync({ quality: 0.85 });
        if (pic?.uri) onCaptured({ uri: pic.uri, name: `photo-${Date.now()}.jpg`, size: null, mime: "image/jpeg" });
      } catch {
        setError("Could not take the photo. Try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (recording) {
      ref.current.stopRecording();
      return;
    }
    if (!mic?.granted) {
      const r = await requestMic();
      if (!r.granted) return setError("Videos need the microphone permission. You can still take photos.");
    }
    setRecording(true);
    try {
      const vid = await ref.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
      if (vid?.uri) onCaptured({ uri: vid.uri, name: `video-${Date.now()}.mp4`, size: null, mime: "video/mp4" });
    } catch {
      setError("Could not record the video. Try again.");
    } finally {
      setRecording(false);
    }
  };

  const body = !cam ? (
    <Txt variant="bodyMuted" style={{ textAlign: "center" }}>
      Checking camera permission
    </Txt>
  ) : !cam.granted ? (
    <View style={{ gap: space.md, alignItems: "center", paddingHorizontal: space.xl }}>
      <Txt variant="heading" style={{ textAlign: "center" }}>
        Camera permission needed
      </Txt>
      <Txt variant="small" style={{ textAlign: "center" }}>
        SnapShare uses the camera only while this screen is open. Photos go straight to the people you pick, not to your gallery.
      </Txt>
      {cam.canAskAgain ? <Button label="Allow camera" variant="primary" onPress={() => void requestCam()} /> : <Button label="Open Android settings" onPress={() => void Linking.openSettings()} />}
    </View>
  ) : (
    <CameraView ref={ref} style={{ flex: 1 }} facing={facing} mode={mode} onCameraReady={() => setReady(true)} onMountError={() => setError("The camera could not start.")} />
  );

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: insets.top, paddingBottom: insets.bottom + space.md }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", padding: space.sm }}>
          <IconButton icon={XIcon} label="Close camera" tone="plain" onPress={onClose} />
          {cam?.granted ? <IconButton icon={CameraRotateIcon} label={facing === "back" ? "Switch to front camera" : "Switch to back camera"} tone="plain" disabled={recording} onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))} /> : null}
        </View>
        <View style={{ flex: 1, justifyContent: "center" }}>{body}</View>
        {error ? (
          <Txt variant="small" style={{ color: color.danger, textAlign: "center", padding: space.sm }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}
        {cam?.granted ? (
          <View style={{ alignItems: "center", gap: space.md, paddingTop: space.md }}>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {(["picture", "video"] as const).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === m, disabled: recording }}
                  accessibilityLabel={m === "picture" ? "Photo mode" : "Video mode"}
                  disabled={recording}
                  onPress={() => {
                    setReady(false);
                    setMode(m);
                  }}
                  style={{ minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.control, justifyContent: "center", backgroundColor: mode === m ? color.surface3 : "transparent" }}
                >
                  <Txt variant="label" style={{ color: mode === m ? color.text : color.muted }}>
                    {m === "picture" ? "Photo" : "Video"}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === "picture" ? "Take photo" : recording ? "Stop recording" : "Start recording"}
              disabled={!ready || busy}
              onPress={() => void shoot()}
              style={({ pressed }) => ({
                width: 72,
                height: 72,
                borderRadius: radius.card,
                borderWidth: 4,
                borderColor: color.text,
                alignItems: "center",
                justifyContent: "center",
                opacity: !ready || busy ? 0.5 : pressed ? 0.8 : 1,
              })}
            >
              <View style={{ width: recording ? 28 : 52, height: recording ? 28 : 52, borderRadius: recording ? 6 : radius.control, backgroundColor: recording ? connectAccent.live : color.text }} />
            </Pressable>
            <Txt variant="small">{mode === "video" ? (recording ? "Recording. Tap to stop." : `Videos stop at ${MAX_VIDEO_SECONDS} seconds.`) : " "}</Txt>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
