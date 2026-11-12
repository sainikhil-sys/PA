import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MegaphoneIcon, PlusIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, ScrollView, Switch, useWindowDimensions, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, EmptyState, ErrorState, IconButton, Input, Skeleton, Txt } from "@/components/ui";
import { adminKeys, adminOp, useAnnouncements, type AdminAnnouncement } from "@/features/admin/api";
import { AdminScreen, RequirePermission, shortDateTime } from "@/features/admin/ui";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, radius, space, TOUCH } from "@/theme/tokens";

export default function AdminAnnouncements() {
  return (
    <RequirePermission permission="notifications.send" title="Announcements">
      <Announcements />
    </RequirePermission>
  );
}

const STATUS = { scheduled: "Scheduled", live: "Live", ended: "Ended", archived: "Archived" } as const;
const SEVERITY = { info: "Info", warning: "Warning", critical: "Critical" } as const;
const PLACEMENT = { banner: "Banner", home_card: "Home card" } as const;

/** A row of choices as rounded-rectangle buttons (never pills). */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="label">{label}</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {(Object.keys(options) as T[]).map((k) => {
          const on = k === value;
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={options[k]}
              onPress={() => onChange(k)}
              style={{ minHeight: TOUCH, paddingHorizontal: space.lg, justifyContent: "center", borderRadius: radius.control, borderWidth: 1, borderColor: on ? color.accent : color.borderStrong, backgroundColor: on ? color.accent : color.surface2 }}
            >
              <Txt variant="label" style={{ color: on ? color.onAccent : color.text }}>
                {options[k]}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type Draft = { title: string; body: string; severity: AdminAnnouncement["severity"]; placement: AdminAnnouncement["placement"]; dismissible: boolean };
const EMPTY: Draft = { title: "", body: "", severity: "info", placement: "banner", dismissible: true };

/** List, create simple ones (everyone, starting now, no end), and archive. Targeting and schedules are on the website. */
function Announcements() {
  const qc = useQueryClient();
  const list = useAnnouncements();
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [archiving, setArchiving] = React.useState<AdminAnnouncement | null>(null);

  const create = useMutation({
    mutationFn: (d: Draft) => adminOp("/api/admin/announcements", { method: "POST", body: { ...d, title: d.title.trim(), body: d.body.trim(), targeting: {} } }),
    onSuccess: () => {
      setCreating(false);
      setDraft(EMPTY);
      void qc.invalidateQueries({ queryKey: adminKeys.announcements });
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => adminOp(`/api/admin/announcements/${encodeURIComponent(id)}/archive`, { method: "POST" }),
    onSuccess: () => {
      setArchiving(null);
      void qc.invalidateQueries({ queryKey: adminKeys.announcements });
    },
  });

  const { height } = useWindowDimensions();
  const ready = draft.title.trim().length >= 3 && draft.body.trim().length >= 3;
  const rows = (list.data ?? []).filter((a) => a.status !== "archived");

  return (
    <AdminScreen
      title="Announcements"
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      right={
        <IconButton
          icon={PlusIcon}
          tone="plain"
          label="New announcement"
          onPress={() => {
            create.reset();
            setCreating(true);
          }}
        />
      }
    >
      {list.isPending ? (
        <Skeleton rows={3} height={80} />
      ) : list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={MegaphoneIcon} title="No announcements" body="Announcements show as a banner or a Home card in the app and on the website." action={<Button label="New announcement" icon={PlusIcon} onPress={() => setCreating(true)} />} />
      ) : (
        <Group>
          {rows.map((a) => (
            <View key={a.id} style={{ padding: space.lg, gap: space.sm }}>
              <View style={{ gap: 2 }}>
                <Txt variant="label">{a.title}</Txt>
                <Txt variant="small" numberOfLines={3}>
                  {a.body}
                </Txt>
                <Txt variant="small">{[STATUS[a.status], SEVERITY[a.severity], PLACEMENT[a.placement], a.status === "scheduled" ? `Starts ${shortDateTime(a.startsAt)}` : a.endsAt ? `Ends ${shortDateTime(a.endsAt)}` : null, `${a.dismissals} hidden`].filter(Boolean).join("  ·  ")}</Txt>
              </View>
              <Button
                label="Archive"
                compact
                style={{ alignSelf: "flex-start" }}
                accessibilityLabel={`Archive "${a.title}"`}
                onPress={() => {
                  archive.reset();
                  setArchiving(a);
                }}
              />
            </View>
          ))}
        </Group>
      )}
      <Txt variant="small">Targeting, schedules, links and editing are on the website console.</Txt>

      <Sheet open={creating} onClose={() => setCreating(false)} title="New announcement">
        <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={{ gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Input label="Title" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} maxLength={120} />
        <Input label="Message" value={draft.body} onChangeText={(body) => setDraft({ ...draft, body })} maxLength={600} multiline style={{ minHeight: 88, paddingTop: space.md, textAlignVertical: "top" }} />
        <Choice label="Importance" value={draft.severity} options={SEVERITY} onChange={(severity) => setDraft({ ...draft, severity })} />
        <Choice label="Where" value={draft.placement} options={PLACEMENT} onChange={(placement) => setDraft({ ...draft, placement })} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH }}>
          <Txt variant="label" style={{ flex: 1 }}>
            People can hide it
          </Txt>
          <Switch value={draft.dismissible} onValueChange={(dismissible) => setDraft({ ...draft, dismissible })} accessibilityLabel="People can hide it" trackColor={{ true: color.accent, false: color.surface3 }} thumbColor={color.bg} />
        </View>
        <Txt variant="small">Shown to everyone, starting now, until you archive it.</Txt>
        {create.error ? (
          <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
            {errorText(create.error)}
          </Txt>
        ) : null}
        </ScrollView>
        <Button label="Publish" variant="primary" disabled={!ready} loading={create.isPending} onPress={() => create.mutate(draft)} />
      </Sheet>

      <ConfirmSheet
        open={Boolean(archiving)}
        title="Archive this announcement?"
        body={archive.error ? errorText(archive.error) : `"${archiving?.title ?? ""}" stops showing in the app and on the website.`}
        confirmLabel="Archive"
        destructive
        busy={archive.isPending}
        onConfirm={() => archiving && archive.mutate(archiving.id)}
        onClose={() => setArchiving(null)}
      />
    </AdminScreen>
  );
}
