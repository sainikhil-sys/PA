import { useQueryClient } from "@tanstack/react-query";
import * as Device from "expo-device";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { CheckCircleIcon, CircleDashedIcon, DeviceMobileIcon, LinkBreakIcon, PauseCircleIcon, ShieldCheckIcon, WarningCircleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { AppState, ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, ErrorState, IconButton, Row, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { Group, refresh, SubHeader, timeAgo } from "@/features/settings/parts";
import { api, errorText } from "@/lib/api";
import { API_URL } from "@/lib/config";
import PhoneLink from "@/lib/phone-link";
import { keys, usePhones } from "@/lib/queries";
import type { PhoneDevice } from "@/lib/types";
import { color, radius, space } from "@/theme/tokens";

import { PHONE_DEVICE_KEY as DEVICE_KEY } from "@/lib/session";

type Status = { available: boolean; granted: boolean; linked: boolean; deviceId: string | null };

async function readStatus(): Promise<Status> {
  const deviceId = await SecureStore.getItemAsync(DEVICE_KEY).catch(() => null);
  return { available: PhoneLink.isAvailable(), granted: PhoneLink.isAccessGranted(), linked: PhoneLink.isLinked(), deviceId };
}

function StatusLine({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const I: Icon = ok ? CheckCircleIcon : warn ? WarningCircleIcon : CircleDashedIcon;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }}>
      <I size={18} color={ok ? color.success : warn ? color.warning : color.subtle} weight={ok || warn ? "fill" : "regular"} />
      <Txt variant="label" style={{ flex: 1 }}>
        {label}
      </Txt>
    </View>
  );
}

