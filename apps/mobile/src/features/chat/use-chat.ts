import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { ApiError, errorText } from "@/lib/api";
import { streamChat } from "@/lib/chat";
import { keys } from "@/lib/queries";
import { useSession } from "@/lib/session";
import type { ChatMemory, Citation, ConversationDetail } from "@/lib/types";

/** Same labels as the server's PROPOSAL_LABEL (stored proposals carry only their kind). */
const PROPOSAL_LABEL: Record<string, string> = {
  create_task: "Create task",
  create_draft: "Create Gmail draft",
  schedule_task: "Schedule task",
  run_automation: "Run automation",
  create_linkedin_draft: "Create LinkedIn draft",
  add_note: "Save note",
  notify: "Notify me",
};
export const proposalLabel = (kind: string) => PROPOSAL_LABEL[kind] ?? "Proposed action";

export type ChatProposal = { id: string; label: string; summary: string; status: string };

export type UserItem = { kind: "user"; key: string; id?: string; text: string; trigger: "text" | "voice" };
export type AssistantItem = {
  kind: "assistant";
  key: string;
  /** Server message id, once the turn is stored ("done"). Needed for Report. */
  id?: string;
  text: string;
  citations: Citation[];
  /** Latest tool status ("Searching your email") while the answer is being prepared. */
  status?: string;
  proposals: ChatProposal[];
  streaming: boolean;
  /** An error notice instead of (or after) an answer. */
  error?: string;
  /** Reply to a voice message: may be read aloud. */
  voice: boolean;
  /** Memories saved from the question this answers. */
  memories: ChatMemory[];
  /** Fixed notes from Cowork, such as "Web search isn't set up". */
  notices: string[];
  /** Stopped before it finished: the text is partial. */
  stopped?: boolean;
};
export type ChatItem = UserItem | AssistantItem;

let seq = 0;
const nextKey = () => `local-${Date.now()}-${seq++}`;

/** Stored history as chat items. Proposals attach to the message that created them. */
export function itemsFromHistory(d: ConversationDetail): ChatItem[] {
  const byId = new Map(d.proposals.map((p) => [p.id, p]));
  return d.messages.map((m): ChatItem => {
    if (m.role === "user") return { kind: "user", key: m.id, id: m.id, text: m.content, trigger: "text" };
    const proposals = (m.meta.proposalIds ?? []).flatMap((id) => {
      const p = byId.get(id);
      return p ? [{ id: p.id, label: proposalLabel(p.kind), summary: p.summary, status: p.status }] : [];
    });
    return {
      kind: "assistant",
      key: m.id,
      id: m.id,
      text: m.meta.error ? "" : m.content,
      error: m.meta.error ? m.content || "The model didn't respond." : undefined,
      citations: m.meta.citations ?? [],
      proposals,
      streaming: false,
      voice: false,
      memories: m.meta.memories ?? [],
      notices: m.meta.notices ?? [],
      stopped: m.meta.stopped,
    };
  });
}

/**
 * One conversation's live state: history, streaming the next turn, stop and retry. The
 * conversation id is learned from the first "meta" event when the chat starts as new.
 */
