"use client";

import { ArrowClockwise, ArrowUp, CaretDown, ClipboardText, Copy, FileCode, Files, Globe, Graph, Info, Paperclip, PencilSimple, Sparkle, Stop, X } from "@phosphor-icons/react";
import { useLinkPanel } from "@/components/flow/link-panel-context";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { AgentOrb } from "@/components/voice/agent-orb";
import { Button } from "@/components/ui/button";
import {
  CHAT_ATTACH_ACCEPT,
  detectChatKind,
  IMAGE_UNSUPPORTED,
  isImageFile,
  isSecretFile,
  looksLikeCode,
  MAX_ATTACHMENT_CHARS,
  MAX_DOC_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_TEXT_FILE_BYTES,
  PASTE_CHIPS_MIN_CHARS,
  pastedName,
  SECRET_FILE_REFUSED,
  shouldAttachPaste,
  transformMessage,
  UNSUPPORTED_FILE,
  type AttachmentKind,
  type ChatAttachmentInput,
  type TransformKind,
  type TranslateLanguage,
} from "@/lib/chat/attachments";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { MemoryLine } from "./memory-line";
import { ProposalCard } from "./proposal-card";
import { QuickActions } from "./quick-actions";
import { useChat, type UiMessage } from "./use-chat";

/** A long or pasted text as an attachment chip (UNTRUSTED, like any file). */
function pasteAttachment(text: string): ChatAttachmentInput {
  return { name: pastedName(text), text: text.slice(0, MAX_ATTACHMENT_CHARS), kind: looksLikeCode(text) ? "code" : "paste" };
}

