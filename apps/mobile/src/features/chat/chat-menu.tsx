import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { PencilSimpleIcon, TrashIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Input, Row, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { keys } from "@/lib/queries";
import { color, space } from "@/theme/tokens";

/** Rename or delete one chat (PATCH and DELETE /api/chat/conversations?id=). */
export function ChatMenu({ open, onClose, conversationId, title }: { open: boolean; onClose: () => void; conversationId: string; title: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = React.useState(title);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode("menu");
    setName(title);
    setError(null);
  }, [open, title]);

  const rename = useMutation({
    mutationFn: (t: string) => api<{ ok: true }>(`/api/chat/conversations?id=${conversationId}`, { method: "PATCH", body: { title: t } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.conversation(conversationId) });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
    },
    onError: (err) => setError(errorText(err)),
  });

  const remove = useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/chat/conversations?id=${conversationId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.conversation(conversationId) });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: keys.approvals });
      void qc.invalidateQueries({ queryKey: keys.me });
      onClose();
      router.replace("/assistant");
    },
    onError: (err) => {
      setMode("menu");
      setError(errorText(err));
    },
  });

  const saveName = () => {
    const t = name.trim();
    if (t && t !== title && !rename.isPending) rename.mutate(t);
  };

  if (mode === "delete") {
    return (
      <ConfirmSheet
        open={open}
        title="Delete this chat?"
        body="The chat and its messages are deleted, and actions it proposed that are still waiting are dismissed. Memories saved from it stay. This can't be undone."
        confirmLabel="Delete chat"
        destructive
        busy={remove.isPending}
        onConfirm={() => !remove.isPending && remove.mutate()}
        onClose={() => !remove.isPending && setMode("menu")}
      />
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === "rename" ? "Rename chat" : "Chat options"}>
      {error ? (
        <Txt variant="small" style={{ color: color.danger, marginBottom: space.sm }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      {mode === "rename" ? (
        <View style={{ gap: space.md }}>
          <Input label="Name" value={name} onChangeText={setName} maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={saveName} />
          <Button label="Save name" variant="primary" loading={rename.isPending} disabled={!name.trim() || name.trim() === title} onPress={saveName} />
        </View>
      ) : (
        <View>
          <Row icon={PencilSimpleIcon} title="Rename" onPress={() => setMode("rename")} />
          <Row icon={TrashIcon} title="Delete chat" danger onPress={() => setMode("delete")} />
        </View>
      )}
    </Sheet>
  );
}
