import { router, useLocalSearchParams } from "expo-router";
import { LinkSimpleIcon, NotePencilIcon, NotebookIcon, PushPinIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, Divider, EmptyState, ErrorState, Input, Screen, Skeleton, Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { relativeTime } from "@/features/home/format";
import { Segmented } from "@/features/tasks/components";
import { errorText } from "@/lib/api";
import { useNotes, useSaveBookmark, type NoteKind, type NoteRow } from "@/lib/knowledge";
import { color, space, TOUCH } from "@/theme/tokens";

const KINDS: { value: NoteKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "notes", label: "Notes" },
  { value: "bookmarks", label: "Links" },
];

/** Notes and saved links, the same store as Knowledge > Notes on the website. Chat can search them. */
export default function NotesScreen() {
  const [kind, setKind] = React.useState<NoteKind>("all");
  const [query, setQuery] = React.useState("");
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const notes = useNotes(kind, q);
  const [refreshing, setRefreshing] = React.useState(false);
  // Create > Save a link opens this screen with ?link=1 and the sheet already up.
  const params = useLocalSearchParams<{ link?: string }>();
  const [linkOpen, setLinkOpen] = React.useState(params.link === "1");

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await notes.refetch();
    setRefreshing(false);
  }, [notes]);

  return (
    <Screen>
      <BackHeader title="Notes" />
      <View style={{ paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md }}>
        <Input placeholder="Search notes and links" value={query} onChangeText={setQuery} returnKeyType="search" accessibilityLabel="Search notes and links" />
        <Segmented<NoteKind> label="Show" value={kind} onChange={setKind} options={KINDS} />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="New note" icon={NotePencilIcon} variant="primary" compact style={{ flex: 1, minHeight: TOUCH }} onPress={() => router.push("/notes/new")} />
          <Button label="Save a link" icon={LinkSimpleIcon} compact style={{ flex: 1, minHeight: TOUCH }} onPress={() => setLinkOpen(true)} />
        </View>
      </View>
      {notes.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={5} height={64} />
        </View>
      ) : notes.isError && !notes.data ? (
        <ErrorState message={errorText(notes.error)} onRetry={() => void notes.refetch()} />
      ) : (
        <FlatList
          data={notes.data}
          keyExtractor={(n) => n.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space.xxxl, flexGrow: 1 }}
          ItemSeparatorComponent={() => <Divider style={{ marginLeft: space.lg }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
          ListEmptyComponent={
            q ? (
              <EmptyState icon={NotebookIcon} title="No matches" body={`Nothing in your notes matches "${q}".`} />
            ) : (
              <EmptyState icon={NotebookIcon} title="No notes yet" body="Write a note or save a link. Your agent can search them when you ask in chat." />
            )
          }
          renderItem={({ item }) => <NoteItem note={item} />}
        />
      )}
      <SaveLinkSheet open={linkOpen} onClose={() => setLinkOpen(false)} />
    </Screen>
  );
}

function NoteItem({ note }: { note: NoteRow }) {
  const detail = note.url ? (note.linkDescription ?? note.host ?? note.url) : note.excerpt;
  const when = relativeTime(note.updatedAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${note.pinned ? "Pinned. " : ""}${note.url ? "Link. " : ""}${note.title}${when ? `. Edited ${when}` : ""}`}
      onPress={() => router.push(`/notes/${note.id}`)}
      style={({ pressed }) => ({ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: TOUCH, backgroundColor: pressed ? color.surface2 : undefined })}
    >
      <View style={{ paddingTop: 2 }}>{note.url ? <LinkSimpleIcon size={18} color={color.muted} /> : <NotebookIcon size={18} color={color.muted} />}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
          <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {note.title}
          </Txt>
          {note.pinned ? <PushPinIcon size={14} color={color.accent2} weight="fill" /> : null}
          <Txt variant="small">{when}</Txt>
        </View>
        {detail ? (
          <Txt variant="small" numberOfLines={2}>
            {detail}
          </Txt>
        ) : null}
        {note.tags.length ? (
          <Txt variant="small" numberOfLines={1} style={{ color: color.subtle }}>
            {note.tags.map((t) => `#${t}`).join("  ")}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Paste a web address; the server fetches its title and says when it couldn't. */
function SaveLinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Save a link">
      {/* Mounted only while open, so each opening starts with an empty field. */}
      {open ? <SaveLinkForm onClose={onClose} /> : null}
    </Sheet>
  );
}

function SaveLinkForm({ onClose }: { onClose: () => void }) {
  const save = useSaveBookmark();
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = () => {
    const value = url.trim();
    if (!value || save.isPending) return;
    setError(null);
    save.mutate(value, {
      onSuccess: (r) => {
        onClose();
        router.push({ pathname: "/notes/[id]", params: { id: r.id, ...(r.reason ? { notice: `Saved, but the page's details couldn't be fetched: ${r.reason}.` } : r.existed ? { notice: "You had already saved this link." } : {}) } });
      },
      onError: (err) => setError(errorText(err)),
    });
  };

  return (
    <View style={{ gap: space.md }}>
      <Input label="Web address" placeholder="https://" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" autoFocus returnKeyType="done" onSubmitEditing={submit} error={error} />
      <Button label="Save link" variant="primary" loading={save.isPending} disabled={!url.trim()} onPress={submit} />
    </View>
  );
}
