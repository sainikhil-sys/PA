import * as SQLite from "expo-sqlite";
import type { TransferKind } from "./files-logic";

/**
 * Transfer history, in Connect's on-phone database (its own tables). File keys are never stored:
 * they live in memory only for the life of one transfer, so a transfer interrupted by closing the
 * app cannot resume and is shown as failed.
 */
export type TransferStatus =
  | "offered" // sender: waiting for the other person to accept
  | "incoming" // receiver: waiting for my approval
  | "accepted" // receiver: approved, waiting for the data
  | "sending"
  | "receiving"
  | "sent"
  | "received"
  | "viewed" // view-once snap: opened and deleted
  | "declined"
  | "canceled"
  | "expired"
  | "failed";

export type TransferRow = {
  id: string;
  transferId: string;
  peer: string;
  peerName: string;
  outgoing: number;
  kind: TransferKind;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  thumb: string | null;
  status: TransferStatus;
  bytesDone: number;
  uri: string | null;
  disappearing: number;
  durationMs: number | null;
  batchId: string | null;
  error: string | null;
  ts: number;
  expiresAt: number;
};

export const ACTIVE: TransferStatus[] = ["offered", "incoming", "accepted", "sending", "receiving"];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("connect.db");
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY NOT NULL, transferId TEXT NOT NULL, peer TEXT NOT NULL, peerName TEXT NOT NULL, outgoing INTEGER NOT NULL,
        kind TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL, thumb TEXT,
        status TEXT NOT NULL, bytesDone INTEGER NOT NULL DEFAULT 0, uri TEXT, disappearing INTEGER NOT NULL DEFAULT 0,
        durationMs INTEGER, batchId TEXT, error TEXT, ts INTEGER NOT NULL, expiresAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS transfers_peer_ts ON transfers (peer, ts);
      CREATE INDEX IF NOT EXISTS transfers_ts ON transfers (ts);
    `);
    return d;
  })();
  return dbPromise;
}

export async function insertTransfer(t: TransferRow) {
  await (await db()).runAsync(
    `INSERT OR IGNORE INTO transfers (id, transferId, peer, peerName, outgoing, kind, name, size, mime, sha256, thumb, status, bytesDone, uri, disappearing, durationMs, batchId, error, ts, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id, t.transferId, t.peer, t.peerName, t.outgoing, t.kind, t.name, t.size, t.mime, t.sha256, t.thumb, t.status, t.bytesDone, t.uri, t.disappearing, t.durationMs, t.batchId, t.error, t.ts, t.expiresAt,
  );
}

type Patch = Partial<Pick<TransferRow, "status" | "bytesDone" | "uri" | "thumb" | "error">>;

export async function patchTransfer(id: string, patch: Patch) {
  const keys = Object.keys(patch) as (keyof Patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  await (await db()).runAsync(`UPDATE transfers SET ${sets} WHERE id = ?`, ...keys.map((k) => patch[k] ?? null), id);
}

export async function listTransfers(limit = 300) {
  return (await db()).getAllAsync<TransferRow>("SELECT * FROM transfers ORDER BY ts DESC LIMIT ?", limit);
}

export async function deleteTransfer(id: string) {
  await (await db()).runAsync("DELETE FROM transfers WHERE id = ?", id);
}

export async function deleteTransfersForPeer(peer: string) {
  const d = await db();
  const rows = await d.getAllAsync<Pick<TransferRow, "uri" | "outgoing">>("SELECT uri, outgoing FROM transfers WHERE peer = ?", peer);
  await d.runAsync("DELETE FROM transfers WHERE peer = ?", peer);
  return rows;
}

/** Deletes every transfer (Connect reset, sign-out). Returns the rows so received files can be deleted. */
export async function clearAllTransfers() {
  const d = await db();
  const rows = await d.getAllAsync<Pick<TransferRow, "uri" | "outgoing">>("SELECT uri, outgoing FROM transfers");
  await d.runAsync("DELETE FROM transfers");
  return rows;
}

/** Keys are gone after a restart, so anything mid-flight then cannot finish. */
export async function failInterrupted() {
  const d = await db();
  const now = Date.now();
  await d.runAsync(
    `UPDATE transfers SET status = 'expired' WHERE status IN ('offered', 'incoming') AND expiresAt <= ?`,
    now,
  );
  await d.runAsync(
    `UPDATE transfers SET status = 'failed', error = 'Stopped when Cowork closed.' WHERE status IN ('offered', 'incoming', 'accepted', 'sending', 'receiving')`,
  );
}
