"use client";

import { ArrowClockwise, ArrowUp, CaretDown, Copy, Files, Graph, Paperclip, PencilSimple, Sparkle, Stop, X } from "@phosphor-icons/react";
import { useLinkPanel } from "@/components/flow/link-panel-context";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { AgentOrb } from "@/components/voice/agent-orb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { ProposalCard } from "./proposal-card";
import { useChat, type UiMessage } from "./use-chat";

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
  const [attachment, setAttachment] = React.useState<{ name: string; text: string } | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const sentInitial = React.useRef(false);

  React.useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      void chat.send(initialPrompt);
    }
  }, [initialPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    void chat.send(text, { attachment: attachment ?? undefined, replaceFromMessageId: editingId ?? undefined });
    setInput("");
    setAttachment(null);
    setEditingId(null);
  };

  const upload = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) return void toast.error("Files up to 4 MB, please.");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/chat/attach", { method: "POST", body: fd });
      const data = (await res.json()) as { name?: string; text?: string; error?: string; truncated?: boolean };
      if (!res.ok || !data.text) throw new Error(data.error ?? "Couldn't read that file.");
      setAttachment({ name: data.name ?? file.name, text: data.text });
      if (data.truncated) toast.message("Long document: I'll use the first part.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", compact ? "" : "")}>
      <div ref={listRef} data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={chat.busy}>
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
                  <button type="button" onClick={() => void chat.send(s)} className="flex min-h-12 w-full items-center gap-2 rounded-[12px] border border-border px-4 py-2.5 text-left text-sm transition-colors hover:border-border-strong">
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
                              setEditingId(m.id);
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
          {editingId ? (
            <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
              <span>Editing your message. Sending replaces the answer.</span>
              <button
                type="button"
                className="h-8 px-2 hover:text-foreground"
                onClick={() => {
                  setEditingId(null);
                  setInput("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {attachment ? (
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-[12px]">
              <Files size={14} /> {attachment.name}
              <button type="button" onClick={() => setAttachment(null)} className="grid size-7 place-items-center rounded-full hover:bg-surface-hover" aria-label="Remove attachment">
                <X size={12} />
              </button>
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-end gap-2 rounded-[16px] border border-border bg-background p-2 focus-within:border-foreground"
          >
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <Button type="button" variant="quiet" size="icon-sm" aria-label="Attach a document" disabled={uploading} onClick={() => fileRef.current?.click()}>
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={uploading ? "Reading your file…" : `Message ${agentName}…`}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-subtle"
            />
            {chat.busy ? (
              <Button type="button" variant="secondary" size="icon-sm" onClick={chat.stop} aria-label="Stop">
                <Stop weight="fill" />
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="icon-sm" disabled={!input.trim()} aria-label="Send">
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
          <button type="button" onClick={() => setShowTools((s) => !s)} aria-expanded={showTools} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] text-muted hover:border-border-strong hover:text-foreground">
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

      {m.citations?.length && !m.pending ? (
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted">Sources used</p>
          <ol className="flex flex-wrap gap-1.5">
            {m.citations.map((c) => (
              <li key={c.n}>
                <a href={c.url ?? "#"} target={c.url?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] hover:border-border-strong">
                  <span className="tabular text-muted">{c.n}</span>
                  <span className="truncate">{c.title}</span>
                </a>
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