export function ChatView({
  conversationId,
  initial,
  suggestions,
  initialPrompt,
  agentName,
  compact,
  onConversation,
}: {
  conversationId?: string;
  initial?: UiMessage[];
  suggestions: string[];
  initialPrompt?: string | null;
  agentName: string;
  compact?: boolean;
  onConversation?: (id: string) => void;
}) {
  const chat = useChat({ conversationId, initial, onConversation });
  const [input, setInput] = React.useState("");
  const [attachment, setAttachment] = React.useState<ChatAttachmentInput | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; attachment: { name: string } | null } | null>(null);
  /** A medium paste that filled the empty box: offers the quick actions until the text is changed. */
  const [lastPaste, setLastPaste] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const sentInitial = React.useRef(false);
  /** Follow the stream only while the owner is near the bottom of the list. */
  const stick = React.useRef(true);
  const reduceMotion = useReducedMotionConfig();

  React.useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      void chat.send(initialPrompt);
    }
  }, [initialPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion || chat.busy ? "auto" : "smooth" });
  }, [chat.messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    stick.current = true;
    void chat.send(text, { attachment: attachment ?? undefined, replaceFromMessageId: editing?.id, keepAttachment: !attachment && editing?.attachment ? editing.attachment : undefined });
    setInput("");
    setAttachment(null);
    setEditing(null);
    setLastPaste(null);
  };

  const attach = (next: ChatAttachmentInput) => {
    if (attachment) toast.message(`Replaced ${attachment.name}`);
    setAttachment(next);
  };

  const upload = async (file: File) => {
    if (isImageFile(file.name, file.type)) return void toast.error(IMAGE_UNSUPPORTED);
    if (isSecretFile(file.name)) return void toast.error(SECRET_FILE_REFUSED);
    const k = detectChatKind(file.name, file.type);
    if (!k) return void toast.error(UNSUPPORTED_FILE);
    const isDoc = k === "pdf" || k === "docx";
    if (file.size > (isDoc ? MAX_DOC_BYTES : MAX_TEXT_FILE_BYTES)) return void toast.error(isDoc ? "Files up to 4 MB, please." : "Text and code files up to 1 MB, please.");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/chat/attach", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { name?: string; text?: string; kind?: AttachmentKind; error?: string; truncated?: boolean };
      if (!res.ok || !data.text) throw new Error(data.error ?? "Couldn't read that file.");
      attach({ name: data.name ?? file.name, text: data.text, kind: data.kind ?? k });
      if (data.truncated) toast.message("Long document: I'll use the first part.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files[0]) return;
    if (files.length > 1) toast.message("One file at a time. I attached the first.");
    void upload(files[0]);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length) {
      e.preventDefault();
      handleFiles(e.clipboardData.files);
      return;
    }
    const t = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (shouldAttachPaste(t)) {
      e.preventDefault();
      attach(pasteAttachment(t));
      if (t.length > MAX_ATTACHMENT_CHARS) toast.message("Long text: I'll use the first part.");
    } else if (t.trim().length >= PASTE_CHIPS_MIN_CHARS && !input.trim()) {
      setLastPaste(t);
    }
  };

  const pasteCandidate = !attachment && !!lastPaste && input === lastPaste;

  const runTransform = (kind: TransformKind, language?: TranslateLanguage) => {
    const src = attachment ?? (pasteCandidate ? pasteAttachment(input) : null);
    if (!src || chat.busy) return;
    stick.current = true;
    void chat.send(transformMessage(kind, language), { attachment: src, transform: language ? { kind, language } : { kind } });
    setInput("");
    setAttachment(null);
    setLastPaste(null);
  };

  const showActions = !editing && !chat.busy && !uploading && ((attachment && !input.trim()) || pasteCandidate);
  const AttachIcon = attachment?.kind === "code" ? FileCode : attachment?.kind === "paste" ? ClipboardText : Files;

  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", compact ? "" : "")}>
      <div
        ref={listRef}
        data-lenis-prevent
        className="min-h-0 flex-1 overflow-y-auto"
        aria-live="polite"
        aria-busy={chat.busy}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {chat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-4 py-10 text-center">
            <AgentOrb state="idle" size={compact ? 64 : 88} />
            <div>
              <p className="font-serif text-[26px] tracking-[-0.02em]">How can {agentName} help?</p>
              <p className="mt-1 text-sm text-muted">Ask about your day, your inbox or your notes.</p>
            </div>
            <ul className="grid w-full max-w-lg gap-2 sm:grid-cols-2">
              {suggestions.slice(0, 4).map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => {
                      stick.current = true;
                      void chat.send(s);
                    }} className="flex min-h-12 w-full items-center gap-2 rounded-[12px] border border-border px-4 py-2.5 text-left text-sm transition-colors hover:border-border-strong">
                    <Sparkle size={16} className="shrink-0 text-muted" /> {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className={cn("mx-auto flex w-full flex-col gap-6 py-6", compact ? "px-5" : "max-w-[760px] px-4")}>
            <AnimatePresence initial={false}>
              {chat.messages.map((m) => (
                <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  {m.role === "user" ? (
                    <UserBubble
                      m={m}
                      onEdit={
                        chat.busy
                          ? undefined
                          : () => {
                              setInput(m.content);
                              setEditing({ id: m.id, attachment: m.attachment ?? null });
                            }
                      }
                    />
                  ) : (
                    <AssistantMessage m={m} isLast={m.id === lastAssistant?.id} busy={chat.busy} onRegenerate={chat.regenerate} onProposalStatus={chat.setProposalStatus} />
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>

      <div className={cn("border-t border-border bg-background", compact ? "p-3" : "px-4 pb-4 pt-3")}>
        <div className={cn("mx-auto", compact ? "" : "max-w-[760px]")}>
          {editing ? (
            <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
              <span>
                Editing your message. Sending replaces the answer.{!attachment && editing.attachment ? ` Keeps ${editing.attachment.name}.` : ""}
              </span>
              <button
                type="button"
                className="h-8 px-2 hover:text-foreground"
                onClick={() => {
                  setEditing(null);
                  setInput("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {attachment || showActions ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {attachment ? (
                <div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-[10px] border border-border bg-surface py-1 pl-3 pr-1 text-[12px]">
                  <AttachIcon size={14} className="shrink-0" /> <span className="truncate">{attachment.name}</span>
                  <span className="tabular shrink-0 text-subtle">{attachment.text.length.toLocaleString()} chars</span>
                  <button type="button" onClick={() => setAttachment(null)} className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-surface-hover" aria-label="Remove attachment">
                    <X size={12} />
                  </button>
                </div>
              ) : null}
              {showActions ? <QuickActions kind={attachment?.kind ?? (looksLikeCode(input) ? "code" : "paste")} onRun={runTransform} /> : null}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={cn("flex items-end gap-2 rounded-[16px] border border-border bg-background p-2 focus-within:border-foreground", dragging && "border-foreground")}
          >
            <input
              ref={fileRef}
              type="file"
              accept={CHAT_ATTACH_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="quiet" size="icon-sm" aria-label="Attach a file" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Paperclip />
            </Button>
            <label htmlFor={compact ? "chat-input-panel" : "chat-input"} className="sr-only">
              Message {agentName}
            </label>
            <textarea
              id={compact ? "chat-input-panel" : "chat-input"}
              data-lenis-prevent
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPaste}
              maxLength={MAX_MESSAGE_CHARS}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={uploading ? "Reading your file…" : attachment ? `Ask about ${attachment.name}, or pick an action…` : `Message ${agentName}…`}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-subtle"
            />
            {chat.busy ? (
              <Button type="button" variant="secondary" size="icon-sm" onClick={chat.stop} aria-label="Stop">
                <Stop weight="fill" />
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="icon-sm" disabled={!input.trim() || uploading} aria-label="Send">
                <ArrowUp weight="bold" />
              </Button>
            )}
          </form>
          <p className="mt-2 text-center text-[11px] text-subtle">Actions always ask for your approval. Nothing is sent, posted or deleted automatically.</p>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ m, onEdit }: { m: UiMessage; onEdit?: () => void }) {
  return (
    <div className="group flex flex-col items-end gap-1">
      {m.attachment ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted">
          <Files size={14} /> {m.attachment.name}
        </span>
      ) : null}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[16px] bg-surface-2 px-4 py-2.5 text-[15px]">{m.content}</div>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100">
          <PencilSimple size={14} /> Edit
        </button>
      ) : null}
    </div>
  );
}

/** Hostname without "www." for web source chips; null for relative or bad URLs. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function AssistantMessage({
  m,
  isLast,
  busy,
  onRegenerate,
  onProposalStatus,
}: {
  m: UiMessage;
  isLast: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onProposalStatus: (id: string, status: string) => void;
}) {
  const [showTools, setShowTools] = React.useState(false);
  const { openPanel } = useLinkPanel();
  const toolNames = [...new Set((m.tools ?? []).map((t) => t.tool))];
  return (
    <div className="flex flex-col gap-3">
      {toolNames.length ? (
        <div>
          <button type="button" onClick={() => setShowTools((s) => !s)} aria-expanded={showTools} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-foreground">
            Used: {toolNames.join(", ")} <CaretDown size={12} className={cn("transition-transform", showTools && "rotate-180")} />
          </button>
          <AnimatePresence>
            {showTools ? (
              <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-2 flex flex-col gap-1 pl-1 text-[12px] text-muted">
                {m.tools!.map((t, i) => (
                  <li key={i}>
                    <span className="text-foreground">{t.tool}</span> · {t.label}
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      {m.notices?.length ? (
        <ul className="flex flex-col gap-1">
          {m.notices.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px] text-muted">
              <Info size={14} className="mt-px shrink-0" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {m.pending && !m.content ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <AgentOrb state="thinking" size={22} /> Thinking…
        </div>
      ) : (
        <div className={cn(m.error && "text-muted")}>
          <Markdown text={m.content} citations={m.citations} />
        </div>
      )}

      {m.generalKnowledge && !m.pending ? <p className="text-[12px] text-muted">Parts of this answer come from general knowledge, not your data.</p> : null}

      {!m.pending ? m.memories?.map((mem) => <MemoryLine key={mem.id} memory={mem} />) : null}

      {m.citations?.length && !m.pending ? (
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted">Sources used</p>
          <ol className="flex flex-wrap gap-1.5">
            {m.citations.map((c) => (
              <li key={c.n}>
                {c.url ? (
                  <a href={c.url} target={c.url.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-[12px] hover:border-border-strong">
                    <span className="tabular text-muted">{c.n}</span>
                    {c.sourceType === "web" ? <Globe size={12} className="shrink-0 text-muted" aria-hidden /> : null}
                    <span className="truncate">{c.sourceType === "web" && hostOf(c.url) ? `${hostOf(c.url)} · ${c.title}` : c.title}</span>
                  </a>
                ) : (
                  <span className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-[12px]">
                    <span className="tabular text-muted">{c.n}</span>
                    <span className="truncate">{c.title}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} onStatus={(s) => onProposalStatus(p.id, s)} />)}

      {!m.pending ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(m.content);
              toast.success("Copied");
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground"
          >
            <Copy size={14} /> Copy
          </button>
          {m.runId ? (
            <button type="button" onClick={() => openPanel({ runId: m.runId })} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground">
              <Graph size={14} /> Show in panel
            </button>
          ) : null}
          {isLast && !busy ? (
            <button type="button" onClick={onRegenerate} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground">
              <ArrowClockwise size={14} /> Regenerate
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
