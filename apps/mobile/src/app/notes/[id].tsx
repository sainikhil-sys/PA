import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ArrowClockwiseIcon, ArrowSquareOutIcon, PushPinIcon, PushPinSlashIcon, TrashIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Card, ErrorState, IconButton, Input, Screen, Skeleton, Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { api, ApiError, errorText } from "@/lib/api";
import { useInvalidateNotes, useNote, useSaveNote, type NoteDetail } from "@/lib/knowledge";
import { goBackOr } from "@/lib/nav";
import { color, space, TOUCH } from "@/theme/tokens";

const parseTags = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

/** One note or saved link: read, edit, pin, delete. "new" writes a new note. */
export default function NoteScreen() {
  const params = useLocalSearchParams<{ id: string; notice?: string }>();
  const isNew = params.id === "new";
  const note = useNote(isNew ? undefined : params.id);

  let body: React.ReactNode;
  if (isNew) body = <NoteEditor note={null} notice={null} />;
  else if (note.isPending) body = <Skeleton rows={4} height={64} />;
  else if (note.isError && !note.data) {
    const gone = note.error instanceof ApiError && note.error.status === 404;
    body = gone ? (
      <ErrorState message="This note no longer exists." />
    ) : (
      <ErrorState message={errorText(note.error)} onRetry={() => void note.refetch()} />
    );
  } else body = <NoteEditor key={note.data.id} note={note.data} notice={params.notice ?? null} />;

  return (
    <Screen edges={["top", "bottom"]}>
      <BackHeader title={isNew ? "New note" : note.data?.url ? "Link" : "Note"} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.lg }}>
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function NoteEditor({ note, notice: initialNotice }: { note: NoteDetail | null; notice: string | null }) {
  const save = useSaveNote();
  const invalidate = useInvalidateNotes();
  const [title, setTitle] = React.useState(note?.title ?? "");
  const [content, setContent] = React.useState(note?.content ?? "");
  const [tags, setTags] = React.useState((note?.tags ?? []).join(", "));
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(initialNotice ? { kind: "ok", text: initialNotice } : null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const saving = React.useRef(false);

  const dirty = !note || title !== note.title || content !== note.content || parseTags(tags).join(",") !== note.tags.join(",");

  const onSave = () => {
    if (!title.trim() || saving.current) return;
    saving.current = true;
    setNotice(null);
    save.mutate(
      { id: note?.id, title: title.trim(), content, tags: parseTags(tags) },
      {
        onSettled: () => {
          saving.current = false;
        },
        onSuccess: (r) => {
          if (!note) router.replace(`/notes/${r.id}`);
          else setNotice({ kind: "ok", text: "Saved." });
        },
        onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
      },
    );
  };

  const pin = useMutation({
    mutationFn: (pinned: boolean) => api<{ ok: true }>(`/api/mobile/notes/${note!.id}`, { method: "PATCH", body: { pinned } }),
    onSuccess: () => invalidate(note!.id),
    onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
  });
  const refresh = useMutation({
    mutationFn: () => api<{ ok: true; title: string; description: string | null }>(`/api/mobile/notes/${note!.id}/refresh`, { method: "POST" }),
    onSuccess: () => {
      invalidate(note!.id);
      setNotice({ kind: "ok", text: "Page details updated." });
    },
    onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
  });
  const del = useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/mobile/notes/${note!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(false);
      invalidate();
      goBackOr("/notes");
    },
    onError: (err) => {
      setConfirmDelete(false);
      setNotice({ kind: "error", text: errorText(err) });
    },
  });

  return (
    <>
      {note?.url ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="small" numberOfLines={2} selectable>
            {note.url}
          </Txt>
          {note.linkDescription ? <Txt selectable>{note.linkDescription}</Txt> : null}
          {!note.linkFetchedAt ? <Txt variant="small">{"The page's title and description haven't been fetched."}</Txt> : null}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button label="Open" icon={ArrowSquareOutIcon} compact style={{ minHeight: TOUCH }} onPress={() => void WebBrowser.openBrowserAsync(note.url!).catch(() => {})} />
            <Button label="Fetch details again" icon={ArrowClockwiseIcon} compact variant="ghost" style={{ minHeight: TOUCH }} loading={refresh.isPending} onPress={() => refresh.mutate()} />
          </View>
        </Card>
      ) : null}

      <Input label="Title" value={title} onChangeText={setTitle} maxLength={200} placeholder="A short title" autoFocus={!note} />
      <Input
        label={note?.url ? "Your notes on this link" : "Note"}
        value={content}
        onChangeText={setContent}
        maxLength={50_000}
        multiline
        placeholder="Write anything. Markdown works."
        style={{ minHeight: 200, paddingTop: space.md, textAlignVertical: "top" }}
      />
      <Input label="Tags" value={tags} onChangeText={setTags} autoCapitalize="none" autoCorrect={false} placeholder="work, ideas" />

      <View style={{ gap: space.sm }}>
        {notice ? (
          <Txt variant="small" style={{ color: notice.kind === "error" ? color.danger : color.success }} accessibilityLiveRegion="polite">
            {notice.text}
          </Txt>
        ) : null}
        <Button label={note ? "Save changes" : "Save note"} variant="primary" loading={save.isPending} disabled={!title.trim() || !dirty} onPress={onSave} />
      </View>

      {note ? (
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <Button
            label={note.pinned ? "Unpin" : "Pin to top"}
            icon={note.pinned ? PushPinSlashIcon : PushPinIcon}
            compact
            style={{ flex: 1, minHeight: TOUCH }}
            loading={pin.isPending}
            onPress={() => pin.mutate(!note.pinned)}
          />
          <IconButton icon={TrashIcon} label="Delete note" onPress={() => setConfirmDelete(true)} />
        </View>
      ) : null}

      {note ? (
        <ConfirmSheet
          open={confirmDelete}
          title="Delete this note?"
          body={`"${note.title}" will be deleted, and chat will stop finding it. This can't be undone.`}
          confirmLabel="Delete note"
          destructive
          busy={del.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => !del.isPending && del.mutate()}
        />
      ) : null}
    </>
  );
}
