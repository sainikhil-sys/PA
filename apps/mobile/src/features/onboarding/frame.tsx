import { ArrowLeftIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { IconButton, Screen, Txt } from "@/components/ui";
import { color, space } from "@/theme/tokens";

/**
 * Shared layout for the sign-in and setup screens: keyboard-safe scrolling content with a footer
 * pinned to the bottom (edge-to-edge, so both safe-area edges are padded).
 */
export function AuthFrame({ children, footer, onBack }: { children: React.ReactNode; footer?: React.ReactNode; onBack?: () => void }) {
  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {onBack ? (
          <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
            <IconButton icon={ArrowLeftIcon} label="Back" tone="plain" onPress={onBack} />
          </View>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.xl }}>
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm }}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Screen title with an optional supporting sentence. */
export function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      {body ? <Txt variant="bodyMuted">{body}</Txt> : null}
    </View>
  );
}

const STEPS = ["profile", "privacy", "permissions", "first-chat"] as const;

/** "Step 2 of 4" with a row of short bars. */
export function StepIndicator({ step }: { step: (typeof STEPS)[number] }) {
  const n = STEPS.indexOf(step) + 1;
  return (
    <View style={{ gap: space.sm }} accessible accessibilityLabel={`Step ${n} of ${STEPS.length}`}>
      <View style={{ flexDirection: "row", gap: space.xs }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < n ? color.orange : color.surface3 }} />
        ))}
      </View>
      <Txt variant="caption">
        Step {n} of {STEPS.length}
      </Txt>
    </View>
  );
}

/** An icon beside a short title and explanation, used for the privacy and permission lists. */
export function InfoItem({ icon: IconCmp, title, body, children }: { icon: Icon; title: string; body: string; children?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: color.surface2, borderWidth: 1, borderColor: color.border, alignItems: "center", justifyContent: "center" }}>
        <IconCmp size={20} color={color.warm} />
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Txt variant="label">{title}</Txt>
        <Txt variant="small">{body}</Txt>
        {children}
      </View>
    </View>
  );
}
