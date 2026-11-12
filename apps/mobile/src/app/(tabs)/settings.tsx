import * as Application from "expo-application";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  BellIcon,
  BrainIcon,
  CaretRightIcon,
  ChatTextIcon,
  DeviceMobileIcon,
  FileTextIcon,
  InfoIcon,
  LifebuoyIcon,
  ListChecksIcon,
  LockSimpleIcon,
  NotebookIcon,
  PencilSimpleIcon,
  PlugsConnectedIcon,
  ScrollIcon,
  ShieldCheckIcon,
  ShieldStarIcon,
  SignOutIcon,
  CircleHalfIcon,
  TrashIcon,
  UserCircleIcon,
  WarningIcon,
} from "phosphor-react-native";
import * as React from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { ErrorState, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { useTabBarSpace } from "@/features/navigation/tab-bar";
import { ListSection } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, WEB_URL } from "@/lib/config";
import { useMe } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useThemePreference } from "@/theme/preference";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";

const APPEARANCE_LABEL = { system: "System", light: "Light", dark: "Dark" } as const;

function memberSince(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Profile: who you are, what you keep, and every setting, as one list (layout follows the reference). */
export default function ProfileTab() {
  const chevron = <CaretRightIcon size={18} color={color.subtle} />;
  const me = useMe();
  const signOut = useSession((s) => s.signOut);
  const appearance = useThemePreference((s) => s.preference);
  const bottom = useTabBarSpace();
  const [confirmOut, setConfirmOut] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [helpNote, setHelpNote] = React.useState<string | null>(null);

  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut({ remote: true });
    } catch {
      // Clearing local storage failed; leave the sheet usable so the person can try again.
      setSigningOut(false);
    }
  }

  const mail = (subject: string) =>
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() => setHelpNote(`No email app found. Write to ${SUPPORT_EMAIL}.`));
  const go = (href: Href) => () => router.push(href);
  const version = Application.nativeApplicationVersion;
  const d = me.data;
  const since = memberSince(d?.memberSince);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottom, gap: space.xxl }}
        refreshControl={<RefreshControl refreshing={me.isRefetching} onRefresh={() => void me.refetch()} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
      >
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.lg }}>
          <Txt variant="title" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32 }}>
            Profile
          </Txt>
          {me.isPending ? (
            <Skeleton rows={2} height={72} />
          ) : me.isError || !d ? (
            <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />
          ) : (
            <>
              <View style={{ alignItems: "center", gap: space.sm }}>
                <Avatar name={d.name || d.email} url={d.avatarUrl ?? null} />
                <Txt variant="heading" style={{ fontSize: 20, lineHeight: 26 }} numberOfLines={1}>
                  {d.name || "Your name"}
                </Txt>
                <Txt variant="small" numberOfLines={1}>
                  {[d.email, since ? `Since ${since}` : null].filter(Boolean).join("  ·  ")}
                </Txt>
              </View>
              <OutlineButton label="Edit profile" icon={PencilSimpleIcon} onPress={go("/settings/account")} />
              {d.stats ? (
                <View style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.border, paddingVertical: space.lg }}>
                  <Stat value={d.stats.chats} label="Chats" tint={color.accentText} onPress={go("/assistant")} />
                  <Stat value={d.stats.notes} label="Notes" tint={color.accentText} onPress={go("/notes")} />
                  <Stat value={d.stats.documents} label="Documents" tint={color.text} onPress={go("/settings/documents")} />
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={d.bio ? `Bio: ${d.bio}. Edit` : "Write a short bio"}
                onPress={go("/settings/account")}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, opacity: pressed ? 0.6 : 1 })}
              >
                <UserCircleIcon size={22} color={d.bio ? color.muted : color.accentText} />
                <Txt variant="body" style={{ flex: 1, color: d.bio ? color.text : color.accentText }} numberOfLines={3}>
                  {d.bio || "Write a short bio"}
                </Txt>
              </Pressable>
            </>
          )}
        </View>

        <ListSection title="My stuff">
          <Row icon={NotebookIcon} title="Notes and links" onPress={go("/notes")} right={chevron} />
          <Row icon={FileTextIcon} title="Documents" onPress={go("/settings/documents")} right={chevron} />
          <Row icon={BrainIcon} title="Memory" detail="What your agent knows about you" onPress={go("/settings/memory")} right={chevron} />
          <Row icon={ListChecksIcon} title="Activity history" onPress={go("/settings/activity")} right={chevron} />
        </ListSection>

        <ListSection title="Settings">
          <Row icon={UserCircleIcon} title="Account" onPress={go("/settings/account")} right={chevron} />
          <Row icon={BellIcon} title="Notifications" onPress={go("/settings/notifications")} right={chevron} />
          <Row icon={LockSimpleIcon} title="Permissions" onPress={go("/settings/permissions")} right={chevron} />
          <Row
            icon={CircleHalfIcon}
            title="Appearance"
            onPress={go("/settings/appearance")}
            right={
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Txt variant="small">{APPEARANCE_LABEL[appearance]}</Txt>
                {chevron}
              </View>
            }
          />
          <Row icon={DeviceMobileIcon} title="Phone link" onPress={go("/settings/phone")} right={chevron} />
          <Row icon={PlugsConnectedIcon} title="Connected services" detail="Gmail, Calendar and more" onPress={go("/settings/integrations")} right={chevron} />
        </ListSection>

        {d?.isAdmin ? (
          <ListSection title="Admin">
            <Row
              icon={ShieldStarIcon}
              title="Admin console"
              detail="Opens the console on the website. Sign in there with this email if asked."
              onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/console`)}
              right={chevron}
            />
          </ListSection>
        ) : null}

        <ListSection title="Help and more">
          <Row icon={LifebuoyIcon} title="Contact support" detail={SUPPORT_EMAIL} onPress={() => mail("Cowork support")} right={chevron} />
          <Row icon={WarningIcon} title="Report a problem" onPress={() => mail(`Problem report (app ${version ?? "unknown"})`)} right={chevron} />
          <Row icon={ChatTextIcon} title="Send feedback" onPress={() => mail("Cowork feedback")} right={chevron} />
          <Row icon={ShieldCheckIcon} title="Privacy policy" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} right={chevron} />
          <Row icon={ScrollIcon} title="Terms" onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} right={chevron} />
          <Row icon={InfoIcon} title="About Cowork" detail={`Version ${version ?? "unknown"}`} />
        </ListSection>
        {helpNote ? (
          <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, marginTop: -space.lg }}>
            {helpNote}
          </Txt>
        ) : null}

        <ListSection>
          <Row icon={SignOutIcon} title="Sign out" onPress={() => setConfirmOut(true)} />
          <Row icon={TrashIcon} title="Delete account" detail="Remove your account and all of its data" danger onPress={go("/settings/delete")} right={chevron} />
        </ListSection>
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

/** Account photo (set on the website) or the first initial. */
function Avatar({ name, url }: { name: string; url: string | null }) {
  const size = 96;
  if (url) {
    return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" accessibilityLabel="Your profile photo" />;
  }
  return (
    <View accessibilityLabel="Your initial" style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: color.surface, borderWidth: 1, borderColor: color.border }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 38, color: color.text }}>{name.trim().charAt(0).toUpperCase() || "C"}</Text>
    </View>
  );
}

function Stat({ value, label, tint, onPress }: { value: number; label: string; tint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${value} ${label}`} onPress={onPress} style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontFamily: font.semibold, fontSize: 28, color: tint }} maxFontSizeMultiplier={1.3}>
        {value}
      </Text>
      <Txt variant="small">{label}</Txt>
    </Pressable>
  );
}

function OutlineButton({ label, icon: IconCmp, onPress }: { label: string; icon: typeof PencilSimpleIcon; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        minHeight: TOUCH + 4,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: color.borderStrong,
        backgroundColor: pressed ? color.surface2 : color.surface,
      })}
    >
      <IconCmp size={18} color={color.text} />
      <Txt variant="label">{label}</Txt>
    </Pressable>
  );
}
