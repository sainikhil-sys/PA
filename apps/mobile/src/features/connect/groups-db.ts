import * as SQLite from "expo-sqlite";

/** Offline groups, stored on this phone only (Connect's database, its own tables). */
export type MyGroupState = "invited" | "member" | "left" | "declined";
export type MemberState = "invited" | "member" | "left" | "declined";

export type GroupRow = { id: string; wireId: string; owner: string; mine: number; name: string; myState: MyGroupState; createdAt: number; lastTs: number };
export type MemberRow = { groupId: string; peer: string; name: string; state: MemberState };
export type GroupMessageRow = { id: string; groupId: string; sender: string; senderName: string; outgoing: number; text: string; ts: number; total: number; missed: string };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync("connect.db");
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS groups_ (id TEXT PRIMARY KEY NOT NULL, wireId TEXT NOT NULL, owner TEXT NOT NULL, mine INTEGER NOT NULL, name TEXT NOT NULL, myState TEXT NOT NULL, createdAt INTEGER NOT NULL, lastTs INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS group_members (groupId TEXT NOT NULL, peer TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (groupId, peer));
      CREATE TABLE IF NOT EXISTS group_messages (id TEXT PRIMARY KEY NOT NULL, groupId TEXT NOT NULL, sender TEXT NOT NULL, senderName TEXT NOT NULL, outgoing INTEGER NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL, total INTEGER NOT NULL DEFAULT 0, missed TEXT NOT NULL DEFAULT '[]');
      CREATE INDEX IF NOT EXISTS group_messages_group_ts ON group_messages (groupId, ts);
    `);
    return d;
  })();
  return dbPromise;
}

export async function listGroups() {
  return (await db()).getAllAsync<GroupRow>("SELECT * FROM groups_ ORDER BY lastTs DESC LIMIT 200");
}

export async function listMembers() {
  return (await db()).getAllAsync<MemberRow>("SELECT * FROM group_members");
}

export async function upsertGroup(g: GroupRow) {
  await (await db()).runAsync(
    `INSERT INTO groups_ (id, wireId, owner, mine, name, myState, createdAt, lastTs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, myState = excluded.myState, lastTs = excluded.lastTs`,
    g.id, g.wireId, g.owner, g.mine, g.name, g.myState, g.createdAt, g.lastTs,
  );
}

export async function setMembers(groupId: string, rows: MemberRow[]) {
  const d = await db();
  await d.withTransactionAsync(async () => {
    await d.runAsync("DELETE FROM group_members WHERE groupId = ?", groupId);
    for (const r of rows) await d.runAsync("INSERT INTO group_members (groupId, peer, name, state) VALUES (?, ?, ?, ?)", groupId, r.peer, r.name, r.state);
  });
}

export async function addMessage(m: GroupMessageRow) {
  await (await db()).runAsync(
    "INSERT OR IGNORE INTO group_messages (id, groupId, sender, senderName, outgoing, text, ts, total, missed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    m.id, m.groupId, m.sender, m.senderName, m.outgoing, m.text, m.ts, m.total, m.missed,
  );
}

export async function listMessages(groupId: string) {
  return (await db()).getAllAsync<GroupMessageRow>("SELECT * FROM group_messages WHERE groupId = ? ORDER BY ts ASC LIMIT 1000", groupId);
}

export async function deleteGroup(groupId: string) {
  const d = await db();
  await d.runAsync("DELETE FROM group_messages WHERE groupId = ?", groupId);
  await d.runAsync("DELETE FROM group_members WHERE groupId = ?", groupId);
  await d.runAsync("DELETE FROM groups_ WHERE id = ?", groupId);
}

/** Deletes every group, member list and group message (Connect reset, sign-out). */
export async function clearAll() {
  const d = await db();
  await d.runAsync("DELETE FROM group_messages");
  await d.runAsync("DELETE FROM group_members");
  await d.runAsync("DELETE FROM groups_");
}
