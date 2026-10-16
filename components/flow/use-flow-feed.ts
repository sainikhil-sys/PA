"use client";

import * as React from "react";
import useSWR from "swr";
import { mergeSpans, nextCursor, type FlowSpan, type NodeBase } from "@/lib/flow/model";
import { httpTransport, pollInterval, type FlowTransport } from "@/lib/flow/transport";

/**
 * Live feed via SWR polling: 2s while the panel is open and a run is active,
 * 10s when idle, paused while the tab is hidden (SWR's default). The transport
 * is swappable (e.g. Ably/Pusher push) without changing callers.
 */
export function useFlowFeed({ open, active, transport = httpTransport }: { open: boolean; active: boolean; transport?: FlowTransport }) {
  const cursor = React.useRef<string | null>(null);
  const [spans, setSpans] = React.useState<FlowSpan[]>([]);
  const [skew, setSkew] = React.useState(0); // server - client clock offset (ms)
  const interval = pollInterval(open, active);

  const events = useSWR(
    open ? ["flow-events", transport.name] : null,
    async () => {
      const res = await transport.fetchEvents(cursor.current);
      cursor.current = nextCursor(cursor.current, res.spans) ?? cursor.current;
      setSkew(Date.parse(res.serverTime) - Date.now());
      if (res.spans.length) setSpans((prev) => mergeSpans(prev, res.spans));
      return res.spans.length;
    },
    { refreshInterval: interval, refreshWhenHidden: false, revalidateOnFocus: true, dedupingInterval: 1_000 },
  );

  const status = useSWR<{ nodes: Record<string, NodeBase> }>(open ? ["flow-status", transport.name] : null, () => transport.fetchStatus(), {
    refreshInterval: interval ? Math.max(interval, 5_000) : 0,
    refreshWhenHidden: false,
  });

  React.useEffect(() => {
    if (!open || !transport.subscribe) return;
    return transport.subscribe((incoming) => setSpans((prev) => mergeSpans(prev, incoming)));
  }, [open, transport]);

  return { spans, base: status.data?.nodes ?? null, error: events.error ?? status.error, refresh: () => void events.mutate(), skew };
}
