import { Image } from "expo-image";
import { CheckIcon, CircleHalfIcon, MoonIcon, SunIcon, TextAaIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Platform, Pressable, ScrollView, Switch, View } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { Row, Screen, Txt } from "@/components/ui";
import { APP_ICONS, APP_ICON_KEYS } from "@/features/appearance/icons";
import { ListSection, SubHeader } from "@/features/settings/parts";
import { feedback } from "@/lib/feedback";
import { useReduceMotion } from "@/theme/motion";
import { useThemePreference, type ThemePreference } from "@/theme/preference";
import { color, motion, radius, space, TOUCH } from "@/theme/tokens";
import AppIcon from "../../../modules/app-icon";

const OPTIONS: { value: ThemePreference; label: string; detail: string; icon: Icon }[] = [
  { value: "system", label: "System", detail: "Match this phone's light or dark setting", icon: CircleHalfIcon },
  { value: "light", label: "Light", detail: "Always light", icon: SunIcon },
  { value: "dark", label: "Dark", detail: "Always dark", icon: MoonIcon },
];

/** Appearance: theme, launcher icon, haptics and motion. Saved on this phone and applied right away. */
export default function AppearanceScreen() {
  const preference = useThemePreference((s) => s.preference);
  const setPreference = useThemePreference((s) => s.setPreference);
  const haptics = useThemePreference((s) => s.haptics);
  const setHaptics = useThemePreference((s) => s.setHaptics);
  const motionPref = useThemePreference((s) => s.motion);
  const setMotion = useThemePreference((s) => s.setMotion);

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
                    feedback.selection();
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

        <AppIconPicker />

        <ListSection title="Feel">
          <ToggleRow title="Haptics" detail="A light vibration when you tap buttons, and a stronger one for a wrong PIN." value={haptics} onChange={(v) => void setHaptics(v)} />
          <ToggleRow
            title="Reduce motion"
            detail="Keep movement to a minimum: no sliding, scaling or bouncing. Cowork also does this when your phone's animations are off."
            value={motionPref === "reduce"}
            onChange={(v) => void setMotion(v ? "reduce" : "system")}
          />
          <Row icon={TextAaIcon} title="Text size" detail="Cowork follows your phone's font size (Settings > Display > Font size), up to 160%." />
        </ListSection>
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
      <View style={{ flex: 1 }}>
        <Txt variant="label">{title}</Txt>
        <Txt variant="small">{detail}</Txt>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ true: color.accent, false: color.surface3 }} thumbColor={color.bg} ios_backgroundColor={color.surface3} />
    </View>
  );
}

/**
 * Four-column grid of real launcher icons. The selection shown is what Android reports after the
 * change, never just the tap: if the switch fails, the old icon stays selected and the reason shows.
 */
function AppIconPicker() {
  const [current, setCurrent] = React.useState<string | null>(() => AppIcon.current(APP_ICON_KEYS));
  const [note, setNote] = React.useState<{ text: string; error?: boolean } | null>(null);
  const supported = current !== null;

  const choose = (key: string) => {
    if (!supported || key === current) return;
    feedback.selection();
    try {
      const now = AppIcon.set(key, APP_ICON_KEYS);
      setCurrent(now);
      setNote(
        now === key
          ? { text: "Icon changed. Your home screen shows it within a few seconds. Some launchers close Cowork once while they update." }
          : { text: "Android didn't switch the icon. Try again.", error: true },
      );
    } catch {
      setCurrent(AppIcon.current(APP_ICON_KEYS));
      setNote({ text: "Android didn't switch the icon. Try again.", error: true });
    }
  };

  return (
    <ListSection title="App icon">
      <View style={{ padding: space.lg, gap: space.md }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="App icon" style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
          {APP_ICONS.map((icon) => (
            <IconTile key={icon.key} label={icon.label} preview={icon.preview} selected={icon.key === current} disabled={!supported} onPress={() => choose(icon.key)} />
          ))}
        </View>
        {!supported ? (
          <Txt variant="small">
            {Platform.OS === "android" ? "This build of Cowork can't change its icon. Update to the latest version to choose one." : "Changing the icon is available on Android for now."}
          </Txt>
        ) : note ? (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }} accessibilityLiveRegion="polite">
            {note.error ? null : <CheckIcon size={16} color={color.success} style={{ marginTop: 2 }} />}
            <Txt variant="small" style={{ flex: 1, color: note.error ? color.danger : color.muted }}>
              {note.text}
            </Txt>
          </View>
        ) : null}
      </View>
    </ListSection>
  );
}

function IconTile({ label, preview, selected, disabled, onPress }: { label: string; preview: number | object; selected: boolean; disabled: boolean; onPress: () => void }) {
  const reduce = useReduceMotion();
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: reduce ? 1 : withTiming(selected ? 1 : 0.92, { duration: motion.base }) }],
    opacity: withTiming(selected ? 1 : 0, { duration: reduce ? 0 : motion.fast }),
  }));
  const size = 60;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} icon`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: "25%", alignItems: "center", gap: space.xs, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}
    >
      <View style={{ width: size + 10, height: size + 10, alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: radius.card + 4, borderWidth: 2.5, borderColor: color.accent }, ring]} />
        <Image source={preview as number} style={{ width: size, height: size, borderRadius: radius.card - 2, borderWidth: 1, borderColor: color.border }} contentFit="cover" accessibilityIgnoresInvertColors />
        {selected ? (
          <View style={{ position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: color.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: color.surface }}>
            <CheckIcon size={12} color={color.onAccent} weight="bold" />
          </View>
        ) : null}
      </View>
      <Txt variant="small" style={{ color: selected ? color.text : color.muted }}>
        {label}
      </Txt>
    </Pressable>
  );
}
