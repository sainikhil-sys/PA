import { ArrowLeftIcon } from "phosphor-react-native";
import * as React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { router } from "expo-router";
import { IconButton, Txt } from "@/components/ui";
import { color, radius, space } from "@/theme/tokens";

/** Header for settings sub-screens: back button, title and an optional action on the right. */
export function SubHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
      <IconButton icon={ArrowLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))} />
      <Txt variant="title" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
        {title}
      </Txt>
      {right}
    </View>
  );
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
