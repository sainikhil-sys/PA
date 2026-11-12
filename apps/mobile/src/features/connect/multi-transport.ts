import { isBleLink, isLanLink } from "../../../modules/cowork-bridge/protocol";
import type { LinkId, Transport, TransportEvent } from "./transport";

export type TransportKind = "nearby" | "lan" | "ble";

/** One Transport over several radios, routed by link id. */
export type MultiTransport = Transport & {
  /** Largest single send on this link (Bluetooth LE: 4 KB). */
  maxBytesFor(link: LinkId): number;
};

/** Which radio a link belongs to: "lan:" and "ble:" prefixes, anything else is a Nearby endpoint. */
export function kindOfLink(link: LinkId): TransportKind {
  if (isLanLink(link)) return "lan";
  if (isBleLink(link)) return "ble";
  return "nearby";
}

// Lower is better: the same person found on several radios is shown once, on the best one.
const RANK: Record<TransportKind, number> = { nearby: 0, lan: 1, ble: 2 };

/** Names are compared loosely: Bluetooth LE advertises at most 24 bytes of the name. */
const nameKey = (name: string) => name.trim().toLowerCase().slice(0, 20);

type Found = { kind: TransportKind; name: string; key: string; shown: boolean };

/**
 * Combines Nearby Connections, hotspot/LAN and Bluetooth LE. `start` runs every transport whose
 * `available()` is true and succeeds if at least one starts. Calls for a link go to the transport
 * that owns it; events from all of them are merged. A phone seen on more than one radio under the
 * same name is listed once, on the fastest one (Nearby, then LAN, then Bluetooth LE).
 */
export function createMultiTransport(parts: Partial<Record<TransportKind, Transport>>): MultiTransport {
  const all = (Object.keys(RANK) as TransportKind[]).flatMap((kind) => (parts[kind] ? [{ kind, t: parts[kind]! }] : []));
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach((l) => l(e));
  const found = new Map<LinkId, Found>();
  let subscribed = false;

  const active = () =>
    all.filter((p) => {
      try {
        return p.t.available();
      } catch {
        return false;
      }
    });

  const route = (link: LinkId): Transport => {
    const t = parts[kindOfLink(link)];
    if (!t) throw new Error("NOT_AVAILABLE");
    return t;
  };

  /** Shows only the best-ranked entries for one name; hides the rest. */
  const refresh = (key: string) => {
    const same = [...found.entries()].filter(([, f]) => f.key === key);
    const best = Math.min(...same.map(([, f]) => RANK[f.kind]));
    for (const [link, f] of same) {
      const show = RANK[f.kind] === best;
      if (show && !f.shown) {
        f.shown = true;
        emit({ type: "found", link, name: f.name });
      } else if (!show && f.shown) {
        f.shown = false;
        emit({ type: "lost", link });
      }
    }
  };

  const onEvent = (kind: TransportKind) => (e: TransportEvent) => {
    if (e.type === "found") {
      const prev = found.get(e.link);
      const key = nameKey(e.name);
      found.set(e.link, { kind, name: e.name, key, shown: false });
      if (prev?.shown && prev.key !== key) emit({ type: "lost", link: e.link });
      if (prev && prev.key !== key) refresh(prev.key);
      refresh(key);
      return;
    }
    if (e.type === "lost") {
      const prev = found.get(e.link);
      found.delete(e.link);
      if (prev?.shown) emit(e);
      if (prev) refresh(prev.key);
      return;
    }
    emit(e);
  };

  const subscribeAll = () => {
    if (subscribed) return;
    subscribed = true;
    for (const p of all) p.t.subscribe(onEvent(p.kind));
  };

  const each = (fn: (t: Transport) => void) => {
    for (const p of all) {
      try {
        fn(p.t);
      } catch {
        // One radio failing to stop never keeps the others running.
      }
    }
  };

  return {
    name: "Connect",
    get maxBytes() {
      // The safe size on any link; maxBytesFor gives the real one.
      return Math.min(...all.map((p) => p.t.maxBytes));
    },
    maxBytesFor: (link) => parts[kindOfLink(link)]?.maxBytes ?? 0,
    available: () => active().length > 0,
    async start(displayName) {
      subscribeAll();
      const run = active();
      if (!run.length) throw new Error("NOT_AVAILABLE");
      const results = await Promise.allSettled(run.map((p) => p.t.start(displayName)));
      if (results.some((r) => r.status === "fulfilled")) return;
      // Nothing started: report the first (most capable) transport's reason.
      throw (results[0] as PromiseRejectedResult).reason;
    },
    pause() {
      each((t) => t.pause());
      found.clear();
    },
    stop() {
      each((t) => t.stop());
      found.clear();
    },
    connect: (link, displayName) => route(link).connect(link, displayName),
    accept: (link) => route(link).accept(link),
    reject: (link) => route(link).reject(link),
    async send(link, bytes) {
      const t = route(link);
      if (bytes.length > t.maxBytes) throw new Error("TOO_LARGE");
      await t.send(link, bytes);
    },
    disconnect(link) {
      try {
        route(link).disconnect(link);
      } catch {
        // No transport owns this link any more.
      }
    },
    subscribe(listener) {
      subscribeAll();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
