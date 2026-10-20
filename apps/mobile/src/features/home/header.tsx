import { router } from "expo-router";
import { ArrowLeftIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { IconButton, Txt } from "@/components/ui";
import { space } from "@/theme/tokens";

/** Header for a pushed screen: back button, title, and an optional trailing action. */
export function BackHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
      <IconButton icon={ArrowLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <Txt variant="title" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Txt>
      {action}
    </View>
  );
}
