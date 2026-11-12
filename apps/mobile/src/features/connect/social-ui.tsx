import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import * as React from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, ErrorState, Input, Skeleton, Txt } from "@/components/ui";
import { errorText } from "@/lib/api";
import { color, font, radius, space } from "@/theme/tokens";
import { useReport, type ReportKind, type ReportReason } from "./social-api";
import { connectAccent } from "./theme";

/** Horizontal set of rounded-rectangle choices (tabs, RSVP answers, poll kinds). Never pills. */
export function Choices<T extends string>({ value, options, onChange, scroll }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; scroll?: boolean }) {
  const items = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={o.value}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={o.label}
        onPress={() => onChange(o.value)}
        style={({ pressed }) => ({
          minHeight: 40,
          paddingHorizontal: space.md,
          borderRadius: radius.control,
          borderWidth: 1,
          borderColor: on ? connectAccent.main : color.borderStrong,
          backgroundColor: on ? connectAccent.main : color.surface2,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Txt variant="label" style={{ color: on ? connectAccent.onMain : color.text, fontFamily: font.semibold }}>
          {o.label}
        </Txt>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {items}
      </ScrollView>
    );
  }
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{items}</View>;
}

/** Loading and error states for a query, then the content. */
export function Loaded<T>({ q, children, rows = 3 }: { q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => React.ReactNode; rows?: number }) {
  if (q.isLoading) return <Skeleton rows={rows} />;
  if (q.error || q.data === undefined) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />;
  return <>{children(q.data)}</>;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Android date then time dialogs. Resolves null if either is dismissed. */
export function pickDateTime(initial: Date): Promise<Date | null> {
  if (Platform.OS !== "android") return Promise.resolve(initial);
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value: initial,
      mode: "date",
      minimumDate: new Date(),
      onChange: (e, date) => {
        if (e.type !== "set" || !date) return resolve(null);
        DateTimePickerAndroid.open({
          value: date,
          mode: "time",
          onChange: (e2, time) => {
            if (e2.type !== "set" || !time) return resolve(null);
            const out = new Date(date);
            out.setHours(time.getHours(), time.getMinutes(), 0, 0);
            resolve(out);
          },
        });
      },
    });
  });
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "hate", label: "Hate" },
  { value: "sexual", label: "Sexual content" },
  { value: "violence", label: "Violence" },
  { value: "self_harm", label: "Self-harm" },
  { value: "impersonation", label: "Pretending to be someone" },
  { value: "other", label: "Something else" },
];

/** Report sheet: stores a report for Cowork's admin to review. */
type ReportTarget = { kind: ReportKind; id: string; label: string };

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(target)} onClose={onClose} title={`Report ${target?.label ?? ""}`}>
      {/* Keyed by target, so each report starts empty. */}
      {target ? <ReportForm key={`${target.kind}:${target.id}`} target={target} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ReportForm({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const report = useReport();
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [note, setNote] = React.useState("");
  const [done, setDone] = React.useState<string | null>(null);
  return (
    <>
      {done ? (
        <>
          <Txt variant="bodyMuted">{done}</Txt>
          <Button label="Close" onPress={onClose} />
        </>
      ) : (
        <>
          <Txt variant="small">Reports go to Cowork for review. The person is not told who reported them.</Txt>
          <Choices value={reason} options={REASONS} onChange={setReason} />
          <Input value={note} onChangeText={setNote} placeholder="Anything we should know (optional)" maxLength={500} multiline accessibilityLabel="Note" />
          {report.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(report.error)}</Txt> : null}
          <Button
            label="Send report"
            variant="primary"
            disabled={!reason}
            loading={report.isPending}
            onPress={() => {
              if (!reason) return;
              report.mutate({ targetKind: target.kind, targetId: target.id, reason, note: note.trim() || undefined }, { onSuccess: (r) => setDone(r.message) });
            }}
          />
        </>
      )}
    </>
  );
}
