import { router, type Href } from "expo-router";
import { ArrowLeftIcon } from "phosphor-react-native";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { IconButton, Txt } from "@/components/ui";
import { color, space, TOUCH } from "@/theme/tokens";

/**
 * Header for a pushed screen: a white bar with back on the left, the title centred, an optional
 * trailing action, and a hairline underneath. Back falls back to Home when there's nothing behind.
 */
export function BackHeader({ title, action, fallback = "/" }: { title: string; action?: React.ReactNode; fallback?: Href }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: TOUCH + space.lg,
        paddingHorizontal: space.sm,
        backgroundColor: color.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: color.border,
      }}
    >
      <IconButton icon={ArrowLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))} />
      <Txt variant="heading" accessibilityRole="header" numberOfLines={1} style={{ flex: 1, textAlign: "center" }}>
        {title}
      </Txt>
      {/* Same width as the back button, so the title stays centred with or without an action. */}
      <View style={{ minWidth: TOUCH, alignItems: "flex-end" }}>{action}</View>
    </View>
  );
}
