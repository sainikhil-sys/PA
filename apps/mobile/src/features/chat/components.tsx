import * as Clipboard from "expo-clipboard";
import { ArrowClockwiseIcon, ArrowUpIcon, BrainIcon, CheckIcon, CopyIcon, FlagIcon, InfoIcon, LinkIcon, MicrophoneIcon, StopIcon, WarningCircleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, IconButton, Input, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useDecide } from "@/lib/queries";
import type { ChatMemory, Citation } from "@/lib/types";
import { color, font, radius, space, TOUCH, type } from "@/theme/tokens";
import { Markdown, openLink } from "./markdown";
import type { AssistantItem, ChatProposal } from "./use-chat";

/** A small text action under a message (48dp tall). */
function MiniAction({ icon: IconCmp, label, onPress, accessibilityLabel, tint = color.muted }: { icon: Icon; label: string; onPress: () => void; accessibilityLabel?: string; tint?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs, opacity: pressed ? 0.7 : 1 })}
    >
      <IconCmp size={16} color={tint} />
      <Txt variant="small" style={{ color: tint }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** The user's own message, right aligned. Long press to edit it when the server has stored it. */
export function UserBubble({ text, onEdit }: { text: string; onEdit?: () => void }) {
  const bubble = { alignSelf: "flex-end" as const, maxWidth: "86%" as const, backgroundColor: color.surface2, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, paddingHorizontal: space.lg, paddingVertical: space.md };
  if (!onEdit) {
    return (
      <View style={bubble}>
        <Txt selectable>{text}</Txt>
      </View>
    );
  }
  return (
    <Pressable
      onLongPress={onEdit}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint="Long press to edit this message"
      accessibilityActions={[{ name: "edit", label: "Edit message" }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "edit" && onEdit()}
      style={({ pressed }) => [bubble, pressed ? { borderColor: color.borderStrong } : null]}
    >
      <Txt>{text}</Txt>
    </Pressable>
  );
}

/** A one-line note under an answer (a Cowork notice, a memory saved from the question). */
function NoteLine({ icon: IconCmp, text }: { icon: Icon; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
      <IconCmp size={16} color={color.muted} style={{ marginTop: 2 }} />
      <Txt variant="small" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

function memoryLine(m: ChatMemory): string {
  if (m.status === "exists") return `Already in memory: ${m.content}`;
  if (m.status === "updated") return `Memory updated: ${m.content}`;
  return `Saved to memory: ${m.content}`;
}

/** An inline error with Retry (failed turn, dropped connection, or a stopped answer). */
export function ErrorNotice({ message, onRetry, canRetry }: { message: string; onRetry: () => void; canRetry: boolean }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }}
    >
      <WarningCircleIcon size={18} color={color.danger} />
      <Txt variant="small" style={{ flex: 1, paddingVertical: space.md }}>
        {message}
      </Txt>
      {canRetry ? <MiniAction icon={ArrowClockwiseIcon} label="Retry" accessibilityLabel="Retry the last message" onPress={onRetry} tint={color.text} /> : null}
    </View>
  );
}

/** Numbered sources under an answer. Sources with a URL open in the in-app browser. */
function Sources({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <View style={{ gap: 2 }}>
      <Txt variant="caption" style={{ marginBottom: space.xs }}>
        Sources
      </Txt>
      {citations.map((c) => {
        const body = (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", minHeight: c.url ? TOUCH : 28 }}>
            <Text style={{ fontFamily: font.medium, fontSize: 12, color: color.accent2, minWidth: 18 }} maxFontSizeMultiplier={1.4}>
              {c.n}
            </Text>
            <Txt variant="small" numberOfLines={1} style={{ flex: 1, color: c.url ? color.text : color.muted }}>
              {c.title}
              {c.source ? <Text style={{ color: color.subtle }}>{`  ${c.source}`}</Text> : null}
            </Txt>
            {c.url ? <LinkIcon size={14} color={color.subtle} /> : null}
          </View>
        );
        return c.url ? (
          <Pressable key={c.n} accessibilityRole="link" accessibilityLabel={`Source ${c.n}: ${c.title}. Opens in browser.`} onPress={() => openLink(c.url!)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            {body}
          </Pressable>
        ) : (
          <View key={c.n} accessible accessibilityLabel={`Source ${c.n}: ${c.title}`}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const DONE_LABEL: Record<string, string> = { approved: "Approved", executed: "Done", dismissed: "Dismissed", failed: "Failed" };

/** A confirmation card for something the agent prepared. Nothing runs until Approve is confirmed. */
export function ProposalCard({ proposal, onStatus }: { proposal: ChatProposal; onStatus: (id: string, status: string) => void }) {
  const decide = useDecide();
  const [confirm, setConfirm] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const pending = proposal.status === "pending";

  const act = (action: "approve" | "dismiss") => {
    setErr(null);
    decide.mutate(
      { id: proposal.id, action },
      {
        onSuccess: (r) => {
          setConfirm(false);
          setNote(action === "approve" ? r.message : null);
          onStatus(proposal.id, action === "approve" ? "executed" : "dismissed");
        },
        onError: (e) => {
          setConfirm(false);
          setErr(errorText(e));
        },
      },
    );
  };

  return (
    <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: pending ? color.borderStrong : color.border, backgroundColor: color.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Txt variant="label" style={{ flex: 1 }}>
          {proposal.label}
        </Txt>
        {!pending ? (
          <Txt variant="small" style={{ color: proposal.status === "failed" ? color.danger : color.muted }}>
            {DONE_LABEL[proposal.status] ?? proposal.status}
          </Txt>
        ) : null}
      </View>
      <Txt variant="bodyMuted">{proposal.summary}</Txt>
      {note ? <Txt variant="small">{note}</Txt> : null}
      {err ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {err}
        </Txt>
      ) : null}
      {pending ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Approve" compact icon={CheckIcon} onPress={() => setConfirm(true)} disabled={decide.isPending} style={{ flex: 1, minHeight: TOUCH }} accessibilityLabel={`Approve: ${proposal.label}`} />
          <Button
            label="Dismiss"
            compact
            variant="ghost"
            loading={decide.isPending && decide.variables?.action === "dismiss"}
            disabled={decide.isPending}
            onPress={() => act("dismiss")}
            style={{ flex: 1, minHeight: TOUCH }}
            accessibilityLabel={`Dismiss: ${proposal.label}`}
          />
        </View>
      ) : null}
      <ConfirmSheet
        open={confirm}
        title={proposal.label}
        body={`${proposal.summary}\n\nThis runs as soon as you confirm.`}
        confirmLabel={proposal.label}
        busy={decide.isPending}
        onConfirm={() => act("approve")}
        onClose={() => setConfirm(false)}
      />
    </View>
  );
}

/** One assistant turn: live status, the answer, sources, proposals, then Copy and Report. */
export function AssistantMessage({
  item,
  isLast,
  onRetry,
  onRegenerate,
  onReport,
  onProposalStatus,
}: {
  item: AssistantItem;
  isLast: boolean;
  onRetry: () => void;
  /** Ask the question again; absent while another answer is being written. */
  onRegenerate?: () => void;
  onReport: (messageId: string) => void;
  onProposalStatus: (id: string, status: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const waiting = item.streaming && !item.text;
  return (
    <View style={{ gap: space.sm, paddingRight: space.sm }}>
      {waiting ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={color.accent} />
          <Txt variant="small">{item.status ?? "Thinking"}</Txt>
        </View>
      ) : null}
      {item.text ? <Markdown text={item.text} /> : null}
      {item.stopped && !item.streaming ? <NoteLine icon={StopIcon} text="Stopped before it finished." /> : null}
      {!item.streaming ? <Sources citations={item.citations} /> : null}
      {item.notices.map((n) => (
        <NoteLine key={n} icon={InfoIcon} text={n} />
      ))}
      {item.memories.map((m) => (
        <NoteLine key={m.id} icon={BrainIcon} text={memoryLine(m)} />
      ))}
      {item.proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} onStatus={onProposalStatus} />
      ))}
      {item.error ? <ErrorNotice message={item.error} onRetry={onRetry} canRetry={isLast} /> : null}
      {!item.streaming && item.text ? (
        <View style={{ flexDirection: "row", marginLeft: -space.sm }}>
          <MiniAction
            icon={copied ? CheckIcon : CopyIcon}
            label={copied ? "Copied" : "Copy"}
            accessibilityLabel={copied ? "Copied" : "Copy answer"}
            onPress={() => {
              void Clipboard.setStringAsync(item.text).then(() => setCopied(true), () => {});
            }}
          />
          {onRegenerate ? <MiniAction icon={ArrowClockwiseIcon} label="Ask again" accessibilityLabel="Ask the question again for a new answer" onPress={onRegenerate} /> : null}
          {item.id ? <MiniAction icon={FlagIcon} label="Report" accessibilityLabel="Report this response" onPress={() => onReport(item.id!)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const REASONS = [
  { value: "harmful", label: "Harmful or unsafe" },
  { value: "offensive", label: "Offensive" },
  { value: "inaccurate", label: "Inaccurate" },
  { value: "other", label: "Something else" },
] as const;
type Reason = (typeof REASONS)[number]["value"];

/** "Report response": a reason and an optional note, sent to POST /api/mobile/report. */
export function ReportSheet({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const [reason, setReason] = React.useState<Reason | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (messageId) {
      setReason(null);
      setNote("");
      setErr(null);
      setSent(false);
    }
  }, [messageId]);

  const submit = async () => {
    if (!messageId || !reason) return;
    setBusy(true);
    setErr(null);
    try {
      await api<{ ok: true }>("/api/mobile/report", { body: { messageId, reason, note: note.trim() || undefined } });
      setSent(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={Boolean(messageId)} onClose={onClose} title={sent ? "Report sent" : "Report response"}>
      {sent ? (
        <>
          <Txt variant="bodyMuted">Thanks. The response was flagged for review.</Txt>
          <Button label="Done" variant="secondary" onPress={onClose} />
        </>
      ) : (
        <>
          <Txt variant="bodyMuted">What is wrong with this response?</Txt>
          <View accessibilityRole="radiogroup" style={{ gap: space.xs }}>
            {REASONS.map((r) => {
              const on = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={r.label}
                  onPress={() => setReason(r.value)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingHorizontal: space.md,
                    borderRadius: radius.control,
                    borderWidth: 1,
                    borderColor: on ? color.accent : color.border,
                    backgroundColor: pressed ? color.surface2 : color.surface,
                  })}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? color.accent : color.borderStrong, alignItems: "center", justifyContent: "center" }}>
                    {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent }} /> : null}
                  </View>
                  <Txt variant="label">{r.label}</Txt>
                </Pressable>
              );
            })}
          </View>
          <Input label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} multiline placeholder="Add details" style={{ minHeight: 72, paddingTop: space.md, textAlignVertical: "top" }} />
          {err ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {err}
            </Txt>
          ) : null}
          <Button label="Send report" variant="primary" icon={FlagIcon} loading={busy} disabled={!reason} onPress={() => void submit()} />
        </>
      )}
    </Sheet>
  );
}

/** The message box: text, mic, and Send (or Stop while an answer streams). */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onMic,
  streaming,
  listening,
  inputRef,
}: {
  value: string;
  onChange: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  onMic: () => void;
  streaming: boolean;
  listening: boolean;
  inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
}) {
  const canSend = value.trim().length > 0 && !streaming;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.bg }}>
      <IconButton icon={MicrophoneIcon} label="Speak a message" onPress={onMic} disabled={listening || streaming} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder="Message your agent"
        placeholderTextColor={color.subtle}
        selectionColor={color.accent}
        cursorColor={color.accent}
        accessibilityLabel="Message"
        multiline
        maxLength={8000}
        maxFontSizeMultiplier={1.6}
        style={[
          type.body,
          {
            flex: 1,
            minHeight: TOUCH,
            maxHeight: 160,
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: color.borderStrong,
            backgroundColor: color.surface,
            paddingHorizontal: space.md,
            paddingTop: 13,
            paddingBottom: 13,
            fontSize: 16,
            textAlignVertical: "center",
          },
        ]}
      />
      {streaming ? <IconButton icon={StopIcon} label="Stop generating" onPress={onStop} /> : <IconButton icon={ArrowUpIcon} label="Send message" tone="accent" onPress={onSend} disabled={!canSend} />}
    </View>
  );
}
