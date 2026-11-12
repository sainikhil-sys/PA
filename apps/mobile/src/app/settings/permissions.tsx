import * as Notifications from "expo-notifications";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { BellIcon, CheckCircleIcon, DeviceMobileIcon, GearSixIcon, MicrophoneIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { AppState, Linking, Pressable, ScrollView, View } from "react-native";
import { Row, Screen, Skeleton, Txt } from "@/components/ui";
import { ListSection, SubHeader } from "@/features/settings/parts";
import PhoneLink from "@/lib/phone-link";
import { color, space, TOUCH } from "@/theme/tokens";

/** "granted" only when Android says so. "ask" can still show the system prompt; "blocked" needs Settings. */
type State = "granted" | "ask" | "blocked" | "unavailable";
type Perm = { key: string; icon: Icon; title: string; why: string; state: State; request?: () => Promise<unknown>; openSettings?: () => void };

function fromResponse(r: { granted: boolean; canAskAgain: boolean }): State {
  if (r.granted) return "granted";
  return r.canAskAgain ? "ask" : "blocked";
}

async function readAll(): Promise<Perm[]> {
  const [notif, mic] = await Promise.all([
    Notifications.getPermissionsAsync().catch(() => null),
    ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync().catch(() => null),
  ]);
  const perms: Perm[] = [
    {
      key: "notifications",
      icon: BellIcon,
      title: "Notifications",
      why: "Reminders, your morning briefing and results from automations",
      state: notif ? fromResponse(notif) : "unavailable",
      request: () => Notifications.requestPermissionsAsync(),
    },
    {
      key: "microphone",
      icon: MicrophoneIcon,
      title: "Microphone",
      why: "Talk to your agent; only while you hold the mic or tap to talk",
      state: mic ? fromResponse(mic) : "unavailable",
      request: () => ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync(),
    },
  ];
  if (PhoneLink.isAvailable()) {
    perms.push({
      key: "notification-access",
      icon: DeviceMobileIcon,
      title: "Notification access (Phone link)",
      why: "Only if you use Phone link: forwards calls and messages from your notifications",
      // Special access: Android has no prompt for it, only its settings page.
      state: PhoneLink.isAccessGranted() ? "granted" : "blocked",
      openSettings: () => PhoneLink.openAccessSettings(),
    });
  }
  return perms;
}

/**
 * Permissions: what Cowork can use on this phone, read from Android each time the screen shows.
 * Cowork asks only for what its features use; camera, photos, contacts and location are not requested.
 */
export default function PermissionsScreen() {
  const [perms, setPerms] = React.useState<Perm[] | null>(null);
  const refresh = React.useCallback(() => void readAll().then(setPerms), []);

  React.useEffect(() => {
    refresh();
    // Coming back from Android settings: read the states again.
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  const attention = perms?.filter((p) => p.state !== "granted") ?? [];
  const allowed = perms?.filter((p) => p.state === "granted") ?? [];

  const act = async (p: Perm) => {
    if (p.state === "ask" && p.request) await p.request().catch(() => {});
    else if (p.openSettings) p.openSettings();
    else await Linking.openSettings().catch(() => {});
    refresh();
  };

  return (
    <Screen>
      <SubHeader title="Permissions" />
      {!perms ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={3} height={56} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.xxl }}>
          {attention.length ? (
            <ListSection title="Needs a look">
              {attention.map((p) => (
                <Row
                  key={p.key}
                  icon={p.icon}
                  title={p.title}
                  detail={p.state === "unavailable" ? "Couldn't read this permission on this phone." : p.why}
                  right={
                    p.state === "unavailable" ? undefined : (
                      <Pressable accessibilityRole="button" accessibilityLabel={`${p.state === "ask" ? "Allow" : "Open settings for"} ${p.title}`} onPress={() => void act(p)} style={({ pressed }) => ({ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.sm, opacity: pressed ? 0.6 : 1 })}>
                        <Txt variant="label" style={{ color: color.accentText }}>
                          {p.state === "ask" ? "Allow" : "Settings"}
                        </Txt>
                      </Pressable>
                    )
                  }
                />
              ))}
            </ListSection>
          ) : null}
          {allowed.length ? (
            <ListSection title="Allowed">
              {allowed.map((p) => (
                <Row key={p.key} icon={p.icon} title={p.title} detail={p.why} right={<View accessible accessibilityLabel="Allowed"><CheckCircleIcon size={24} color={color.accentText} weight="fill" /></View>} />
              ))}
            </ListSection>
          ) : null}
          <ListSection>
            <Row icon={GearSixIcon} title="Open Android settings" onPress={() => void Linking.openSettings().catch(() => {})} />
          </ListSection>
        </ScrollView>
      )}
    </Screen>
  );
}
