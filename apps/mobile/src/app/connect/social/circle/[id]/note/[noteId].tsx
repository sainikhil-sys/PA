import { router, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { Alert, ScrollView, View } from "react-native";
import { Button, Card, Input, Screen, Txt } from "@/components/ui";
import { useNote, useNoteActions, type Note } from "@/features/connect/social-api";
import { formatWhen, Loaded, ReportSheet } from "@/features/connect/social-ui";
import { SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/**
 * A shared circle note. Saving sends the version this edit started from. If someone saved in between,
 * the server refuses (409) and returns their version: both are shown and the person chooses what to keep.
 */
export default function NoteScreen() {
  const { id: circleId, noteId } = useLocalSearchParams<{ id: string; noteId: string }>();
  const isNew = noteId === "new";
  const note = useNote(circleId, noteId, !isNew);
  if (isNew) return <NoteEditor circleId={circleId} noteId={noteId} initial={null} />;
  // The editor takes the server copy once; after that it owns the text until it is saved.
  if (note.data) return <NoteEditor key={note.data.id} circleId={circleId} noteId={noteId} initial={note.data} />;
  return (
    <Screen>
      <SubHeader title="Note" />
      <View style={{ padding: space.lg }}>
        <Loaded q={note}>{() => null}</Loaded>
      </View>
    </Screen>
  );
}

function NoteEditor({ circleId, noteId, initial }: { circleId: string; noteId: string; initial: Note | null }) {
  const isNew = initial === null;
  const a = useNoteActions(circleId);
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [base, setBase] = React.useState<Note | null>(initial);
  const [conflict, setConflict] = React.useState<{ latest: Note; message: string } | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [reportOpen, setReportOpen] = React.useState(false);

  const dirty = isNew ? Boolean(title.trim() || body) : Boolean(base && (title !== base.title || body !== base.body));

  const save = () => {
    if (isNew) {
      a.create.mutate({ title: title.trim(), body }, { onSuccess: (r) => router.replace(`/connect/social/circle/${circleId}/note/${r.id}`) });
      return;
    }
    if (!base) return;
    a.save.mutate(
      { noteId, title: title.trim(), body, version: conflict ? conflict.latest.version : base.version },
      {
        onSuccess: (r) => {
          if (r.kind === "saved") {
            setBase(r.note);
            setConflict(null);
            setSavedAt(r.note.updatedAt);
          } else {
            setConflict({ latest: r.latest, message: r.message });
          }
        },
      },
    );
  };

  const error = a.save.error ?? a.create.error;

  return (
    <Screen>
      <SubHeader title={isNew ? "New note" : "Note"} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>

        {conflict ? (
          <Card style={{ gap: space.sm, borderColor: color.warning }}>
            <Txt variant="label">{conflict.message}</Txt>
            <Txt variant="small">
              Latest version {conflict.latest.version}
              {conflict.latest.updatedBy ? ` by ${conflict.latest.updatedBy}` : ""}, {formatWhen(conflict.latest.updatedAt)}:
            </Txt>
            <Txt variant="caption">{conflict.latest.title}</Txt>
            <Txt selectable style={{ color: color.muted }}>
              {conflict.latest.body || "(empty)"}
            </Txt>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Button
                label="Use theirs"
                compact
                onPress={() => {
                  setBase(conflict.latest);
                  setTitle(conflict.latest.title);
                  setBody(conflict.latest.body);
                  setConflict(null);
                }}
              />
              <Button label="Keep mine and save" compact variant="primary" loading={a.save.isPending} onPress={save} />
            </View>
            <Txt variant="small">To combine them, copy what you need from their version into yours, then save.</Txt>
          </Card>
        ) : null}

        <Input label="Title" value={title} onChangeText={setTitle} maxLength={120} />
        <Input label="Note" value={body} onChangeText={setBody} maxLength={20000} multiline style={{ minHeight: 240, textAlignVertical: "top", paddingTop: space.md }} />
        {base ? (
          <Txt variant="small">
            Version {base.version}
            {base.updatedBy ? ` · Last edit by ${base.updatedBy}` : ""}
            {savedAt ? " · Saved" : ""}
          </Txt>
        ) : null}
        {error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(error)}</Txt> : null}
        <Button label={isNew ? "Create note" : "Save"} variant="primary" disabled={!title.trim() || !dirty || Boolean(conflict)} loading={a.save.isPending || a.create.isPending} onPress={save} />
        {!isNew && base ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label="Delete note"
              variant="danger"
              compact
              style={{ flex: 1 }}
              onPress={() =>
                Alert.alert("Delete this note?", "It is deleted for everyone in the circle.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => a.remove.mutate(noteId, { onSuccess: () => router.back() }) },
                ])
              }
            />
            <Button label="Report" variant="ghost" compact style={{ flex: 1 }} onPress={() => setReportOpen(true)} />
          </View>
        ) : null}
        {a.remove.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.remove.error)}</Txt> : null}
      </ScrollView>
      <ReportSheet target={reportOpen ? { kind: "note", id: noteId, label: "note" } : null} onClose={() => setReportOpen(false)} />
    </Screen>
  );
}