/** Phone link: disclosure first, then link or unlink this phone and see other linked phones. */
export default function PhoneScreen() {
  const qc = useQueryClient();
  const phones = usePhones();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; error?: boolean; access?: boolean } | null>(null);
  // Blocks a second tap from starting another link or unlink before `busy` re-renders.
  const lockRef = React.useRef(false);
  const [unlinking, setUnlinking] = React.useState<{ id: string | null; name: string; self: boolean } | null>(null);

  const check = React.useCallback(() => {
    void readStatus().then((s) => {
      setStatus(s);
      // Back from Android's access screen with access on: the "turn it on" hint is done.
      if (s.granted) setNote((n) => (n?.access ? null : n));
    });
  }, []);

  // Re-check when the screen regains focus and when the person returns from the system access screen.
  useFocusEffect(
    React.useCallback(() => {
      check();
      void phones.refetch();
      const sub = AppState.addEventListener("change", (s) => s === "active" && check());
      return () => sub.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [check]),
  );

  async function link() {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setNote(null);
    try {
      // A link this phone no longer holds (cleared, or unlinked elsewhere) is revoked first, so it can't linger.
      const previous = status?.deviceId;
      if (previous) await api("/api/mobile/phone", { method: "DELETE", body: { deviceId: previous } }).catch(() => {});
      const r = await api<{ ok: true; token: string; deviceId: string }>("/api/mobile/phone", {
        method: "POST",
        body: { name: (Device.deviceName?.trim() || "Android phone").slice(0, 60), ...(Device.modelName ? { model: Device.modelName.slice(0, 80) } : {}) },
      });
      try {
        await SecureStore.setItemAsync(DEVICE_KEY, r.deviceId);
        PhoneLink.setLink(API_URL, r.token);
      } catch {
        // The server link exists but this phone couldn't store it: undo it so nothing is left half-linked.
        PhoneLink.clearLink();
        await api("/api/mobile/phone", { method: "DELETE", body: { deviceId: r.deviceId } }).catch(() => {});
        await SecureStore.deleteItemAsync(DEVICE_KEY).catch(() => {});
        setNote({ text: "This phone couldn't save the link. Try again.", error: true });
        return;
      }
      if (!PhoneLink.isAccessGranted()) {
        setNote({ text: "Linked. Turn on Notification access for Cowork in the screen that opened, then come back here.", access: true });
        PhoneLink.openAccessSettings();
      } else {
        setNote({ text: "Linked. New notifications on this phone will reach your agent." });
      }
    } catch (err) {
      setNote({ text: errorText(err), error: true });
    } finally {
      lockRef.current = false;
      setBusy(false);
      void qc.invalidateQueries({ queryKey: keys.phones });
      check();
    }
  }

  async function unlink() {
    if (!unlinking || lockRef.current) return;
    lockRef.current = true;
    const target = unlinking;
    setBusy(true);
    setNote(null);
    try {
      // Stop forwarding on this phone first, so it ends at once even if the server can't be reached.
      if (target.self) PhoneLink.clearLink();
      if (target.id) await api("/api/mobile/phone", { method: "DELETE", body: { deviceId: target.id } });
      if (target.self) await SecureStore.deleteItemAsync(DEVICE_KEY).catch(() => {});
      setNote({ text: target.self ? "This phone is unlinked. Nothing more is sent from it." : `${target.name} is unlinked.` });
    } catch (err) {
      setNote({
        text: target.self ? `This phone stopped sending, but Cowork couldn't confirm the unlink. ${errorText(err)} Unlink it again from the list below.` : errorText(err),
        error: true,
      });
    } finally {
      setUnlinking(null);
      lockRef.current = false;
      setBusy(false);
      void qc.invalidateQueries({ queryKey: keys.phones });
      check();
    }
  }

  const list = phones.data ?? [];
  const self = status?.deviceId ? list.find((p) => p.id === status.deviceId) : undefined;
  // This phone's own entry is shown above while it is linked here; otherwise it is listed so it can be unlinked.
  const others = list.filter((p) => !(self && status?.linked && p.id === self.id));
  // Linked on this phone but revoked on the server (for example unlinked from the website).
  const stale = Boolean(status?.linked && phones.isSuccess && !self);

  return (
    <Screen>
      <SubHeader title="Phone link" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xxl }} refreshControl={refresh(phones.isRefetching, () => (check(), void phones.refetch()))}>
        <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.borderStrong, padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <ShieldCheckIcon size={22} color={color.warm} />
            <Txt variant="heading" accessibilityRole="header">
              What Phone link sends
            </Txt>
          </View>
          <Txt variant="body">
            When you link this phone, Cowork sends your agent the app name, title and text of the notifications that appear here, such as calls and messages, plus this phone's battery level and whether it is charging.
          </Txt>
          <Txt variant="bodyMuted">Nothing is sent until you allow Notification access for Cowork in Android settings.</Txt>
          <Txt variant="bodyMuted">Notifications are kept for 3 days, then deleted.</Txt>
          <Txt variant="bodyMuted">You can pause it on the website or unlink it here at any time. Unlinking stops it at once.</Txt>
        </View>

        <View>
          <SectionHeader title="This phone" />
          {status === null ? (
            <Skeleton rows={1} height={120} />
          ) : !status.available ? (
            <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: space.sm }}>
              <StatusLine ok={false} warn label="Not available in this version of the app" />
              <Txt variant="small">This build of Cowork doesn't include Phone link, so nothing is sent from this phone. You can still unlink other phones below.</Txt>
            </View>
          ) : (
            <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: space.md }}>
              <View style={{ gap: space.xs }}>
                <StatusLine ok={status.linked && !stale} warn={stale} label={stale ? "Unlinked from another device" : status.linked ? "Linked" : "Not linked"} />
                <StatusLine ok={status.granted} warn={status.linked && !status.granted} label={status.granted ? "Notification access on" : "Notification access off"} />
                {self?.paused ? <StatusLine ok={false} warn label="Paused on the website" /> : null}
              </View>
              {note ? (
                <Txt variant="small" accessibilityLiveRegion="polite" style={note.error ? { color: color.danger } : undefined}>
                  {note.text}
                </Txt>
              ) : null}
              {!status.linked || stale ? (
                <Button label={stale ? "Link this phone again" : "Link this phone"} variant="primary" icon={DeviceMobileIcon} loading={busy} onPress={() => void link()} />
              ) : (
                <View style={{ gap: space.sm }}>
                  {!status.granted ? <Button label="Turn on Notification access" variant="primary" onPress={() => PhoneLink.openAccessSettings()} /> : null}
                  <Button
                    label="Unlink this phone"
                    variant="danger"
                    icon={LinkBreakIcon}
                    disabled={busy}
                    onPress={() => setUnlinking({ id: status.deviceId, name: "This phone", self: true })}
                  />
                </View>
              )}
              {self?.paused ? (
                <Button label="Manage on the website" variant="ghost" onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/phone`)} />
              ) : null}
            </View>
          )}
        </View>

        <View>
          <SectionHeader title="Other linked phones" />
          {phones.isPending ? (
            <Skeleton rows={2} height={56} />
          ) : phones.isError ? (
            <ErrorState message={errorText(phones.error)} onRetry={() => void phones.refetch()} />
          ) : others.length === 0 ? (
            <Txt variant="small">No other phones are linked to your account.</Txt>
          ) : (
            <Group>
              {others.map((p: PhoneDevice) => (
                <Row
                  key={p.id}
                  icon={p.paused ? PauseCircleIcon : DeviceMobileIcon}
                  title={p.name}
                  detail={[p.id === status?.deviceId ? "This phone, not linked here" : null, p.model, p.paused ? "Paused" : null, p.lastSeenAt ? `Last seen ${timeAgo(p.lastSeenAt).toLowerCase()}` : null].filter(Boolean).join(", ")}
                  right={<IconButton icon={LinkBreakIcon} label={`Unlink ${p.name}`} tone="plain" disabled={busy} onPress={() => setUnlinking({ id: p.id, name: p.name, self: false })} />}
                />
              ))}
            </Group>
          )}
        </View>
      </ScrollView>

      <ConfirmSheet
        open={unlinking !== null}
        title={unlinking?.self ? "Unlink this phone" : `Unlink ${unlinking?.name ?? "phone"}`}
        body={
          unlinking?.self
            ? "Cowork stops receiving this phone's notifications right away. Notifications already sent are deleted after 3 days."
            : "That phone stops sending notifications right away. You can link it again from the app on that phone."
        }
        confirmLabel="Unlink"
        destructive
        busy={busy}
        onConfirm={() => void unlink()}
        onClose={() => setUnlinking(null)}
      />
    </Screen>
  );
}
