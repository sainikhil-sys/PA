import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrainIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, EmptyState, ErrorState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { MEMORY_KINDS, MemorySheet, type MemoryForm } from "@/features/settings/memory-sheet";
import { refresh, SubHeader, timeAgo } from "@/features/settings/parts";
import { api, errorText } from "@/lib/api";
import { keys, useMemories } from "@/lib/queries";
import type { Memory } from "@/lib/types";
import { color, radius, space } from "@/theme/tokens";

const kindLabel = (k: string) => MEMORY_KINDS.find((m) => m.value === k)?.label ?? k.charAt(0).toUpperCase() + k.slice(1);

/** What the agent remembers about you: add, correct or forget each item. */
export default function MemoryScreen() {
  const q = useMemories();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<{ mode: "add" } | { mode: "edit"; memory: Memory } | null>(null);
  const [removing, setRemoving] = React.useState<Memory | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  // A fast double tap on Save would otherwise POST the same memory twice.
  const savingRef = React.useRef(false);

  const save = useMutation({
    mutationFn: (v: MemoryForm) =>
      editing?.mode === "edit"
        ? api<{ ok: true }>(`/api/mobile/memories/${editing.memory.id}`, { method: "PATCH", body: { content: v.content } })
        : api<{ ok: true; id: string }>("/api/mobile/memories", { method: "POST", body: { content: v.content, kind: v.kind } }),
    onSuccess: () => setEditing(null),
    // Also on failure: a 404 means the memory was removed elsewhere, so the list should catch up.
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.memories }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/mobile/memories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      setNotice(null);
      void qc.invalidateQueries({ queryKey: keys.memories });
    },
    onError: (err) => {
      setRemoving(null);
      setNotice(errorText(err));
    },
  });

  // Stable identity: the sheet resets its form whenever `initial` changes.
  const initial = React.useMemo(() => (editing?.mode === "edit" ? { content: editing.memory.content, kind: editing.memory.kind } : undefined), [editing]);

  const open = (next: typeof editing) => {
    save.reset();
    setEditing(next);
  };

  const intro = (
    <View style={{ gap: space.md, paddingBottom: space.lg }}>
      <Txt variant="bodyMuted">
        Your agent uses these to personalize its answers. Your chats are separate: they are not saved here unless you or your agent add something.
      </Txt>
      {notice ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {notice}
        </Txt>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <SubHeader title="Memory" right={q.data?.length ? <IconButton icon={PlusIcon} label="Add a memory" onPress={() => open({ mode: "add" })} /> : null} />
      {q.isPending ? (
        <View style={{ padding: space.lg, gap: space.lg }}>
          {intro}
          <Skeleton rows={4} height={72} />
        </View>
      ) : q.isError ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.sm }}
          refreshControl={refresh(q.isRefetching, () => void q.refetch())}
          ListHeaderComponent={intro}
          ListEmptyComponent={
            <EmptyState
              icon={BrainIcon}
              title="Nothing remembered yet"
              body="Add something your agent should keep in mind, like how you like your mornings planned."
              action={<Button label="Add a memory" variant="primary" icon={PlusIcon} onPress={() => open({ mode: "add" })} />}
            />
          }
          renderItem={({ item }) => (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, padding: space.lg, paddingRight: space.sm }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Txt variant="body">{item.content}</Txt>
                <Txt variant="small">
                  {kindLabel(item.kind)}, {timeAgo(item.updatedAt).toLowerCase()}
                </Txt>
              </View>
              <IconButton icon={PencilSimpleIcon} label="Edit memory" tone="plain" onPress={() => open({ mode: "edit", memory: item })} />
              <IconButton icon={TrashIcon} label="Forget memory" tone="plain" onPress={() => setRemoving(item)} />
            </View>
          )}
        />
      )}

      <MemorySheet
        open={editing !== null}
        mode={editing?.mode ?? "add"}
        initial={initial}
        busy={save.isPending}
        error={save.isError ? errorText(save.error) : null}
        onSubmit={(v) => {
          if (savingRef.current) return;
          savingRef.current = true;
          save.mutate(v, { onSettled: () => (savingRef.current = false) });
        }}
        onClose={() => setEditing(null)}
      />

      <ConfirmSheet
        open={removing !== null}
        title="Forget this memory"
        body={removing ? `Your agent will no longer use: "${removing.content}"` : ""}
        confirmLabel="Forget"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </Screen>
  );
}
