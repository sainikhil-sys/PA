"use client";

import * as React from "react";
import type { Citation } from "@/lib/db/schema";

export type UiProposal = { id: string; kind: string; label: string; summary: string; status?: string };
export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: { tool: string; label: string }[];
  citations?: Citation[];
  proposals?: UiProposal[];
  generalKnowledge?: boolean;
  attachment?: { name: string } | null;
  runId?: string;
  pending?: boolean;
  error?: boolean;
};

type Event =
  | { type: "meta"; conversationId: string; runId: string; userMessageId: string }
  | { type: "tool"; tool: string; label: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "text"; delta: string }
  | { type: "proposal"; proposal: UiProposal }
  | { type: "done"; messageId: string; generalKnowledge: boolean }
  | { type: "error"; message: string };

/** Streams NDJSON from /api/chat into UI messages. */
export function useChat(opts: { conversationId?: string; initial?: UiMessage[]; onConversation?: (id: string) => void }) {
  const [messages, setMessages] = React.useState<UiMessage[]>(opts.initial ?? []);
  const [conversationId, setConversationId] = React.useState<string | undefined>(opts.conversationId);
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  // Reset only when the parent switches to a DIFFERENT conversation (not when it
  // learns the id of the one we just created while streaming).
  const currentId = React.useRef(opts.conversationId);
  React.useEffect(() => {
    if (opts.conversationId === currentId.current) return;
    currentId.current = opts.conversationId;
    setMessages(opts.initial ?? []);
    setConversationId(opts.conversationId);
  }, [opts.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = React.useCallback(
    async (text: string, extra: { attachment?: { name: string; text: string }; replaceFromMessageId?: string; trigger?: "text" | "voice" } = {}) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      const tempUser: UiMessage = { id: `u-${Date.now()}`, role: "user", content: text, attachment: extra.attachment ? { name: extra.attachment.name } : null };
      const tempAsst: UiMessage = { id: `a-${Date.now()}`, role: "assistant", content: "", tools: [], proposals: [], pending: true };
      setMessages((prev) => {
        let base = prev;
        if (extra.replaceFromMessageId) {
          const idx = prev.findIndex((m) => m.id === extra.replaceFromMessageId);
          if (idx >= 0) base = prev.slice(0, idx);
        }
        return [...base, tempUser, tempAsst];
      });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((prev) => prev.map((m) => (m.id === tempAsst.id ? fn(m) : m)));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message: text, attachment: extra.attachment, replaceFromMessageId: extra.replaceFromMessageId, trigger: extra.trigger ?? "text" }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(res.status === 429 ? "You're sending messages quickly. Wait a moment." : "Couldn't reach your agent.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as Event;
            if (ev.type === "meta") {
              if (!conversationId) {
                currentId.current = ev.conversationId;
                setConversationId(ev.conversationId);
                opts.onConversation?.(ev.conversationId);
              }
              setMessages((prev) => prev.map((m) => (m.id === tempUser.id ? { ...m, id: ev.userMessageId } : m)));
              patch((m) => ({ ...m, runId: ev.runId }));
            } else if (ev.type === "tool") patch((m) => ({ ...m, tools: [...(m.tools ?? []), { tool: ev.tool, label: ev.label }] }));
            else if (ev.type === "citations") patch((m) => ({ ...m, citations: ev.citations }));
            else if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.delta }));
            else if (ev.type === "proposal") patch((m) => ({ ...m, proposals: [...(m.proposals ?? []), { ...ev.proposal, status: "pending" }] }));
            else if (ev.type === "done") patch((m) => ({ ...m, id: ev.messageId, pending: false, generalKnowledge: ev.generalKnowledge }));
            else if (ev.type === "error") patch((m) => ({ ...m, content: m.content || ev.message, pending: false, error: true }));
          }
        }
        patch((m) => ({ ...m, pending: false }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") patch((m) => ({ ...m, content: m.content || (err as Error).message, pending: false, error: true }));
        else patch((m) => ({ ...m, pending: false }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, conversationId, opts],
  );

  const stop = () => abortRef.current?.abort();

  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.content, { replaceFromMessageId: lastUser.id });
  };

  const setProposalStatus = (proposalId: string, status: string) =>
    setMessages((prev) => prev.map((m) => (m.proposals?.some((p) => p.id === proposalId) ? { ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p)) } : m)));

  return { messages, send, stop, regenerate, busy, conversationId, setProposalStatus };
}
