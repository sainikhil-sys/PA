import "./random";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import { create } from "zustand";
import { createBleTransport } from "./ble-transport";
import { forgetPeerCalls } from "./calls-store";
import * as fdb from "./files-db";
import { ConnectFiles } from "./files-native";
import { loadDisplayName, loadIdentity, saveDisplayName } from "./identity";
import { createLanTransport } from "./lan-transport";
import { createMultiTransport, kindOfLink, type MultiTransport } from "./multi-transport";
import { createNearbyTransport } from "./nearby-transport";
import type { KeyPair } from "./noise";
import { requestNearbyPermissions } from "./permissions";
import { MAX_TEXT, SecureSession, type FeatureMessage } from "./session";
import * as db from "./store";
import type { LinkId, TransportEvent } from "./transport";

/** How long "visible to people nearby" stays on before turning itself off. */
export const VISIBLE_FOR_MS = 10 * 60_000;
const MAX_PENDING_REQUESTS = 5;
const MAX_MESSAGES_PER_MINUTE = 60;
/** Walkie keep-alives (about 20 a minute per person) have their own budget so chat is never crowded out. */
const MAX_PINGS_PER_MINUTE = 120;
const PING_TYPES = new Set(["walkie.ping", "walkie.pong"]);
/** Chat text over Bluetooth LE: 1,000 characters fit a 4 KB frame even when every character is 4 bytes. */
const MAX_TEXT_BLE = 1000;

export type LinkPhase = "requesting" | "approve" | "securing" | "secure" | "failed";
export type LinkInfo = { link: LinkId; name: string; incoming: boolean; phase: LinkPhase; verifier?: string; peerKey?: string; safetyCode?: string; reason?: string };

type State = {
  ready: boolean;
  available: boolean;
  myName: string;
  visible: boolean;
  visibleUntil: number | null;
  busy: boolean;
  error: string | null;
  nearby: Record<LinkId, { name: string }>;
  links: Record<LinkId, LinkInfo>;
  peers: db.PeerRow[];
  messages: Record<string, db.MessageRow[]>;

  init: (fallbackName: string) => Promise<void>;
  setName: (name: string) => Promise<void>;
  goVisible: () => Promise<void>;
  /** Stops being visible (advertising and discovery). People already connected stay connected. */
  goHidden: () => void;
  /** Stops every radio and disconnects everyone. */
  disconnectAll: () => void;
  connect: (link: LinkId) => Promise<void>;
  approve: (link: LinkId) => Promise<void>;
  decline: (link: LinkId) => Promise<void>;
  send: (peerKey: string, text: string) => Promise<void>;
  loadThread: (peerKey: string) => Promise<void>;
  verify: (peerKey: string) => Promise<void>;
  block: (peerKey: string) => Promise<void>;
  unblock: (peerKey: string) => Promise<void>;
  forget: (peerKey: string) => Promise<void>;
};

let transport: MultiTransport | null = null;
let identity: KeyPair | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let initializing: Promise<void> | null = null;
const DEFAULT_NAME = "Cowork user";
const sessions = new Map<LinkId, SecureSession>();
const received = new Map<string, number[]>();

/** Nearby first; hotspot/LAN and Bluetooth LE reach iPhones and phones without Google Play services. */
function createConnectTransport(): MultiTransport {
  return createMultiTransport({ nearby: createNearbyTransport(), lan: createLanTransport(), ble: createBleTransport() });
}

/** Longest chat message that fits this link. */
export function maxTextFor(link: LinkId | undefined): number {
  return link && kindOfLink(link) === "ble" ? MAX_TEXT_BLE : MAX_TEXT;
}

// ---------- Cleanup hooks ----------
// Features with their own in-memory state register here so "Delete chat" and a reset clear it too.
type Cleanup = { forgetPeer?: (peerKey: string) => Promise<void> | void; reset?: () => Promise<void> | void };
const cleanups = new Set<Cleanup>();

export function onConnectCleanup(c: Cleanup): () => void {
  cleanups.add(c);
  return () => cleanups.delete(c);
}

/** Runs every registered cleanup; one failing never stops the others. */
export async function runCleanups(kind: "reset" | "forgetPeer", peerKey = "") {
  for (const c of [...cleanups]) {
    try {
      if (kind === "reset") await c.reset?.();
      else await c.forgetPeer?.(peerKey);
    } catch {
      // Keep going: the rest still has to be cleared.
    }
  }
}

