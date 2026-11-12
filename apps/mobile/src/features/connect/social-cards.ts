import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { create } from "zustand";
import { onConnectMessage, sendToPeer } from "./connect-store";
import type { CardFields } from "./social-api";

/**
 * Offline business card exchange over Connect. A card goes to one person you are connected to right
 * now, inside the encrypted session ("card.share"). Cards you receive are kept only on this phone
 * (app-private storage), with the sender's Connect key so you can tell where it came from.
 */
export type ReceivedCard = CardFields & { id: string; peerKey: string; via: "nearby" | "link"; receivedAt: number };

const LIMITS: Record<keyof CardFields, number> = { displayName: 80, headline: 120, organization: 120, email: 254, phone: 32, website: 300, note: 300 };
const FIELDS = Object.keys(LIMITS) as (keyof CardFields)[];

/** Peers are untrusted: every field must be a short string, the name must exist, links must be http(s). */
export function cleanCard(raw: unknown): CardFields | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out = {} as CardFields;
  for (const f of FIELDS) {
    const v = r[f] ?? "";
    if (typeof v !== "string") return null;
    out[f] = v.trim().slice(0, LIMITS[f]);
  }
  if (!out.displayName) return null;
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = "";
  if (out.phone && !/^[+0-9 ()-]*$/.test(out.phone)) out.phone = "";
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) out.email = "";
  return out;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("connect-social.db");
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY NOT NULL, peerKey TEXT NOT NULL, via TEXT NOT NULL, json TEXT NOT NULL, receivedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS cards_received ON cards (receivedAt);
    `);
    return d;
  })();
  return dbPromise;
}

type Row = { id: string; peerKey: string; via: string; json: string; receivedAt: number };
const toCard = (r: Row): ReceivedCard | null => {
  try {
    const c = cleanCard(JSON.parse(r.json));
    return c ? { ...c, id: r.id, peerKey: r.peerKey, via: r.via === "link" ? "link" : "nearby", receivedAt: r.receivedAt } : null;
  } catch {
    return null;
  }
};

type State = {
  cards: ReceivedCard[];
  lastReceived: ReceivedCard | null;
  load: () => Promise<void>;
  save: (card: CardFields, peerKey: string, via: ReceivedCard["via"]) => Promise<ReceivedCard>;
  remove: (id: string) => Promise<void>;
  clearLast: () => void;
};

export const useReceivedCards = create<State>((set, get) => ({
  cards: [],
  lastReceived: null,
  load: async () => {
    const rows = await (await db()).getAllAsync<Row>("SELECT * FROM cards ORDER BY receivedAt DESC LIMIT 500");
    set({ cards: rows.map(toCard).filter((c): c is ReceivedCard => Boolean(c)) });
  },
  save: async (card, peerKey, via) => {
    const d = await db();
    // One card per sender: a newer card from the same person replaces the old one.
    if (peerKey) await d.runAsync("DELETE FROM cards WHERE peerKey = ? AND via = ?", peerKey, via);
    const row: ReceivedCard = { ...card, id: Crypto.randomUUID(), peerKey, via, receivedAt: Date.now() };
    await d.runAsync("INSERT INTO cards (id, peerKey, via, json, receivedAt) VALUES (?, ?, ?, ?, ?)", row.id, peerKey, via, JSON.stringify(card), row.receivedAt);
    await get().load();
    return row;
  },
  remove: async (id) => {
    await (await db()).runAsync("DELETE FROM cards WHERE id = ?", id);
    set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));
  },
  clearLast: () => set({ lastReceived: null }),
}));

/** Sends your card to someone connected right now. False when they are not connected. */
export function shareCardWith(peerKey: string, card: CardFields): boolean {
  const clean = cleanCard(card);
  if (!clean) return false;
  return sendToPeer(peerKey, { t: "card.share", v: 1, card: clean });
}

// Registered once, when this module is first imported (the Connect layout imports it).
let registered = false;
export function registerCardReceiver() {
  if (registered) return;
  registered = true;
  onConnectMessage("card.share", (peerKey, m) => {
    if (m.v !== 1) return;
    const card = cleanCard(m.card);
    if (!card) return;
    void useReceivedCards
      .getState()
      .save(card, peerKey, "nearby")
      .then((saved) => useReceivedCards.setState({ lastReceived: saved }))
      .catch(() => {});
  });
}
registerCardReceiver();
