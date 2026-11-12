import "./random";
import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { toHex } from "./bytes";
import { onConnectCleanup, onConnectMessage, sendToPeer, useConnect } from "./connect-store";
import * as gdb from "./groups-db";
import type { GroupMessageRow, GroupRow, MemberRow } from "./groups-db";
import { cleanGroupName, localGroupId, MAX_GROUP_TEXT, MAX_MEMBERS, MAX_PENDING_INVITES, maySend, parseGroupMsg, parseInvite, parseLeave, type RosterEntry } from "./groups-logic";
import { loadIdentity } from "./identity";

/**
 * Offline groups over Connect. There is no group server and no group key: every message is sent
 * separately to each member over that person's own encrypted session, so a member who is not
 * connected right now does not get it, and the sender sees who missed it. Protocol: groups-logic.ts.
 */
type GroupsState = {
  started: boolean;
  loaded: boolean;
  myKey: string | null;
  groups: GroupRow[];
  members: Record<string, MemberRow[]>;
  messages: Record<string, GroupMessageRow[]>;
  start: () => void;
  create: (name: string, peers: string[]) => Promise<{ id: string | null; error: string | null; notReached: string[] }>;
  invite: (groupId: string, peers: string[]) => Promise<string[]>;
  accept: (groupId: string) => Promise<string | null>;
  decline: (groupId: string) => Promise<void>;
  send: (groupId: string, text: string) => Promise<void>;
  leave: (groupId: string) => Promise<void>;
  remove: (groupId: string) => Promise<void>;
  loadMessages: (groupId: string) => Promise<void>;
};

const nameOf = (peer: string) => {
  const s = useConnect.getState();
  return s.peers.find((p) => p.key === peer)?.name ?? Object.values(s.links).find((l) => l.peerKey === peer)?.name ?? "Cowork user";
};
const blocked = (peer: string) => Boolean(useConnect.getState().peers.find((p) => p.key === peer)?.blocked);

/** Everyone in a group I can currently send to (accepted members, owner included, not me). */
export function activeMembers(members: MemberRow[] | undefined): MemberRow[] {
  return (members ?? []).filter((m) => m.state === "member");
}

/** Resolves once history and this phone's key are loaded; handlers wait for it. */
let ready: Promise<void> | null = null;

