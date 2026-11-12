import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, BellSimpleIcon, DeviceMobileIcon, EnvelopeSimpleIcon, MoonIcon, NewspaperIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, Switch, View } from "react-native";
import { Button, ErrorState, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { ListSection, SubHeader } from "@/features/settings/parts";
import { pickTime } from "@/features/tasks/pickers";
import { api, errorText } from "@/lib/api";
import { disablePush, enablePush, pushEnabled } from "@/lib/push";
import { color, space } from "@/theme/tokens";

type Prefs = { notifyPush: boolean; notifyInApp: boolean; notifyEmail: boolean; notifyEmailDigest: boolean; quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string };
type Toggle = "notifyPush" | "notifyInApp" | "notifyEmail" | "notifyEmailDigest";
const PREFS_KEY = ["preferences"] as const;

function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function atTime(value: string | null, fallback: string) {
  const [h, m] = (value ?? fallback).split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 22, m ?? 0, 0, 0);
  return d;
}
function show(value: string) {
  return atTime(value, value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Notifications: this phone (push on or off) and your account's preferences, which apply on every
 * device. Kinds Cowork sends: reminders, the morning briefing, urgent email and automation results.
 */
export default function NotificationSettings() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: () => api<Prefs>("/api/mobile/preferences") });
  const [push, setPush] = React.useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    void pushEnabled().then(setPush).catch(() => setPush(false));
  }, []);

  const save = useMutation({
    mutationFn: (patch: Partial<Prefs>) => api<{ ok: true }>("/api/mobile/preferences", { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      // Show the change right away; put it back if the server refuses.
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const before = qc.getQueryData<Prefs>(PREFS_KEY);
      if (before) qc.setQueryData<Prefs>(PREFS_KEY, { ...before, ...patch });
      return { before };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(PREFS_KEY, ctx.before);
      setNote({ ok: false, text: errorText(err) });
    },
    onSuccess: () => setNote(null),
  });

  async function togglePush(next: boolean) {
    setPushBusy(true);
    setNote(null);
    try {
      if (next) {
        const r = await enablePush();
        setPush(r.ok);
        setNote(r.ok ? { ok: true, text: "Notifications are on for this phone." } : { ok: false, text: r.message });
      } else {
        await disablePush();
        setPush(false);
        setNote({ ok: true, text: "Notifications are off for this phone." });
      }
    } catch (err) {
      setNote({ ok: false, text: errorText(err) });
    } finally {
      setPushBusy(false);
    }
  }

  const sw = (value: boolean, onChange: (v: boolean) => void, label: string, disabled?: boolean) => (
    <Switch
      accessibilityLabel={label}
      accessibilityRole="switch"
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: color.surface3, true: color.accent }}
      thumbColor={value ? color.bg : color.muted}
    />
  );
  const toggle = (key: Toggle, label: string) => sw(Boolean(prefs.data?.[key]), (v) => save.mutate({ [key]: v }), label);

  const editQuiet = async (end: "quietHoursStart" | "quietHoursEnd") => {
    const p = prefs.data;
    if (!p) return;
    const picked = await pickTime(atTime(p[end], end === "quietHoursStart" ? "22:00" : "07:00"));
    if (!picked) return;
    save.mutate({ quietHoursStart: p.quietHoursStart ?? "22:00", quietHoursEnd: p.quietHoursEnd ?? "07:00", [end]: hhmm(picked) });
  };

  const p = prefs.data;
  const quietOn = Boolean(p?.quietHoursStart && p.quietHoursEnd);

  return (
    <Screen>
      <SubHeader title="Notifications" />
      <ScrollView contentContainerStyle={{ paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.xxl }}>
        <ListSection title="This phone">
          <Row icon={DeviceMobileIcon} title="Phone notifications" detail="Show Cowork notifications on this phone" right={sw(Boolean(push), (v) => void togglePush(v), "Notifications on this phone", push === null || pushBusy)} />
        </ListSection>
        {note ? (
          <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, marginTop: -space.lg, color: note.ok ? color.success : color.danger }}>
            {note.text}
          </Txt>
        ) : null}

        {prefs.isPending ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <Skeleton rows={4} height={56} />
          </View>
        ) : prefs.isError || !p ? (
          <ErrorState message={errorText(prefs.error)} onRetry={() => void prefs.refetch()} />
        ) : (
          <>
            <ListSection title="Everywhere you're signed in">
              <Row icon={BellIcon} title="Push" detail="Phones and browsers where notifications are on" right={toggle("notifyPush", "Push notifications")} />
              <Row icon={BellSimpleIcon} title="In Cowork" detail="The Notifications list in the app and on the website" right={toggle("notifyInApp", "Notifications in Cowork")} />
              <Row icon={EnvelopeSimpleIcon} title="Email" detail="Important alerts by email" right={toggle("notifyEmail", "Email notifications")} />
              <Row icon={NewspaperIcon} title="Daily email digest" detail="One summary email a day" right={toggle("notifyEmailDigest", "Daily email digest")} />
            </ListSection>

            <View style={{ gap: space.sm }}>
              <ListSection title="Quiet hours">
                <Row
                  icon={MoonIcon}
                  title="Quiet hours"
                  detail={quietOn ? `${show(p.quietHoursStart!)} to ${show(p.quietHoursEnd!)} (${p.timezone})` : "Off: notifications can arrive at any time"}
                  right={sw(quietOn, (v) => save.mutate(v ? { quietHoursStart: "22:00", quietHoursEnd: "07:00" } : { quietHoursStart: null, quietHoursEnd: null }), "Quiet hours")}
                />
              </ListSection>
              {quietOn ? (
                <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg }}>
                  <Button label={`From ${show(p.quietHoursStart!)}`} compact style={{ flex: 1 }} onPress={() => void editQuiet("quietHoursStart")} />
                  <Button label={`Until ${show(p.quietHoursEnd!)}`} compact style={{ flex: 1 }} onPress={() => void editQuiet("quietHoursEnd")} />
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