/** Deletes received files for these rows (a sender's originals stay where they were). */
export function deleteReceivedFiles(rows: { uri: string | null; outgoing: number }[]) {
  rows.forEach((r) => {
    if (!r.outgoing && r.uri) ConnectFiles.deleteFile(r.uri);
  });
}

// ---------- Feature message bus ----------
// Features (files, Walkie, calls, groups, social) register a message type here and send to people
// over the same encrypted session. Handlers must validate every field they read: peers are untrusted.
export type ConnectHandler = (peerKey: string, m: FeatureMessage, link: LinkId) => void;
const handlers = new Map<string, Set<ConnectHandler>>();

export function onConnectMessage(t: string, handler: ConnectHandler): () => void {
  if (t === "msg" || t === "ack") throw new Error("Reserved message type");
  const set = handlers.get(t) ?? new Set<ConnectHandler>();
  set.add(handler);
  handlers.set(t, set);
  return () => set.delete(handler);
}

/** Sends a feature message to a person connected securely right now. False if they are not. */
export function sendToPeer(peerKey: string, m: FeatureMessage): boolean {
  const live = linkForPeer(useConnect.getState(), peerKey);
  const session = live ? sessions.get(live.link) : undefined;
  if (!session) return false;
  try {
    session.sendMessage(m);
    return true;
  } catch {
    return false;
  }
}

/** Everyone connected securely right now. */
export function securePeers(): { peerKey: string; link: LinkId; name: string }[] {
  return Object.values(useConnect.getState().links)
    .filter((l) => l.phase === "secure" && l.peerKey)
    .map((l) => ({ peerKey: l.peerKey!, link: l.link, name: l.name }));
}

/** The person behind a radio link (for native file and audio events), if secure. */
export function peerForLink(link: LinkId): string | undefined {
  const l = useConnect.getState().links[link];
  return l?.phase === "secure" ? l.peerKey : undefined;
}

/** The live link for a peer, if they are connected securely right now. */
export function linkForPeer(s: Pick<State, "links">, peerKey: string): LinkInfo | undefined {
  return Object.values(s.links).find((l) => l.peerKey === peerKey && l.phase === "secure");
}

function readable(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/BLUETOOTH/i.test(msg)) return "Turn on Bluetooth and try again.";
  if (/MISSING_PERMISSION/i.test(msg)) return "Cowork needs the Nearby devices permission.";
  if (/RADIO|WIFI/i.test(msg)) return "Turn on Wi-Fi and try again. You do not need to be connected to a network.";
  if (/TIMEOUT|NOT_CONNECTED|ENDPOINT_IO/i.test(msg)) return "The other phone did not respond. Move closer and try again.";
  return "Something went wrong with the nearby connection. Try again.";
}

