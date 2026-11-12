import * as SQLite from "expo-sqlite";
import type { HistoryStatus, Person } from "./calls-logic";

/**
 * Call history, on this phone only (its own database file, app-private). Holds who, when, how long
 * and how it ended. Never audio, never keys.
 */
export type CallRow = {
  id: string;
  direction: "outgoing" | "incoming";
  people: Person[];
  status: HistoryStatus;
  startedAt: number;
  connectedAt: number | null;
  endedAt: number;
};

type RawRow = Omit<CallRow, "people"> & { people: string };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("connect-calls.db");
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY NOT NULL, direction TEXT NOT NULL, people TEXT NOT NULL, status TEXT NOT NULL, startedAt INTEGER NOT NULL, connectedAt INTEGER, endedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS calls_started ON calls (startedAt);
    `);
    return d;
  })();
  return dbPromise;
}

function parsePeople(json: string): Person[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((p): p is Person => !!p && typeof p.key === "string" && typeof p.name === "string");
  } catch {
    return [];
  }
}

export async function addCall(row: CallRow) {
  await (await db()).runAsync(
    "INSERT OR REPLACE INTO calls (id, direction, people, status, startedAt, connectedAt, endedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    row.id,
    row.direction,
    JSON.stringify(row.people.map((p) => ({ key: p.key, name: p.name }))),
    row.status,
    row.startedAt,
    row.connectedAt,
    row.endedAt,
  );
}

export async function listCalls(): Promise<CallRow[]> {
  const rows = await (await db()).getAllAsync<RawRow>("SELECT * FROM calls ORDER BY startedAt DESC LIMIT 200");
  return rows.map((r) => ({ ...r, people: parsePeople(r.people) }));
}

export async function clearCalls() {
  await (await db()).runAsync("DELETE FROM calls");
}

/** Removes calls that involved this person (for "Delete chat", which forgets them). */
export async function forgetPeerCalls(peerKey: string) {
  if (!/^[0-9a-f]{64}$/.test(peerKey)) return;
  await (await db()).runAsync("DELETE FROM calls WHERE people LIKE ?", `%"key":"${peerKey}"%`);
}
