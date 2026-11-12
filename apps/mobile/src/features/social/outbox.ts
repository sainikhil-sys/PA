import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { api, ApiError } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { socialKeys } from "./api";

/**
 * Messages typed in Chats wait here until the server has them. Nothing is dropped silently:
 * - sending: on its way now
 * - waiting: no connection (or Cowork was busy); retried automatically
 * - failed: the server refused it (for example you were blocked); shown with the reason, retry or discard
 * A message leaves the outbox only when the server confirms it. The same clientId is sent on every
 * retry, so a retry after a lost response never creates a duplicate.
 */
export type PendingState = "sending" | "waiting" | "failed";
export type Pending = {
  clientId: string;
  threadId: string;
  body: string;
  replyTo: { id: string; senderName: string; body: string } | null;
  createdAt: string;
  state: PendingState;
  error?: string;
};

const KEY = "cowork.chats.outbox";

type Outbox = {
  items: Pending[];
  loaded: boolean;
  load: () => Promise<void>;
  enqueue: (threadId: string, body: string, replyTo: Pending["replyTo"]) => void;
  retry: (clientId: string) => void;
  discard: (clientId: string) => void;
  clear: () => void;
};

function newClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

function save(items: Pending[]) {
  void AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

export const useOutbox = create<Outbox>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const items = raw ? (JSON.parse(raw) as Pending[]) : [];
      // Anything that was mid-send when the app closed is retried.
      set({ items: items.map((i) => (i.state === "sending" ? { ...i, state: "waiting" } : i)), loaded: true });
    } catch {
      set({ loaded: true });
    }
    void flush();
  },
  enqueue: (threadId, body, replyTo) => {
    const item: Pending = { clientId: newClientId(), threadId, body, replyTo, createdAt: new Date().toISOString(), state: "sending" };
    const items = [...get().items, item];
    set({ items });
    save(items);
    void flush();
  },
  retry: (clientId) => {
    const items = get().items.map((i) => (i.clientId === clientId ? { ...i, state: "sending" as const, error: undefined } : i));
    set({ items });
    save(items);
    void flush();
  },
  discard: (clientId) => {
    const items = get().items.filter((i) => i.clientId !== clientId);
    set({ items });
    save(items);
  },
  clear: () => {
    set({ items: [] });
    void AsyncStorage.removeItem(KEY).catch(() => {});
  },
}));

function update(clientId: string, patch: Partial<Pending> | null) {
  const s = useOutbox.getState();
  const items = patch === null ? s.items.filter((i) => i.clientId !== clientId) : s.items.map((i) => (i.clientId === clientId ? { ...i, ...patch } : i));
  useOutbox.setState({ items });
  save(items);
}

let running = false;

/** Sends waiting messages in the order they were written. Safe to call any time. */
export async function flush() {
  if (running || !useSession.getState().token) return;
  running = true;
  try {
    for (;;) {
      const next = useOutbox.getState().items.find((i) => i.state !== "failed");
      if (!next) break;
      update(next.clientId, { state: "sending" });
      try {
        await api(`/api/social/threads/${next.threadId}/messages`, { body: { clientId: next.clientId, body: next.body, replyToId: next.replyTo?.id ?? null } });
        // Refresh the chat first so the confirmed copy is on screen before the pending one goes.
        await queryClient.invalidateQueries({ queryKey: socialKeys.thread(next.threadId) });
        update(next.clientId, null);
        void queryClient.invalidateQueries({ queryKey: socialKeys.threads });
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 0 || status === 429 || status >= 500) {
          update(next.clientId, { state: "waiting" });
          break; // Keep order: later messages wait for this one.
        }
        update(next.clientId, { state: "failed", error: err instanceof ApiError ? err.message : "Not sent." });
      }
    }
  } finally {
    running = false;
  }
}

/** Mounted once under the tabs: loads the outbox, retries on return to the app and every 15 seconds. */
export function useOutboxRunner() {
  const load = useOutbox((s) => s.load);
  const hasWaiting = useOutbox((s) => s.items.some((i) => i.state === "waiting"));
  React.useEffect(() => {
    void load();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void flush();
    });
    return () => sub.remove();
  }, [load]);
  React.useEffect(() => {
    if (!hasWaiting) return;
    const t = setInterval(() => void flush(), 15_000);
    return () => clearInterval(t);
  }, [hasWaiting]);
}

// Another account must never see this account's unsent messages.
useSession.subscribe((s, prev) => {
  if (s.status === "signedOut" && prev.status !== "signedOut") useOutbox.getState().clear();
});
