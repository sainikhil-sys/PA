import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarBlankIcon, CaretRightIcon, CheckCircleIcon, EnvelopeSimpleIcon, GlobeHemisphereEastIcon, TextAlignLeftIcon, UserIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, ErrorState, Input, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { ListSection, SubHeader } from "@/features/settings/parts";
import { api, errorText } from "@/lib/api";
import { keys, useMe } from "@/lib/queries";
import { color, space } from "@/theme/tokens";

type Field = "name" | "bio";
const FIELD: Record<Field, { title: string; label: string; max: number; multiline?: boolean; placeholder: string }> = {
  name: { title: "Name", label: "Your name", max: 80, placeholder: "How Cowork should address you" },
  bio: { title: "Bio", label: "A short bio", max: 280, multiline: true, placeholder: "A line or two about you" },
};

/** Account settings: your details (name and bio are editable), how you sign in, and your time zone. */
export default function AccountScreen() {
  const me = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Field | null>(null);
  const [tzNote, setTzNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const chevron = <CaretRightIcon size={18} color={color.subtle} />;
  const phoneTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const setTz = useMutation({
    mutationFn: () => api<{ ok: true }>("/api/mobile/me", { method: "PATCH", body: { timezone: phoneTz } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.today });
      setTzNote({ ok: true, text: `Time zone set to ${phoneTz}.` });
    },
    onError: (err) => setTzNote({ ok: false, text: errorText(err) }),
  });

  const d = me.data;
  const since = d?.memberSince ? new Date(d.memberSince).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <Screen>
      <SubHeader title="Account settings" />
      {me.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} height={56} />
        </View>
      ) : me.isError || !d ? (
        <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.xxl }}>
          <ListSection title="My details">
            <Row icon={UserIcon} title="Name" onPress={() => setEditing("name")} right={<Value text={d.name || "Add your name"} chevron={chevron} />} />
            <Row icon={TextAlignLeftIcon} title="Bio" detail={d.bio || null} onPress={() => setEditing("bio")} right={d.bio ? chevron : <Value text="Add" chevron={chevron} />} />
            <Row icon={EnvelopeSimpleIcon} title="Email" right={<Txt variant="small">{d.email}</Txt>} />
            {since ? <Row icon={CalendarBlankIcon} title="Member since" right={<Txt variant="small">{since}</Txt>} /> : null}
          </ListSection>

          <ListSection title="Sign-in methods">
            <Row icon={EnvelopeSimpleIcon} title={d.email} detail="Email code: Cowork sends a one-time code to this address" right={<View accessible accessibilityLabel="Verified"><CheckCircleIcon size={22} color={color.accent} weight="fill" /></View>} />
          </ListSection>

          <View>
            <ListSection title="Time zone">
              <Row
                icon={GlobeHemisphereEastIcon}
                title={d.timezone}
                detail={d.timezone === phoneTz ? "Matches this phone" : `This phone is set to ${phoneTz}`}
                right={d.timezone === phoneTz ? undefined : <Button label="Use phone's" compact variant="ghost" loading={setTz.isPending} onPress={() => setTz.mutate()} />}
              />
            </ListSection>
            {tzNote ? (
              <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, color: tzNote.ok ? color.success : color.danger }}>
                {tzNote.text}
              </Txt>
            ) : null}
          </View>
        </ScrollView>
      )}
      <EditSheet field={editing} initial={editing ? (editing === "name" ? (d?.name ?? "") : (d?.bio ?? "")) : ""} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function Value({ text, chevron }: { text: string; chevron: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, maxWidth: 200 }}>
      <Txt variant="small" numberOfLines={1}>
        {text}
      </Txt>
      {chevron}
    </View>
  );
}

/** Edit one field; saves to your account (PATCH /api/mobile/me), with validation errors from the server. */
function EditSheet({ field, initial, onClose }: { field: Field | null; initial: string; onClose: () => void }) {
  return (
    <Sheet open={field !== null} onClose={onClose} title={field ? `Edit ${FIELD[field].title.toLowerCase()}` : undefined}>
      {/* Mounted per opening, so the field starts from the saved value. */}
      {field ? <EditForm key={field} field={field} initial={initial} onClose={onClose} /> : null}
    </Sheet>
  );
}

function EditForm({ field, initial, onClose }: { field: Field; initial: string; onClose: () => void }) {
  const qc = useQueryClient();
  const meta = FIELD[field];
  const [value, setValue] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ ok: true }>("/api/mobile/me", { method: "PATCH", body: { [field]: value.trim() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
      onClose();
    },
    onError: (err) => setError(errorText(err)),
  });
  const trimmed = value.trim();
  const invalid = field === "name" && !trimmed;
  return (
    <View style={{ gap: space.md }}>
      <Input
        label={meta.label}
        value={value}
        onChangeText={(t) => {
          setValue(t);
          setError(null);
        }}
        maxLength={meta.max}
        multiline={meta.multiline}
        autoFocus
        placeholder={meta.placeholder}
        error={error}
        style={meta.multiline ? { minHeight: 96, paddingTop: space.md, textAlignVertical: "top" } : undefined}
      />
      <Txt variant="small" style={{ alignSelf: "flex-end" }}>{`${value.length} / ${meta.max}`}</Txt>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" style={{ flex: 1 }} onPress={onClose} />
        <Button label="Save" variant="primary" style={{ flex: 1 }} loading={save.isPending} disabled={invalid || trimmed === initial.trim()} onPress={() => save.mutate()} />
      </View>
    </View>
  );
}
