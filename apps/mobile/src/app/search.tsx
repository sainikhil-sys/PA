import { router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { BrainIcon, ChatCircleIcon, CheckSquareIcon, FileTextIcon, LinkSimpleIcon, MagnifyingGlassIcon, NotebookIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { EmptyState, ErrorState, Input, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { dayLabel } from "@/features/tasks/dates";
import { errorText } from "@/lib/api";
import { useSearch } from "@/lib/knowledge";
import { color, space, TOUCH } from "@/theme/tokens";

/** One search box over chats, tasks, notes, documents and memories (keyword match). */
export default function SearchScreen() {
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useSearch(q);
  const r = search.data;
  const total = r ? r.chats.length + r.tasks.length + r.notes.length + r.documents.length + r.memories.length : 0;

  let body: React.ReactNode;
  if (q.length < 2) body = <EmptyState icon={MagnifyingGlassIcon} title="Search everything" body="Find chats, tasks, notes, documents and memories by a word they contain." />;
  else if (search.isPending) body = <Skeleton rows={5} height={52} />;
  else if (search.isError && !r) body = <ErrorState message={errorText(search.error)} onRetry={() => void search.refetch()} />;
  else if (r && total === 0) body = <EmptyState icon={MagnifyingGlassIcon} title="No matches" body={`Nothing matches "${r.q}".`} />;
  else if (r) {
    body = (
      <View style={{ gap: space.lg, opacity: search.isFetching && r.q !== q ? 0.6 : 1 }}>
        <Group title="Chats" items={r.chats.map((c) => ({ key: c.id, icon: ChatCircleIcon, title: c.title, to: `/chat/${c.id}` as Href }))} />
        <Group
          title="Tasks"
          items={r.tasks.map((t) => ({ key: t.id, icon: CheckSquareIcon, title: t.title, detail: t.done ? "Done" : t.dueDate ? `Due ${dayLabel(t.dueDate)}` : null, to: `/task/${t.id}` as Href }))}
        />
        <Group title="Notes" items={r.notes.map((n) => ({ key: n.id, icon: n.bookmark ? LinkSimpleIcon : NotebookIcon, title: n.title, to: `/notes/${n.id}` as Href }))} />
        <Group
          title="Documents"
          items={r.documents.map((d) => ({
            key: d.id,
            icon: FileTextIcon,
            title: d.title,
            onPress: d.url ? () => void WebBrowser.openBrowserAsync(d.url!).catch(() => {}) : () => router.push("/settings/documents"),
          }))}
        />
        <Group title="Memories" items={r.memories.map((m) => ({ key: m.id, icon: BrainIcon, title: m.content, to: "/settings/memory" as Href }))} />
      </View>
    );
  }

  return (
    <Screen>
      <BackHeader title="Search" />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Input placeholder="Search" value={text} onChangeText={setText} autoFocus returnKeyType="search" autoCorrect={false} accessibilityLabel="Search chats, tasks, notes, documents and memories" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}>
        {body}
      </ScrollView>
    </Screen>
  );
}

type Item = { key: string; icon: Icon; title: string; detail?: string | null; to?: Href; onPress?: () => void };

function Group({ title, items }: { title: string; items: Item[] }) {
  if (!items.length) return null;
  return (
    <View>
      <SectionHeader title={title} />
      {items.map((i) => (
        <Pressable
          key={i.key}
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${i.title}${i.detail ? `. ${i.detail}` : ""}`}
          onPress={i.onPress ?? (() => i.to && router.push(i.to))}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingVertical: space.sm, backgroundColor: pressed ? color.surface2 : undefined })}
        >
          <i.icon size={18} color={color.muted} />
          <View style={{ flex: 1 }}>
            <Txt variant="label" numberOfLines={2}>
              {i.title}
            </Txt>
            {i.detail ? <Txt variant="small">{i.detail}</Txt> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
