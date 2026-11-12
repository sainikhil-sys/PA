import { WarningCircleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { color, elevation, font, radius, space, TOUCH, type } from "@/theme/tokens";
import { feedback } from "@/lib/feedback";

/** Full-screen container on the near-black background. */
export function Screen({ children, edges = ["top"], style }: { children: React.ReactNode; edges?: Edge[]; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: color.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

type Variant = keyof typeof type;
export function Txt({ variant = "body", style, ...rest }: TextProps & { variant?: Variant; style?: StyleProp<TextStyle> }) {
  return <Text {...rest} style={[type[variant], style]} maxFontSizeMultiplier={1.6} />;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** Rounded-rectangle button (never a pill). One primary per screen. */
export function Button({
  label,
  onPress,
  variant = "secondary",
  icon: IconCmp,
  loading,
  disabled,
  compact,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: Icon;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const off = disabled || loading;
  const fg = variant === "primary" ? color.onAccent : variant === "danger" ? color.danger : color.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      onPress={() => {
        feedback.selection();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.button,
        compact && { minHeight: TOUCH, paddingHorizontal: space.md },
        variant === "primary" && { backgroundColor: color.accent, borderColor: color.accent },
        variant === "secondary" && { backgroundColor: color.surface2, borderColor: color.borderStrong },
        variant === "ghost" && { backgroundColor: "transparent", borderColor: "transparent" },
        variant === "danger" && { backgroundColor: color.surface2, borderColor: color.borderStrong },
        pressed && { opacity: 0.8 },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : IconCmp ? <IconCmp size={18} color={fg} weight={variant === "primary" ? "bold" : "regular"} /> : null}
      <Text style={[type.label, { color: fg, fontFamily: font.semibold }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Square icon-only button with an accessible label (48dp target). */
export function IconButton({ icon: IconCmp, label, onPress, tone = "default", size = TOUCH, disabled }: { icon: Icon; label: string; onPress?: () => void; tone?: "default" | "accent" | "plain"; size?: number; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={size < TOUCH ? (TOUCH - size) / 2 : 0}
      onPress={onPress}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
        tone === "default" && { backgroundColor: color.surface2, borderWidth: 1, borderColor: color.border },
        tone === "accent" && { backgroundColor: color.accent },
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <IconCmp size={20} color={tone === "accent" ? color.onAccent : color.text} weight={tone === "accent" ? "bold" : "regular"} />
    </Pressable>
  );
}

export function Input({ label, error, style, ref, ...rest }: TextInputProps & { label?: string; error?: string | null; ref?: React.Ref<React.ComponentRef<typeof TextInput>> }) {
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={color.subtle}
        selectionColor={color.accentText}
        cursorColor={color.accentText}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        {...rest}
        style={[styles.input, error ? { borderColor: color.danger } : null, style]}
      />
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.card, pressed && { backgroundColor: color.surface2 }, style]}>
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, minHeight: 32 }}>
      <Txt variant="caption" accessibilityRole="header">
        {title}
      </Txt>
      {action}
    </View>
  );
}

/** Small count badge (a rounded square, like the web's nav badge). */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 6, backgroundColor: color.accent, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.onAccent }}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export function EmptyState({ icon: IconCmp, title, body, action }: { icon: Icon; title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxxl, paddingHorizontal: space.xl, gap: space.sm }}>
      <IconCmp size={28} color={color.subtle} />
      <Txt variant="heading" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      <Txt variant="small" style={{ textAlign: "center", maxWidth: 300 }}>
        {body}
      </Txt>
      {action ? <View style={{ marginTop: space.md }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxl, gap: space.sm }} accessibilityLiveRegion="polite">
      <WarningCircleIcon size={26} color={color.danger} />
      <Txt variant="small" style={{ textAlign: "center", maxWidth: 300 }}>
        {message}
      </Txt>
      {onRetry ? <Button label="Try again" compact onPress={onRetry} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

/** Placeholder rows while data loads. */
export function Skeleton({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: space.sm }} accessibilityLabel="Loading" accessible>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ height, borderRadius: radius.control, backgroundColor: color.surface2, opacity: 1 - i * 0.18 }} />
      ))}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: color.border }, style]} />;
}

/** A tappable settings-style row. */
export function Row({ icon: IconCmp, title, detail, onPress, right, danger }: { icon?: Icon; title: string; detail?: string | null; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingHorizontal: space.lg }}>
      {IconCmp ? <IconCmp size={20} color={danger ? color.danger : color.muted} /> : null}
      <View style={{ flex: 1, paddingVertical: space.sm }}>
        <Txt variant="label" style={danger ? { color: color.danger } : undefined}>
          {title}
        </Txt>
        {detail ? (
          <Txt variant="small" numberOfLines={2}>
            {detail}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => (pressed ? { backgroundColor: color.surface2 } : undefined)}>
      {content}
    </Pressable>
  );
}

export function PressableScale(props: PressableProps & { children: React.ReactNode }) {
  return <Pressable {...props} style={(s) => [typeof props.style === "function" ? props.style(s) : props.style, s.pressed && { opacity: 0.85 }]} />;
}

// Colour-bearing styles are getters, so they always use the active palette (theme/tokens.ts).
const styles = {
  button: {
    minHeight: TOUCH,
    paddingHorizontal: space.xl,
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  } as ViewStyle,
  get input(): TextStyle {
    return {
      minHeight: TOUCH + 4,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: color.borderStrong,
      backgroundColor: color.surface,
      color: color.text,
      paddingHorizontal: space.lg,
      fontFamily: font.regular,
      fontSize: 16,
    };
  },
  get card(): ViewStyle {
    return {
      backgroundColor: color.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: color.border,
      padding: space.lg,
      ...elevation.card,
    };
  },
};