export const useGroups = create<GroupsState>((set, get) => {
  const group = (id: string) => get().groups.find((g) => g.id === id);
  const saveGroup = async (g: GroupRow) => {
    set((s) => ({ groups: [g, ...s.groups.filter((x) => x.id !== g.id)].sort((a, b) => b.lastTs - a.lastTs) }));
    await gdb.upsertGroup(g).catch(() => {});
  };
  const saveMembers = async (groupId: string, rows: MemberRow[]) => {
    set((s) => ({ members: { ...s.members, [groupId]: rows } }));
    await gdb.setMembers(groupId, rows).catch(() => {});
  };
  const pushMessage = async (m: GroupMessageRow) => {
    set((s) => ({ messages: { ...s.messages, [m.groupId]: [...(s.messages[m.groupId] ?? []).filter((x) => x.id !== m.id), m] } }));
    await gdb.addMessage(m).catch(() => {});
    const g = group(m.groupId);
    if (g) await saveGroup({ ...g, lastTs: Math.max(g.lastTs, m.ts) });
  };
  const systemNote = (groupId: string, text: string) =>
    pushMessage({ id: `sys:${Crypto.randomUUID()}`, groupId, sender: "", senderName: "", outgoing: 0, text, ts: Date.now(), total: 0, missed: "[]" });

  /** Owner only: sends the accepted member list to every member. */
  const broadcastRoster = (g: GroupRow) => {
    const me = get().myKey;
    if (!g.mine || !me) return;
    const accepted = activeMembers(get().members[g.id]);
    const roster: RosterEntry[] = [{ key: me, name: useConnect.getState().myName }, ...accepted.map((m) => ({ key: m.peer, name: m.name }))];
    accepted.forEach((m) => sendToPeer(m.peer, { t: "group.invite", groupId: g.wireId, action: "roster", name: g.name, members: roster }));
  };

  const onInvite = async (peer: string, raw: Record<string, unknown>) => {
    await ready;
    if (blocked(peer)) return;
    const msg = parseInvite(raw);
    const me = get().myKey;
    if (!msg || !me) return;

    if (msg.action === "accept" || msg.action === "decline") {
      // Answers come to me as the owner.
      if (msg.owner !== me) return;
      const g = group(localGroupId(me, msg.groupId));
      if (!g?.mine || g.myState !== "member") return;
      const rows = get().members[g.id] ?? [];
      const row = rows.find((r) => r.peer === peer);
      if (!row || row.state !== "invited") return;
      const next = rows.map((r) => (r.peer === peer ? { ...r, state: msg.action === "accept" ? ("member" as const) : ("declined" as const), name: nameOf(peer) } : r));
      await saveMembers(g.id, next);
      await systemNote(g.id, msg.action === "accept" ? `${row.name} joined.` : `${row.name} declined the invitation.`);
      if (msg.action === "accept") broadcastRoster(g);
      return;
    }

    const id = localGroupId(peer, msg.groupId);
    const existing = group(id);
    if (msg.action === "invite") {
      if (existing && existing.myState === "member") return;
      const pending = get().groups.filter((g) => g.myState === "invited").length;
      if (!existing && pending >= MAX_PENDING_INVITES) return;
      const now = Date.now();
      await saveGroup({ id, wireId: msg.groupId, owner: peer, mine: 0, name: msg.name, myState: "invited", createdAt: existing?.createdAt ?? now, lastTs: now });
      // Shown as "members so far" until I accept; the owner sends the real list after.
      const rows: MemberRow[] = [{ groupId: id, peer, name: nameOf(peer), state: "member" }, ...msg.members.filter((x) => x.key !== me && x.key !== peer).map((x) => ({ groupId: id, peer: x.key, name: x.name, state: "member" as const }))];
      await saveMembers(id, rows);
      return;
    }

    // Roster: only the owner may change who is in the group.
    if (msg.action !== "roster") return;
    if (!existing || existing.owner !== peer || existing.myState !== "member") return;
    const inList = msg.members.some((x) => x.key === me);
    const before = new Set(activeMembers(get().members[id]).map((m) => m.peer));
    const rows: MemberRow[] = [{ groupId: id, peer, name: nameOf(peer), state: "member" }, ...msg.members.filter((x) => x.key !== me && x.key !== peer).map((x) => ({ groupId: id, peer: x.key, name: x.name, state: "member" as const }))];
    await saveMembers(id, rows);
    await saveGroup({ ...existing, name: msg.name, myState: inList ? "member" : "left" });
    const joined = rows.filter((r) => !before.has(r.peer));
    if (joined.length && before.size) await systemNote(id, `${joined.map((r) => r.name).join(", ")} joined.`);
    if (!inList) await systemNote(id, "You are no longer in this group.");
  };

  const onMsg = async (peer: string, raw: Record<string, unknown>) => {
    await ready;
    const msg = parseGroupMsg(raw);
    if (!msg || blocked(peer)) return;
    const id = localGroupId(msg.owner, msg.groupId);
    const g = group(id);
    if (!g || g.myState !== "member") return;
    const members = activeMembers(get().members[id]);
    if (!maySend(peer, members.map((m) => m.peer))) return;
    const sender = members.find((m) => m.peer === peer)!;
    await pushMessage({ id: `${peer.slice(0, 16)}:${msg.id}`, groupId: id, sender: peer, senderName: sender.name, outgoing: 0, text: msg.text, ts: Date.now(), total: 0, missed: "[]" });
  };

  const onLeave = async (peer: string, raw: Record<string, unknown>) => {
    await ready;
    const msg = parseLeave(raw);
    if (!msg) return;
    const id = localGroupId(msg.owner, msg.groupId);
    const g = group(id);
    if (!g || g.myState !== "member") return;
    const rows = get().members[id] ?? [];
    const row = rows.find((r) => r.peer === peer);
    if (!row || row.state === "left") return;
    await saveMembers(id, rows.map((r) => (r.peer === peer ? { ...r, state: "left" as const } : r)));
    await systemNote(id, peer === g.owner ? `${row.name} left. They made this group, so nobody new can join.` : `${row.name} left.`);
    if (g.mine) broadcastRoster(g);
  };

  return {
    started: false,
    loaded: false,
    myKey: null,
    groups: [],
    members: {},
    messages: {},

    start: () => {
      if (get().started) return;
      set({ started: true });
      onConnectMessage("group.invite", (peer, m) => void onInvite(peer, m));
      onConnectMessage("group.msg", (peer, m) => void onMsg(peer, m));
      onConnectMessage("group.leave", (peer, m) => void onLeave(peer, m));
      // Storage is cleared by resetConnect; this drops what is held in memory.
      onConnectCleanup({ reset: () => set({ groups: [], members: {}, messages: {} }) });
      ready = (async () => {
        try {
          const [kp, groups, members] = await Promise.all([loadIdentity(), gdb.listGroups(), gdb.listMembers()]);
          const byGroup: Record<string, MemberRow[]> = {};
          members.forEach((m) => (byGroup[m.groupId] ??= []).push(m));
          set((s) => ({
            myKey: toHex(kp.publicKey),
            loaded: true,
            groups: [...s.groups, ...groups.filter((g) => !s.groups.some((x) => x.id === g.id))].sort((a, b) => b.lastTs - a.lastTs),
            members: { ...byGroup, ...s.members },
          }));
        } catch {
          set({ loaded: true });
        }
      })();
    },

    create: async (rawName, peers) => {
      const me = get().myKey;
      const name = cleanGroupName(rawName);
      if (!me) return { id: null, error: "Connect is still starting. Try again in a moment.", notReached: [] };
      if (!name) return { id: null, error: "Give the group a name.", notReached: [] };
      const unique = [...new Set(peers)].filter((p) => p !== me);
      if (!unique.length) return { id: null, error: "Pick at least one person.", notReached: [] };
      if (unique.length > MAX_MEMBERS - 1) return { id: null, error: `A group can have up to ${MAX_MEMBERS} people.`, notReached: [] };
      const wireId = Crypto.randomUUID();
      const id = localGroupId(me, wireId);
      const now = Date.now();
      const g: GroupRow = { id, wireId, owner: me, mine: 1, name, myState: "member", createdAt: now, lastTs: now };
      await saveGroup(g);
      await saveMembers(id, []);
      const notReached = await get().invite(id, unique);
      return { id, error: null, notReached };
    },

    invite: async (groupId, peers) => {
      const g = group(groupId);
      const me = get().myKey;
      if (!g?.mine || !me || g.myState !== "member") return peers;
      const rows = [...(get().members[groupId] ?? [])];
      const room = MAX_MEMBERS - 1 - rows.filter((r) => r.state === "member" || r.state === "invited").length;
      const notReached: string[] = [];
      const roster: RosterEntry[] = [{ key: me, name: useConnect.getState().myName }, ...activeMembers(rows).map((m) => ({ key: m.peer, name: m.name }))];
      let added = 0;
      for (const peer of peers) {
        if (peer === me || rows.some((r) => r.peer === peer && r.state === "member")) continue;
        if (added >= room) {
          notReached.push(nameOf(peer));
          continue;
        }
        const ok = sendToPeer(peer, { t: "group.invite", groupId: g.wireId, action: "invite", name: g.name, members: roster });
        if (!ok) {
          notReached.push(nameOf(peer));
          continue;
        }
        added += 1;
        const row: MemberRow = { groupId, peer, name: nameOf(peer), state: "invited" };
        const i = rows.findIndex((r) => r.peer === peer);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      }
      await saveMembers(groupId, rows);
      return notReached;
    },

    accept: async (groupId) => {
      const g = group(groupId);
      const me = get().myKey;
      if (!g || g.myState !== "invited" || !me) return "This invitation is no longer open.";
      if (!sendToPeer(g.owner, { t: "group.invite", groupId: g.wireId, owner: g.owner, action: "accept" })) {
        return `${nameOf(g.owner)} needs to be connected for you to join.`;
      }
      await saveGroup({ ...g, myState: "member", lastTs: Date.now() });
      await systemNote(groupId, "You joined.");
      return null;
    },

    decline: async (groupId) => {
      const g = group(groupId);
      if (!g || g.myState !== "invited") return;
      sendToPeer(g.owner, { t: "group.invite", groupId: g.wireId, owner: g.owner, action: "decline" });
      await gdb.deleteGroup(groupId).catch(() => {});
      set((s) => ({ groups: s.groups.filter((x) => x.id !== groupId) }));
    },

    send: async (groupId, text) => {
      const g = group(groupId);
      const clean = text.trim().slice(0, MAX_GROUP_TEXT);
      if (!g || g.myState !== "member" || !clean) return;
      const id = Crypto.randomUUID();
      const ts = Date.now();
      const members = activeMembers(get().members[groupId]);
      const missed: string[] = [];
      for (const m of members) {
        if (!sendToPeer(m.peer, { t: "group.msg", groupId: g.wireId, owner: g.owner, id, text: clean, ts })) missed.push(m.name);
      }
      await pushMessage({ id, groupId, sender: "", senderName: "You", outgoing: 1, text: clean, ts, total: members.length, missed: JSON.stringify(missed) });
    },

    leave: async (groupId) => {
      const g = group(groupId);
      if (!g || g.myState !== "member") return;
      activeMembers(get().members[groupId]).forEach((m) => sendToPeer(m.peer, { t: "group.leave", groupId: g.wireId, owner: g.owner }));
      await saveGroup({ ...g, myState: "left" });
      await systemNote(groupId, "You left. Members who were not connected may keep sending until they connect again; those messages are ignored.");
    },

    remove: async (groupId) => {
      if (group(groupId)?.myState === "member") await get().leave(groupId);
      await gdb.deleteGroup(groupId).catch(() => {});
      set((s) => {
        const members = { ...s.members };
        const messages = { ...s.messages };
        delete members[groupId];
        delete messages[groupId];
        return { groups: s.groups.filter((x) => x.id !== groupId), members, messages };
      });
    },

    loadMessages: async (groupId) => {
      const rows = await gdb.listMessages(groupId).catch(() => [] as GroupMessageRow[]);
      set((s) => ({ messages: { ...s.messages, [groupId]: [...rows, ...(s.messages[groupId] ?? []).filter((m) => !rows.some((r) => r.id === m.id))].sort((a, b) => a.ts - b.ts) } }));
    },
  };
});

/** Starts listening for group messages. Safe to call more than once. */
export function startGroups() {
  useGroups.getState().start();
}
