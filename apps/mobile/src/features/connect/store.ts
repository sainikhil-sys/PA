import * as SQLite from "expo-sqlite";

/**
 * Connect's on-phone storage (app-private; Android backup is off for Cowork). Peers are identified by
 * their public key. Messages stay on this phone: nothing here is sent to the Cowork server.
 */
export type PeerRow = { key: string; name: string; verified: number; blocked: number; lastSeen: number };
export type MessageRow = { id: string; peer: string; outgoing: number; text: string; ts: number; status: "sending" | "sent" | "delivered" | "received" | "failed" };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("connect.db");
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS peers (key TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, lastSeen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY NOT NULL, peer TEXT NOT NULL, outgoing INTEGER NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_peer_ts ON messages (peer, ts);
    `);
    return d;
  })();
  return dbPromise;
}

export async function upsertPeer(key: string, name: string) {
  await (await db()).runAsync(
    "INSERT INTO peers (key, name, lastSeen) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, lastSeen = excluded.lastSeen",
    key,
    name,
    Date.now(),
  );
}

export async function getPeer(key: string) {
  return (await db()).getFirstAsync<PeerRow>("SELECT * FROM peers WHERE key = ?", key);
}

export async function listPeers() {
  return (await db()).getAllAsync<PeerRow>("SELECT * FROM peers ORDER BY lastSeen DESC LIMIT 200");
}

export async function setVerified(key: string, verified: boolean) {
  await (await db()).runAsync("UPDATE peers SET verified = ? WHERE key = ?", verified ? 1 : 0, key);
}

export async function setBlocked(key: string, blocked: boolean) {
  await (await db()).runAsync("UPDATE peers SET blocked = ? WHERE key = ?", blocked ? 1 : 0, key);
}

export async function addMessage(m: MessageRow) {
  await (await db()).runAsync("INSERT OR IGNORE INTO messages (id, peer, outgoing, text, ts, status) VALUES (?, ?, ?, ?, ?, ?)", m.id, m.peer, m.outgoing, m.text, m.ts, m.status);
}

export async function setMessageStatus(id: string, status: MessageRow["status"]) {
  await (await db()).runAsync("UPDATE messages SET status = ? WHERE id = ?", status, id);
}

export async function listMessages(peer: string) {
  return (await db()).getAllAsync<MessageRow>("SELECT * FROM messages WHERE peer = ? ORDER BY ts ASC LIMIT 1000", peer);
}

/** Deletes a conversation and forgets the person (used by "Delete chat"). */
export async function forgetPeer(key: string) {
  const d = await db();
  await d.runAsync("DELETE FROM messages WHERE peer = ?", key);
  await d.runAsync("DELETE FROM peers WHERE key = ?", key);
}

/** Deletes every conversation and every person (Connect reset, sign-out). */
export async function clearAll() {
  const d = await db();
  await d.runAsync("DELETE FROM messages");
  await d.runAsync("DELETE FROM peers");
}
