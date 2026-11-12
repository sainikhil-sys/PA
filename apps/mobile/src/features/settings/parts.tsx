import * as React from "react";
import { RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { color, radius, space } from "@/theme/tokens";

/** Header for settings sub-screens: the shared white header; back falls back to Profile. */
export function SubHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return <BackHeader title={title} action={right} fallback="/settings" />;
}

/** A bordered group of rows separated by hairlines. */
export function Group({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, overflow: "hidden" }, style]}>
      {items.map((child, i) => (
        <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: color.border } : undefined}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", then a short date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/**
 * Pull-to-refresh in the house colors. A plain function (not a component): Android's ScrollView clones
 * this element and wraps itself in it, which a wrapper component would swallow.
 */
export function refresh(refreshing: boolean, onRefresh: () => void) {
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} progressBackgroundColor={color.surface2} />;
}

/** A flat list section like the reference layout: a small grey heading, then rows split by hairlines. */
export function ListSection({ title, children }: { title?: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View>
      {title ? (
        <Txt variant="small" accessibilityRole="header" style={{ paddingHorizontal: space.lg, marginBottom: space.xs, color: color.muted }}>
          {title}
        </Txt>
      ) : null}
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color.border, marginLeft: space.lg + 36, marginRight: space.lg }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}
