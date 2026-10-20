import * as Application from "expo-application";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  BellIcon,
  BrainIcon,
  CaretRightIcon,
  DeviceMobileIcon,
  FileTextIcon,
  InfoIcon,
  LifebuoyIcon,
  ListChecksIcon,
  PlugsConnectedIcon,
  ScrollIcon,
  ShieldCheckIcon,
  SignOutIcon,
  TrashIcon,
} from "phosphor-react-native";
import * as React from "react";
import { Linking, RefreshControl, ScrollView, Switch, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { ErrorState, Row, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from "@/lib/config";
import { disablePush, enablePush, pushEnabled } from "@/lib/push";
import { useMe } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { color, space } from "@/theme/tokens";

const chevron = <CaretRightIcon size={18} color={color.subtle} />;

/** Settings tab: your agent, this phone, account, about, and account deletion. */
export default function SettingsTab() {
  const me = useMe();
  const signOut = useSession((s) => s.signOut);
  const [push, setPush] = React.useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushNote, setPushNote] = React.useState<string | null>(null);
  const [confirmOut, setConfirmOut] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    void pushEnabled().then(setPush).catch(() => setPush(false));
  }, []);

  async function togglePush(next: boolean) {
    setPushBusy(true);
    setPushNote(null);
    try {
      if (next) {
        const r = await enablePush();
        setPush(r.ok);
        setPushNote(r.ok ? "Notifications are on for this phone." : r.message);
      } else {
        await disablePush();
        setPush(false);
        setPushNote("Notifications are off for this phone.");
      }
    } catch (err) {
      setPushNote(errorText(err));
    } finally {
      setPushBusy(false);
    }
  }

  async function doSignOut() {
    setSigningOut(true);
    await signOut({ remote: true });
  }

  const version = Application.nativeApplicationVersion;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xxl }}
        refreshControl={<RefreshControl refreshing={me.isRefetching} onRefresh={() => void me.refetch()} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
      >
        <View style={{ gap: space.xs, paddingTop: space.sm }}>
          {me.isPending ? (
            <Skeleton rows={1} height={64} />
          ) : me.isError ? (
            <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />
          ) : (
            <>
              <Txt variant="display" accessibilityRole="header" numberOfLines={2}>
                {me.data.name || "Settings"}
              </Txt>
              <Txt variant="bodyMuted" numberOfLines={1}>
                {me.data.email}
              </Txt>
            </>
          )}
        </View>

        <View>
          <SectionHeader title="Your agent" />
          <Group>
            <Row icon={BrainIcon} title="Memory" detail="What your agent knows about you" onPress={() => router.push("/settings/memory")} right={chevron} />
            <Row icon={FileTextIcon} title="Documents" detail="Files your agent can search" onPress={() => router.push("/settings/documents")} right={chevron} />
          </Group>
        </View>

        <View>
          <SectionHeader title="This phone" />
          <Group>
            <View>
              <Row
                icon={BellIcon}
                title="Notifications"
                detail="Approvals, reminders and replies from your agent"
                right={
                  <Switch
                    accessibilityLabel="Notifications on this phone"
                    accessibilityRole="switch"
                    value={Boolean(push)}
                    disabled={push === null || pushBusy}
                    onValueChange={(v) => void togglePush(v)}
                    trackColor={{ false: color.surface3, true: color.orangeDeep }}
                    thumbColor={push ? color.orange : color.muted}
                  />
                }
              />
              {pushNote ? (
                <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
                  {pushNote}
                </Txt>
              ) : null}
            </View>
            <Row icon={DeviceMobileIcon} title="Phone link" detail="Let your agent see this phone's notifications" onPress={() => router.push("/settings/phone")} right={chevron} />
          </Group>
        </View>

        <View>
          <SectionHeader title="Account" />
          <Group>
            <Row icon={PlugsConnectedIcon} title="Connected services" detail="Gmail, Calendar and more" onPress={() => router.push("/settings/integrations")} right={chevron} />
            <Row icon={ListChecksIcon} title="Activity" detail="What you and your agent did, and when" onPress={() => router.push("/settings/activity")} right={chevron} />
            <Row icon={SignOutIcon} title="Sign out" onPress={() => setConfirmOut(true)} />
          </Group>
        </View>

        <View>
          <SectionHeader title="About" />
          <Group>
            <Row icon={ShieldCheckIcon} title="Privacy policy" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} right={chevron} />
            <Row icon={ScrollIcon} title="Terms" onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} right={chevron} />
            <Row icon={LifebuoyIcon} title="Help" detail={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {})} right={chevron} />
            <Row icon={InfoIcon} title="Version" detail={version ?? "Unknown"} />
          </Group>
        </View>

        <View>
          <SectionHeader title="Danger zone" />
          <Group>
            <Row icon={TrashIcon} title="Delete account" detail="Remove your account and all of its data" danger onPress={() => router.push("/settings/delete")} right={chevron} />
          </Group>
        </View>
      </ScrollView>

      <ConfirmSheet
        open={confirmOut}
        title="Sign out"
        body="This signs Cowork out on this phone and stops its notifications here. Your data stays in your account."
        confirmLabel="Sign out"
        busy={signingOut}
        onConfirm={() => void doSignOut()}
        onClose={() => setConfirmOut(false)}
      />
    </Screen>
  );
}
