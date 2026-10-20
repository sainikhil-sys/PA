import * as React from "react";
import { KeyboardAvoidingView, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius, space } from "@/theme/tokens";
import { Button, Txt } from "./ui";

/** Bottom sheet on a dimmed backdrop. Tapping outside or the back button closes it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: color.overlay }} onPress={onClose} />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: color.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderWidth: 1,
            borderColor: color.border,
            paddingHorizontal: space.xl,
            paddingTop: space.md,
            paddingBottom: Math.max(insets.bottom, space.lg) + space.sm,
            gap: space.lg,
          }}
        >
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: color.borderStrong }} />
          {title ? (
            <Txt variant="title" accessibilityRole="header">
              {title}
            </Txt>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Confirmation before anything consequential (approving an agent proposal, deleting, signing out).
 * The confirm button names the action, so the user knows exactly what happens.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <Txt variant="bodyMuted">{body}</Txt>
      <View style={{ gap: space.sm }}>
        <Button label={confirmLabel} variant={destructive ? "danger" : "primary"} loading={busy} onPress={onConfirm} />
        <Button label="Cancel" variant="ghost" onPress={onClose} disabled={busy} />
      </View>
    </Sheet>
  );
}
