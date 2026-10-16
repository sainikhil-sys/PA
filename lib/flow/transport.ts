import type { FlowSpan, NodeBase } from "./model";

/**
 * Transport abstraction for the live event feed. The default polls HTTP; an
 * Ably/Pusher transport can implement `subscribe` later without touching the UI.
 */
export type FlowTransport = {
  name: string;
  fetchEvents(cursor: string | null): Promise<{ spans: FlowSpan[]; cursor: string | null; serverTime: string }>;
  fetchStatus(): Promise<{ nodes: Record<string, NodeBase>; serverTime: string }>;
  /** Optional push channel. Return an unsubscribe function. */
  subscribe?(onSpans: (spans: FlowSpan[]) => void): () => void;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const httpTransport: FlowTransport = {
  name: "http-polling",
  fetchEvents: (cursor) => getJson(`/api/flow/events${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`),
  fetchStatus: () => getJson("/api/flow/status"),
};

/** Poll cadence: fast while something is happening, slow when idle. */
export function pollInterval(open: boolean, active: boolean): number {
  if (!open) return 0;
  return active ? 2_000 : 10_000;
}