export const useConnect = create<State>((set, get) => {
  const patchLink = (link: LinkId, patch: Partial<LinkInfo>) =>
    set((s) => (s.links[link] ? { links: { ...s.links, [link]: { ...s.links[link]!, ...patch } } } : {}));
  const dropLink = (link: LinkId) =>
    set((s) => {
      const links = { ...s.links };
      delete links[link];
      return { links };
    });
  const refreshPeers = async () => set({ peers: await db.listPeers() });
  const pushMessage = (m: db.MessageRow) =>
    set((s) => ({ messages: { ...s.messages, [m.peer]: [...(s.messages[m.peer] ?? []).filter((x) => x.id !== m.id), m] } }));
  const setStatus = (peer: string, id: string, status: db.MessageRow["status"]) => {
    void db.setMessageStatus(id, status);
    set((s) => ({ messages: { ...s.messages, [peer]: (s.messages[peer] ?? []).map((m) => (m.id === id ? { ...m, status } : m)) } }));
  };

  /** A simple per-peer flood guard: beyond the limit, messages are dropped, not stored. Walkie pings count separately. */
  const allowFrom = (peer: string, type: string) => {
    const ping = PING_TYPES.has(type);
    const bucket = `${ping ? "ping" : "msg"}:${peer}`;
    const now = Date.now();
    const recent = (received.get(bucket) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    received.set(bucket, recent);
    return recent.length <= (ping ? MAX_PINGS_PER_MINUTE : MAX_MESSAGES_PER_MINUTE);
  };

  const startSession = (link: LinkId, initiator: boolean) => {
    const session = new SecureSession({
      initiator,
      identity: identity!,
      myName: get().myName,
      maxFrame: transport!.maxBytesFor(link),
      on: {
        send: (bytes) => void transport!.send(link, bytes).catch(() => {}),
        secure: async ({ peerKey, peerName, safetyCode }) => {
          const known = await db.getPeer(peerKey);
          if (known?.blocked) {
            // Proven to be someone this person blocked: hang up without telling them why.
            transport?.disconnect(link);
            dropLink(link);
            return;
          }
          await db.upsertPeer(peerKey, peerName);
          patchLink(link, { phase: "secure", peerKey, safetyCode, name: peerName });
          await refreshPeers();
        },
        message: async (m) => {
          const peerKey = get().links[link]?.peerKey;
          if (!peerKey) return;
          if (!allowFrom(peerKey, m.t)) return;
          if (m.t === "ack") return setStatus(peerKey, String(m.id), "delivered");
          if (m.t !== "msg") {
            handlers.get(m.t)?.forEach((h) => {
              try {
                h(peerKey, m, link);
              } catch {
                // One feature's bug never breaks the session.
              }
            });
            return;
          }
          if (typeof m.text !== "string" || typeof m.id !== "string") return;
          const row: db.MessageRow = { id: `${peerKey.slice(0, 16)}:${m.id}`, peer: peerKey, outgoing: 0, text: m.text, ts: Date.now(), status: "received" };
          await db.addMessage(row);
          pushMessage(row);
          try {
            session.sendMessage({ t: "ack", id: String(m.id) });
          } catch {
            // Link dropped meanwhile: the sender will show "sent", not "delivered".
          }
        },
        fail: (reason) => {
          transport?.disconnect(link);
          patchLink(link, { phase: "failed", reason: `Could not secure the connection (${reason}).` });
        },
      },
    });
    sessions.set(link, session);
    session.begin();
  };

  const onEvent = (e: TransportEvent) => {
    const s = get();
    switch (e.type) {
      case "found":
        // busy: results can arrive while goVisible is still finishing.
        if (s.visible || s.busy) set({ nearby: { ...s.nearby, [e.link]: { name: e.name } } });
        break;
      case "lost": {
        const nearby = { ...s.nearby };
        delete nearby[e.link];
        set({ nearby });
        break;
      }
      case "request": {
        if (e.incoming) {
          const pending = Object.values(s.links).filter((l) => l.phase === "approve").length;
          if (!s.visible || pending >= MAX_PENDING_REQUESTS) {
            void transport?.reject(e.link).catch(() => {});
            return;
          }
          set({ links: { ...s.links, [e.link]: { link: e.link, name: e.name, incoming: true, phase: "approve", verifier: e.verifier } } });
        } else {
          // We asked for this connection, so our side accepts. The other person still has to approve.
          patchLink(e.link, { verifier: e.verifier });
          void transport?.accept(e.link).catch((err) => patchLink(e.link, { phase: "failed", reason: readable(err) }));
        }
        break;
      }
      case "connected": {
        const info = s.links[e.link];
        if (!info) return;
        patchLink(e.link, { phase: "securing" });
        // Whoever asked to connect starts the Noise handshake.
        startSession(e.link, !info.incoming);
        break;
      }
      case "failed":
        patchLink(e.link, { phase: "failed", reason: "The other person declined, or the connection failed." });
        break;
      case "disconnected":
        sessions.get(e.link)?.close();
        sessions.delete(e.link);
        dropLink(e.link);
        break;
      case "data":
        sessions.get(e.link)?.receive(e.bytes);
        break;
    }
  };

  return {
    ready: false,
    available: false,
    myName: DEFAULT_NAME,
    visible: false,
    visibleUntil: null,
    busy: false,
    error: null,
    nearby: {},
    links: {},
    peers: [],
    messages: {},

    init: async (fallbackName) => {
      // Several screens call init; the first does the work, later ones only fill in a better name.
      if (!initializing) {
        initializing = (async () => {
          if (!transport) {
            transport = createConnectTransport();
            transport.subscribe(onEvent);
          }
          identity = await loadIdentity();
          set({ ready: true, available: transport.available(), myName: await loadDisplayName(fallbackName), peers: await db.listPeers() });
          // Leaving the app hides this phone (discovery never runs unseen), but people already connected
          // stay connected, so Walkie channels and calls keep working with the screen off.
          AppState.addEventListener("change", (state) => {
            if (state !== "active" && get().visible) get().goHidden();
          });
        })();
        initializing.catch(() => {
          initializing = null;
        });
      }
      await initializing;
      if (fallbackName.trim() && get().myName === DEFAULT_NAME) set({ myName: await loadDisplayName(fallbackName) });
    },

    setName: async (name) => set({ myName: await saveDisplayName(name) }),

    goVisible: async () => {
      if (!transport?.available()) return set({ error: "Nearby is not available on this phone." });
      set({ busy: true, error: null });
      const perms = await requestNearbyPermissions();
      if (!perms.ok) {
        return set({
          busy: false,
          error: perms.blocked ? "Nearby devices permission is off. Turn it on for Cowork in Android settings." : "Cowork needs the Nearby devices permission to find people nearby.",
        });
      }
      try {
        await transport.start(get().myName);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => get().goHidden(), VISIBLE_FOR_MS);
        set({ visible: true, visibleUntil: Date.now() + VISIBLE_FOR_MS, busy: false });
      } catch (err) {
        // Only advertising and discovery stop: links that were already up stay up.
        transport.pause();
        set({ busy: false, error: readable(err) });
      }
    },

    goHidden: () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      transport?.pause();
      set({ visible: false, visibleUntil: null, nearby: {} });
    },

    disconnectAll: () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      transport?.stop();
      sessions.forEach((x) => x.close());
      sessions.clear();
      set({ visible: false, visibleUntil: null, nearby: {}, links: {} });
    },

    connect: async (link) => {
      const name = get().nearby[link]?.name ?? "Nearby phone";
      set((s) => ({ links: { ...s.links, [link]: { link, name, incoming: false, phase: "requesting" } } }));
      try {
        await transport!.connect(link, get().myName);
      } catch (err) {
        patchLink(link, { phase: "failed", reason: readable(err) });
      }
    },

    approve: async (link) => {
      patchLink(link, { phase: "securing" });
      try {
        await transport!.accept(link);
      } catch (err) {
        patchLink(link, { phase: "failed", reason: readable(err) });
      }
    },

    decline: async (link) => {
      dropLink(link);
      await transport?.reject(link).catch(() => {});
    },

    send: async (peerKey, text) => {
      const live = linkForPeer(get(), peerKey);
      const clean = text.trim().slice(0, maxTextFor(live?.link));
      if (!clean) return;
      const session = live ? sessions.get(live.link) : undefined;
      const id = Crypto.randomUUID();
      const row: db.MessageRow = { id, peer: peerKey, outgoing: 1, text: clean, ts: Date.now(), status: "sending" };
      await db.addMessage(row);
      pushMessage(row);
      if (!session) return setStatus(peerKey, id, "failed");
      try {
        session.sendMessage({ t: "msg", id, text: clean, ts: row.ts });
        setStatus(peerKey, id, "sent");
      } catch {
        setStatus(peerKey, id, "failed");
      }
    },

    loadThread: async (peerKey) => {
      const rows = await db.listMessages(peerKey);
      set((s) => ({ messages: { ...s.messages, [peerKey]: rows } }));
    },

    verify: async (peerKey) => {
      await db.setVerified(peerKey, true);
      await refreshPeers();
    },

    block: async (peerKey) => {
      await db.setBlocked(peerKey, true);
      const live = linkForPeer(get(), peerKey);
      if (live) {
        transport?.disconnect(live.link);
        dropLink(live.link);
      }
      await refreshPeers();
    },

    unblock: async (peerKey) => {
      await db.setBlocked(peerKey, false);
      await refreshPeers();
    },

    forget: async (peerKey) => {
      // Features clean up first, while still connected (so a file in flight is canceled on both phones).
      await runCleanups("forgetPeer", peerKey);
      const live = linkForPeer(get(), peerKey);
      if (live) {
        transport?.disconnect(live.link);
        dropLink(live.link);
      }
      // Straight from storage too, for features not started this session.
      deleteReceivedFiles(await fdb.deleteTransfersForPeer(peerKey).catch(() => []));
      await forgetPeerCalls(peerKey).catch(() => {});
      await db.forgetPeer(peerKey);
      received.delete(`msg:${peerKey}`);
      received.delete(`ping:${peerKey}`);
      set((s) => {
        const messages = { ...s.messages };
        delete messages[peerKey];
        return { messages };
      });
      await refreshPeers();
    },
  };
});
