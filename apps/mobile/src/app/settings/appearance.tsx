import * as Haptics from "expo-haptics";
import { CheckIcon, CircleHalfIcon, DeviceMobileIcon, MoonIcon, SunIcon, TextAaIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Row, Screen, Txt } from "@/components/ui";
import { ListSection, SubHeader } from "@/features/settings/parts";
import { useThemePreference, type ThemePreference } from "@/theme/preference";
import { color, space, TOUCH } from "@/theme/tokens";

const OPTIONS: { value: ThemePreference; label: string; detail: string; icon: Icon }[] = [
  { value: "system", label: "System", detail: "Match this phone's light or dark setting", icon: CircleHalfIcon },
  { value: "light", label: "Light", detail: "Always light", icon: SunIcon },
  { value: "dark", label: "Dark", detail: "Always dark", icon: MoonIcon },
];

/** Appearance: system, light or dark, saved on this phone and applied right away. */
export default function AppearanceScreen() {
  const preference = useThemePreference((s) => s.preference);
  const setPreference = useThemePreference((s) => s.setPreference);

  return (
    <Screen>
      <SubHeader title="Appearance" />
      <ScrollView contentContainerStyle={{ paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.xxl }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Theme">
          <ListSection title="Theme">
            {OPTIONS.map((o) => {
              const selected = o.value === preference;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${o.label}. ${o.detail}`}
                  onPress={() => {
                    if (selected) return;
                    void Haptics.selectionAsync().catch(() => {});
                    // Applying a new theme redraws the app (see app/_layout.tsx).
                    void setPreference(o.value);
                  }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH + space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? color.surface2 : "transparent" })}
                >
                  <o.icon size={22} color={color.text} />
                  <View style={{ flex: 1, paddingVertical: space.sm }}>
                    <Txt variant="label">{o.label}</Txt>
                    <Txt variant="small">{o.detail}</Txt>
                  </View>
                  {selected ? <CheckIcon size={20} color={color.accentText} weight="bold" /> : null}
                </Pressable>
              );
            })}
          </ListSection>
        </View>
        <ListSection title="Follows your phone">
          <Row icon={TextAaIcon} title="Text size" detail="Cowork uses your phone's font size (Settings > Display)." />
          <Row icon={DeviceMobileIcon} title="Reduce motion" detail="When your phone's animation setting is off or reduced, Cowork stops moving things too." />
        </ListSection>
      </ScrollView>
    </Screen>
  );
}
