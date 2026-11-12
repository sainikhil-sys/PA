import { router, type Href } from "expo-router";
import { BellRingingIcon, CaretRightIcon, ClipboardTextIcon, FingerprintIcon, GaugeIcon, GlobeIcon, LockIcon, ToggleRightIcon, UsersIcon, WrenchIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Switch, View } from "react-native";
import { Button, Row, Txt } from "@/components/ui";
import { adminRaw, endAdminSession, useAdminMe } from "@/features/admin/api";
import { biometricUnavailable, confirmBiometric, useBiometricPreference } from "@/features/admin/biometric";
import { sectionsFor, type AdminSectionKey } from "@/features/admin/permissions";
import { useAdminToken } from "@/features/admin/token-store";
import { AdminScreen, clockTime, openWebConsole } from "@/features/admin/ui";
import { Group } from "@/features/settings/parts";
import { color, space } from "@/theme/tokens";

const ICONS: Record<AdminSectionKey, Icon> = {
  overview: GaugeIcon,
  users: UsersIcon,
  flags: ToggleRightIcon,
  maintenance: WrenchIcon,
  announcements: BellRingingIcon,
  audit: ClipboardTextIcon,
};

/** Console home: the sections this role may open, the lock, and the biometric option. */
export default function AdminHome() {
  const me = useAdminMe();
  const expiresAt = useAdminToken((s) => s.expiresAt);
  const bio = useBiometricPreference((s) => s.enabled);
  const setBio = useBiometricPreference((s) => s.setEnabled);
  const [bioNote, setBioNote] = React.useState<string | null>(null);
  const [locking, setLocking] = React.useState(false);
  const sections = sectionsFor(me.data?.permissions);
  const chevron = <CaretRightIcon size={18} color={color.subtle} />;

  async function lock() {
    setLocking(true);
    // End it here whatever the network does; the server session also ends on its own when idle.
    await adminRaw("/api/admin/lock", { method: "POST" }).catch(() => {});
    endAdminSession("The console is locked. Enter a code to unlock it again.");
  }

  async function toggleBio(on: boolean) {
    setBioNote(null);
    if (!on) return void setBio(false);
    const why = await biometricUnavailable();
    if (why) return setBioNote(why);
    if (await confirmBiometric("Turn on the biometric lock")) await setBio(true);
    else setBioNote("Not turned on. Try again when you're ready.");
  }

  return (
    <AdminScreen title="Admin console" onRefresh={() => void me.refetch()} refreshing={me.isRefetching}>
      <View style={{ gap: space.md }}>
        <Txt variant="bodyMuted">{`Role: ${me.data?.role ?? ""}.${expiresAt ? ` Unlocked; the session ends by ${clockTime(expiresAt)}, or sooner when idle.` : ""}`}</Txt>
        <Button label="Lock the console" icon={LockIcon} loading={locking} onPress={() => void lock()} accessibilityLabel="Lock the admin console now" />
      </View>

      {sections.length ? (
        <Group>
          {sections.map((s) => (
            <Row key={s.key} icon={ICONS[s.key]} title={s.title} detail={s.detail} right={chevron} onPress={() => router.push(`/admin/${s.key}` as Href)} />
          ))}
        </Group>
      ) : (
        <Txt variant="bodyMuted">Your role has nothing to manage from the phone. Use the website console.</Txt>
      )}

      <Group>
        <Row
          icon={FingerprintIcon}
          title="Biometric lock"
          detail="Asks for your fingerprint or face after 5 minutes away from the app. It's a lock on this phone only; the server still requires your admin code."
          right={<Switch value={bio} onValueChange={(v) => void toggleBio(v)} accessibilityLabel="Biometric lock" trackColor={{ true: color.accent, false: color.surface3 }} thumbColor={color.bg} />}
        />
      </Group>
      {bioNote ? (
        <Txt variant="small" accessibilityLiveRegion="polite" style={{ marginTop: -space.md }}>
          {bioNote}
        </Txt>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Txt variant="small">Roles, ownership, configuration rollback, mandatory updates and account deletion are on the website console only.</Txt>
        <Button label="Open the website console" icon={GlobeIcon} onPress={openWebConsole} />
      </View>
    </AdminScreen>
  );
}