export function useChat(initialId: string | undefined, opts: { onReply?: (text: string, trigger: "text" | "voice") => void } = {}) {
  const qc = useQueryClient();
  const [items, setItems] = React.useState<ChatItem[]>([]);
  const [streaming, setStreaming] = React.useState(false);
  const conversationId = React.useRef<string | undefined>(initialId);
  const abort = React.useRef<AbortController | null>(null);
  const onReply = React.useRef(opts.onReply);
  onReply.current = opts.onReply;
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  React.useEffect(() => () => abort.current?.abort(), []);

  const patch = React.useCallback((key: string, fn: (a: AssistantItem) => AssistantItem) => {
    setItems((list) => list.map((it) => (it.key === key && it.kind === "assistant" ? fn(it) : it)));
  }, []);

  const hydrate = React.useCallback((d: ConversationDetail) => setItems(itemsFromHistory(d)), []);

  const run = React.useCallback(
    async (text: string, trigger: "text" | "voice", replaceFromMessageId?: string) => {
      const userKey = nextKey();
      const aKey = nextKey();
      setItems((list) => [
        ...list,
        { kind: "user", key: userKey, text, trigger },
        { kind: "assistant", key: aKey, text: "", citations: [], proposals: [], streaming: true, voice: trigger === "voice", memories: [], notices: [] },
      ]);
      const ctrl = new AbortController();
      abort.current = ctrl;
      setStreaming(true);
      let done = false;
      let failed = false;
      let answer = "";
      try {
        await streamChat(
          { conversationId: conversationId.current, message: text, trigger, replaceFromMessageId },
          (e) => {
            switch (e.type) {
              case "meta":
                conversationId.current = e.conversationId;
                setItems((list) => list.map((it) => (it.key === userKey && it.kind === "user" ? { ...it, id: e.userMessageId } : it)));
                void qc.invalidateQueries({ queryKey: ["conversations"] });
                break;
              case "tool":
                patch(aKey, (a) => ({ ...a, status: e.label }));
                break;
              case "citations":
                patch(aKey, (a) => ({ ...a, citations: e.citations }));
                break;
              case "text":
                answer += e.delta;
                patch(aKey, (a) => ({ ...a, text: a.text + e.delta, status: undefined }));
                break;
              case "proposal":
                patch(aKey, (a) => ({ ...a, proposals: [...a.proposals, { ...e.proposal, status: "pending" }] }));
                void qc.invalidateQueries({ queryKey: keys.approvals });
                void qc.invalidateQueries({ queryKey: keys.me });
                break;
              case "memory":
                patch(aKey, (a) => ({ ...a, memories: [...a.memories.filter((m) => m.id !== e.memory.id), e.memory] }));
                if (e.memory.status !== "exists") void qc.invalidateQueries({ queryKey: keys.memories });
                break;
              case "notice":
                patch(aKey, (a) => (a.notices.includes(e.text) ? a : { ...a, notices: [...a.notices, e.text] }));
                break;
              case "done":
                done = true;
                patch(aKey, (a) => ({ ...a, id: e.messageId, streaming: false, status: undefined }));
                break;
              case "error":
                failed = true;
                patch(aKey, (a) => ({ ...a, error: e.message, streaming: false, status: undefined }));
                break;
            }
          },
          ctrl.signal,
        );
        if (!done && !failed) patch(aKey, (a) => ({ ...a, streaming: false, status: undefined, error: "The connection dropped before the answer finished. Try again." }));
      } catch (err) {
        const stopped = ctrl.signal.aborted || (err as Error)?.name === "AbortError";
        // The stream bypasses api(), so an expired session is handled here the same way.
        if (err instanceof ApiError && err.status === 401) useSession.getState().markExpired();
        patch(aKey, (a) => ({ ...a, streaming: false, status: undefined, stopped: stopped && Boolean(a.text), error: stopped ? (a.text ? undefined : "Stopped.") : errorText(err) }));
      } finally {
        if (abort.current === ctrl) abort.current = null;
        setStreaming(false);
        if (conversationId.current) void qc.invalidateQueries({ queryKey: keys.conversation(conversationId.current) });
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      }
      if (done && answer && !ctrl.signal.aborted) onReply.current?.(answer, trigger);
    },
    [patch, qc],
  );

  const send = React.useCallback(
    (text: string, trigger: "text" | "voice" = "text"): boolean => {
      const t = text.trim();
      if (!t || abort.current) return false;
      void run(t, trigger);
      return true;
    },
    [run],
  );

  /** Resend the last user message, replacing it (and the failed answer) on the server when it was stored. */
  const retry = React.useCallback(() => {
    if (abort.current) return;
    const list = itemsRef.current;
    const idx = list.findLastIndex((it) => it.kind === "user");
    if (idx < 0) return;
    const lastUser = list[idx] as UserItem;
    setItems(list.slice(0, idx));
    void run(lastUser.text, lastUser.trigger, lastUser.id);
  }, [run]);

  /**
   * Edit a sent message: the server drops it and everything after, then answers the new text.
   * Only for messages the server has stored (they have an id).
   */
  const edit = React.useCallback(
    (userKey: string, text: string): boolean => {
      const t = text.trim();
      if (!t || abort.current) return false;
      const list = itemsRef.current;
      const idx = list.findIndex((it) => it.key === userKey && it.kind === "user");
      const item = list[idx] as UserItem | undefined;
      if (!item?.id) return false;
      setItems(list.slice(0, idx));
      void run(t, "text", item.id);
      return true;
    },
    [run],
  );

  /** Ask again: answer the question before this reply once more, replacing the reply. */
  const regenerate = React.useCallback(
    (assistantKey: string): boolean => {
      const list = itemsRef.current;
      const aIdx = list.findIndex((it) => it.key === assistantKey);
      const uIdx = list.slice(0, aIdx).findLastIndex((it) => it.kind === "user");
      const item = list[uIdx] as UserItem | undefined;
      return item ? edit(item.key, item.text) : false;
    },
    [edit],
  );

  const stop = React.useCallback(() => abort.current?.abort(), []);

  const setProposalStatus = React.useCallback((proposalId: string, status: string) => {
    setItems((list) => list.map((it) => (it.kind === "assistant" && it.proposals.some((p) => p.id === proposalId) ? { ...it, proposals: it.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p)) } : it)));
  }, []);

  return { items, streaming, send, retry, edit, regenerate, stop, hydrate, setProposalStatus, conversationId };
}
