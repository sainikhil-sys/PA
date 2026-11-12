import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CheckCircleIcon, FileTextIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, EmptyState, ErrorState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { refresh, SubHeader, timeAgo } from "@/features/settings/parts";
import { checkFile, PICKER_TYPES, UploadError, uploadDocument, type PickedFile, type UploadResult } from "@/features/settings/upload";
import { api, errorText } from "@/lib/api";
import { keys, useDocuments } from "@/lib/queries";
import type { DocumentItem } from "@/lib/types";
import { color, radius, space } from "@/theme/tokens";

/** Deletes the picker's cached copy of a file. Never touches the person's original. */
function discardCopy(f: PickedFile) {
  try {
    const copy = new File(f.uri);
    if (copy.exists) copy.delete();
  } catch {
    // Already gone, or not a cache copy we can remove: nothing to clean up.
  }
}

type Upload =
  | { phase: "idle" }
  | { phase: "sending"; name: string; progress: number }
  | { phase: "reading"; name: string }
  | { phase: "done"; name: string; result: UploadResult }
  | { phase: "failed"; name: string; message: string; file: PickedFile | null; type: string | null };

const RESULT_TEXT: Record<UploadResult, string> = {
  created: "Added. Your agent can now search it.",
  updated: "Updated with the new version.",
  unchanged: "Already in your documents, nothing changed.",
  empty: "No readable text found in that file.",
};

function size(chars: number) {
  if (chars < 1000) return `${chars} characters`;
  return `${Math.round(chars / 1000).toLocaleString()}k characters`;
}

/** Documents your agent can search: upload PDF, DOCX, TXT or Markdown, or remove them. */
export default function DocumentsScreen() {
  const q = useDocuments();
  const qc = useQueryClient();
  const [upload, setUpload] = React.useState<Upload>({ phase: "idle" });
  const [removing, setRemoving] = React.useState<DocumentItem | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const abortRef = React.useRef<(() => void) | null>(null);
  // Guards against a double tap opening the picker or starting two uploads before state re-renders.
  const lockRef = React.useRef(false);
  const mounted = React.useRef(true);

  React.useEffect(
    () => () => {
      mounted.current = false;
      abortRef.current?.();
    },
    [],
  );

  const busy = upload.phase === "sending" || upload.phase === "reading";

  async function send(file: PickedFile, type: string) {
    if (lockRef.current) return;
    lockRef.current = true;
    setUpload({ phase: "sending", name: file.name, progress: 0 });
    const job = uploadDocument(file, type, {
      onProgress: (p) => setUpload((u) => (u.phase === "sending" ? { ...u, progress: p } : u)),
      onUploaded: () => setUpload({ phase: "reading", name: file.name }),
    });
    abortRef.current = job.abort;
    try {
      const result = await job.promise;
      discardCopy(file);
      setUpload({ phase: "done", name: file.name, result });
      void qc.invalidateQueries({ queryKey: keys.documents });
    } catch (err) {
      const retryable = err instanceof UploadError ? err.retryable : true;
      // The picker copied the file into the app's cache: keep the copy only while Retry can use it.
      if (!retryable || !mounted.current) discardCopy(file);
      if (!mounted.current) return;
      setUpload({ phase: "failed", name: file.name, message: err instanceof Error ? err.message : errorText(err), file: retryable ? file : null, type: retryable ? type : null });
    } finally {
      abortRef.current = null;
      lockRef.current = false;
    }
  }

  async function pick() {
    if (lockRef.current) return;
    lockRef.current = true;
    let res: DocumentPicker.DocumentPickerResult;
    try {
      res = await DocumentPicker.getDocumentAsync({ type: PICKER_TYPES, copyToCacheDirectory: true, multiple: false });
    } catch {
      setUpload({ phase: "failed", name: "", message: "Couldn't open your files. Try again.", file: null, type: null });
      return;
    } finally {
      lockRef.current = false;
    }
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const file: PickedFile = { uri: a.uri, name: a.name, size: a.size, mimeType: a.mimeType };
    const check = checkFile(file);
    if (!check.ok) {
      discardCopy(file);
      setUpload({ phase: "failed", name: a.name, message: check.message, file: null, type: null });
      return;
    }
    void send(file, check.type);
  }

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/mobile/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      setNotice(null);
      void qc.invalidateQueries({ queryKey: keys.documents });
    },
    onError: (err) => {
      setRemoving(null);
      setNotice(errorText(err));
    },
  });

  const status =
    upload.phase === "idle" ? null : (
      <View
        accessibilityLiveRegion="polite"
        style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: upload.phase === "failed" ? color.danger : color.border, padding: space.lg, gap: space.sm }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {upload.phase === "done" ? (
            <CheckCircleIcon size={20} color={color.success} />
          ) : upload.phase === "failed" ? (
            <WarningCircleIcon size={20} color={color.danger} />
          ) : (
            <ActivityIndicator color={color.accent} />
          )}
          <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {upload.name || "Upload"}
          </Txt>
        </View>
        {upload.phase === "sending" ? (
          <>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(upload.progress * 100) }}
              style={{ height: 6, borderRadius: 3, backgroundColor: color.surface3, overflow: "hidden" }}
            >
              <View style={{ width: `${Math.round(upload.progress * 100)}%`, height: 6, backgroundColor: color.accent }} />
            </View>
            <Txt variant="small">Uploading, {Math.round(upload.progress * 100)}%</Txt>
          </>
        ) : upload.phase === "reading" ? (
          <Txt variant="small">Reading the document. Long PDFs can take a minute.</Txt>
        ) : upload.phase === "done" ? (
          <Txt variant="small">{RESULT_TEXT[upload.result]}</Txt>
        ) : (
          <>
            <Txt variant="small">{upload.message}</Txt>
            {upload.file && upload.type ? (
              <Button label="Retry" style={{ alignSelf: "flex-start" }} onPress={() => upload.file && upload.type && void send(upload.file, upload.type)} />
            ) : null}
          </>
        )}
      </View>
    );

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.lg }}>
      <Txt variant="bodyMuted">Your agent searches these when it answers. Cowork keeps the text it reads, not the file itself. PDF, DOCX, TXT or Markdown, up to 4 MB.</Txt>
      {q.data?.length ? <Button label="Upload a document" variant="primary" icon={UploadSimpleIcon} loading={busy} onPress={() => void pick()} /> : null}
      {status}
      {notice ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {notice}
        </Txt>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <SubHeader title="Documents" />
      {q.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} height={64} />
        </View>
      ) : q.isError ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.sm }}
          refreshControl={refresh(q.isRefetching, () => void q.refetch())}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon={FileTextIcon}
              title="No documents yet"
              body="Upload a file and your agent can quote it when you ask."
              action={<Button label="Upload a document" variant="primary" icon={UploadSimpleIcon} loading={busy} onPress={() => void pick()} />}
            />
          }
          renderItem={({ item }) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm }}>
              <FileTextIcon size={20} color={color.muted} />
              <View style={{ flex: 1, paddingVertical: space.xs }}>
                <Txt variant="label" numberOfLines={2}>
                  {item.title}
                </Txt>
                <Txt variant="small">
                  {size(item.chars)}, {timeAgo(item.updatedAt).toLowerCase()}
                </Txt>
              </View>
              <IconButton icon={TrashIcon} label={`Remove ${item.title}`} tone="plain" onPress={() => setRemoving(item)} />
            </View>
          )}
        />
      )}

      <ConfirmSheet
        open={removing !== null}
        title="Remove document"
        body={removing ? `"${removing.title}" will be removed from your documents. Your agent won't be able to search it.` : ""}
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </Screen>
  );
}
