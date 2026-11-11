import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SparkleIcon, TrashIcon, VideoCameraIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Card, ErrorState, IconButton, Input, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { ProposalCard } from "@/features/chat/components";
import { clock } from "@/features/home/format";
import { BackHeader } from "@/features/home/header";
import { dayLabel, ymd } from "@/features/tasks/dates";
import { api, errorText } from "@/lib/api";
import { knowledgeKeys, useMeeting, type MeetingDetail } from "@/lib/knowledge";
import { keys } from "@/lib/queries";
import { color, space, TOUCH } from "@/theme/tokens";

/**
 * Notes for one calendar meeting: write them, get a summary with action items (each one an
 * approval card, nothing runs on its own), or delete them. Same data as the website's meeting notes.
 */
export default function MeetingScreen() {
  const params = useLocalSearchParams<{ id: string; at?: string }>();
  const eventId = params.id;
  const meeting = useMeeting(eventId, params.at);

  let body: React.ReactNode;
  if (meeting.isPending) body = <Skeleton rows={4} height={64} />;
  else if (meeting.isError && !meeting.data) body = <ErrorState message={errorText(meeting.error)} onRetry={() => void meeting.refetch()} />;
  else if (!meeting.data.event) {
    const why =
      meeting.data.calendar === "not_connected"
        ? "Google Calendar isn't connected, so this meeting can't be looked up."
        : meeting.data.calendar === "error"
          ? "Your calendar couldn't be read just now. Try again in a minute."
          : "This meeting isn't on your calendar anymore.";
    body = <ErrorState message={why} onRetry={meeting.data.calendar === "error" ? () => void meeting.refetch() : undefined} />;
  } else body = <MeetingBody key={eventId} eventId={eventId} at={params.at ?? meeting.data.event.start} data={meeting.data} />;

  return (
    <Screen edges={["top", "bottom"]}>
      <BackHeader title="Meeting notes" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.lg }}>
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function MeetingBody({ eventId, at, data }: { eventId: string; at: string; data: MeetingDetail }) {
  const qc = useQueryClient();
  const event = data.event!;
  const note = data.note;
  const [text, setText] = React.useState(note?.notes ?? "");
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: knowledgeKeys.meeting(eventId) });
    void qc.invalidateQueries({ queryKey: ["schedule"] });
  };

  const save = useMutation({
    mutationFn: () => api<{ ok: true; savedAt: string }>("/api/mobile/meetings", { method: "PUT", body: { eventId, at, notes: text } }),
    onSuccess: () => {
      setNotice({ kind: "ok", text: "Notes saved." });
      refresh();
    },
    onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
  });
  const summarize = useMutation({
    mutationFn: async () => {
      // Summarize what is on screen: save first when there are unsaved edits.
      if (text !== (note?.notes ?? "")) await api("/api/mobile/meetings", { method: "PUT", body: { eventId, at, notes: text } });
      return api<{ ok: true }>("/api/mobile/meetings/summarize", { body: { eventId } });
    },
    onSuccess: () => {
      setNotice({ kind: "ok", text: "Summary ready. Action items wait for your approval." });
      refresh();
      void qc.invalidateQueries({ queryKey: keys.approvals });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
  });
  const del = useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/mobile/meetings?eventId=${encodeURIComponent(eventId)}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(false);
      setText("");
      setNotice({ kind: "ok", text: "Notes deleted." });
      refresh();
      void qc.invalidateQueries({ queryKey: keys.approvals });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (err) => {
      setConfirmDelete(false);
      setNotice({ kind: "error", text: errorText(err) });
    },
  });

  const start = clock(event.start);
  const end = event.end ? clock(event.end) : null;
  const when = `${dayLabel(ymd(new Date(event.start)))}${start ? `, ${start}${end ? ` to ${end}` : ""}` : ""}`;
  const dirty = text !== (note?.notes ?? "");
  const busy = save.isPending || summarize.isPending || del.isPending;

  return (
    <>
      <View style={{ gap: space.xs }}>
        <Txt variant="heading">{event.title}</Txt>
        <Txt variant="small">
          {when}
          {event.attendees > 1 ? `, ${event.attendees} people` : ""}
        </Txt>
        {event.meetingUrl ? (
          <Button
            label="Join call"
            icon={VideoCameraIcon}
            compact
            style={{ alignSelf: "flex-start", minHeight: TOUCH, marginTop: space.sm }}
            onPress={() => void WebBrowser.openBrowserAsync(event.meetingUrl!).catch(() => {})}
          />
        ) : null}
      </View>

      <Input
        label="Notes"
        value={text}
        onChangeText={setText}
        maxLength={20_000}
        multiline
        placeholder="What was discussed, decided and who does what."
        style={{ minHeight: 180, paddingTop: space.md, textAlignVertical: "top" }}
      />

      <View style={{ gap: space.sm }}>
        {notice ? (
          <Txt variant="small" style={{ color: notice.kind === "error" ? color.danger : color.success }} accessibilityLiveRegion="polite">
            {notice.text}
          </Txt>
        ) : null}
        <Button label="Save notes" variant="primary" loading={save.isPending} disabled={!dirty || busy} onPress={() => save.mutate()} />
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <Button
            label={note?.summary ? "Summarize again" : "Summarize"}
            icon={SparkleIcon}
            compact
            style={{ flex: 1, minHeight: TOUCH }}
            loading={summarize.isPending}
            disabled={text.trim().length < 20 || busy}
            onPress={() => summarize.mutate()}
          />
          {note ? <IconButton icon={TrashIcon} label="Delete meeting notes" onPress={() => setConfirmDelete(true)} /> : null}
        </View>
        {text.trim().length < 20 ? <Txt variant="small">Write a few lines to get a summary and action items.</Txt> : null}
      </View>

      {note?.summary ? (
        <View>
          <SectionHeader title="Summary" />
          <Card style={{ gap: space.md }}>
            <Txt selectable>{note.summary}</Txt>
            {note.decisions.length ? (
              <View style={{ gap: space.xs }}>
                <Txt variant="label">Decisions</Txt>
                {note.decisions.map((d) => (
                  <Txt key={d} variant="small" selectable>
                    {`- ${d}`}
                  </Txt>
                ))}
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}

      {note?.items.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Action items" />
          {note.items.map((i, n) =>
            i.proposal ? (
              <ProposalCard key={i.proposal.id} proposal={{ id: i.proposal.id, label: i.proposal.label, summary: i.proposal.summary, status: i.proposal.status }} onStatus={refresh} />
            ) : (
              <Card key={`${i.title}-${n}`}>
                <Txt>{i.title}</Txt>
                {i.owner || i.due ? <Txt variant="small">{[i.owner, i.due ? `Due ${i.due}` : null].filter(Boolean).join(", ")}</Txt> : null}
              </Card>
            ),
          )}
        </View>
      ) : null}

      <ConfirmSheet
        open={confirmDelete}
        title="Delete these notes?"
        body="The notes and summary are deleted, and action items still waiting for approval are dismissed. This can't be undone."
        confirmLabel="Delete notes"
        destructive
        busy={del.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => !del.isPending && del.mutate()}
      />
    </>
  );
}
