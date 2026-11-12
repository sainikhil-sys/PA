/**
 * Pure rules for offline groups: wire validation and membership. No React Native imports.
 *
 * A group belongs to the person who made it (the owner). Wire messages, each sent one to one over
 * that pair's own encrypted session:
 *   group.invite { groupId, action: "invite", name, members }   owner to an invitee
 *   group.invite { groupId, owner, action: "accept" | "decline" } invitee to owner
 *   group.invite { groupId, action: "roster", name, members }   owner to every member after a change
 *   group.msg    { groupId, owner, id, text, ts }               any member to every other member
 *   group.leave  { groupId, owner }                              a member to every other member
 * Only people who accepted are members. Nobody but the owner can change the member list.
 */
export const MAX_MEMBERS = 16;
export const MAX_GROUP_NAME = 40;
export const MAX_GROUP_TEXT = 4000;
export const MAX_PENDING_INVITES = 10;

export type RosterEntry = { key: string; name: string };

export const isPeerKey = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const isWireId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);

/** Local id: the owner's key prefix plus their group id, so two owners can never collide. */
export const localGroupId = (owner: string, wireId: string) => `${owner.slice(0, 16)}:${wireId}`;

export function cleanGroupName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME);
  return s || null;
}

function cleanName(v: unknown): string {
  return cleanGroupName(v) ?? "Cowork user";
}

function parseRoster(v: unknown): RosterEntry[] | null {
  if (!Array.isArray(v) || v.length > MAX_MEMBERS) return null;
  const out: RosterEntry[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const e = x as Record<string, unknown>;
    if (!isPeerKey(e.key)) return null;
    if (out.some((o) => o.key === e.key)) continue;
    out.push({ key: e.key, name: cleanName(e.name) });
  }
  return out;
}

type RosterMsg = { groupId: string; name: string; members: RosterEntry[] };
export type InviteMsg =
  | ({ action: "invite" } & RosterMsg)
  | ({ action: "roster" } & RosterMsg)
  | { action: "accept"; groupId: string; owner: string }
  | { action: "decline"; groupId: string; owner: string };

export function parseInvite(m: Record<string, unknown>): InviteMsg | null {
  if (!isWireId(m.groupId)) return null;
  if (m.action === "invite" || m.action === "roster") {
    const name = cleanGroupName(m.name);
    const members = parseRoster(m.members);
    if (!name || !members) return null;
    return m.action === "invite" ? { action: "invite", groupId: m.groupId, name, members } : { action: "roster", groupId: m.groupId, name, members };
  }
  if (m.action === "accept" || m.action === "decline") {
    if (!isPeerKey(m.owner)) return null;
    return m.action === "accept" ? { action: "accept", groupId: m.groupId, owner: m.owner } : { action: "decline", groupId: m.groupId, owner: m.owner };
  }
  return null;
}

export type GroupTextMsg = { groupId: string; owner: string; id: string; text: string; ts: number };

export function parseGroupMsg(m: Record<string, unknown>): GroupTextMsg | null {
  if (!isWireId(m.groupId) || !isPeerKey(m.owner)) return null;
  if (typeof m.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(m.id)) return null;
  if (typeof m.text !== "string") return null;
  const text = m.text.slice(0, MAX_GROUP_TEXT).trim();
  if (!text) return null;
  const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : Date.now();
  return { groupId: m.groupId, owner: m.owner, id: m.id, text, ts };
}

export function parseLeave(m: Record<string, unknown>): { groupId: string; owner: string } | null {
  if (!isWireId(m.groupId) || !isPeerKey(m.owner)) return null;
  return { groupId: m.groupId, owner: m.owner };
}

/** Whether `sender` may post in a group, given its current member keys (owner included). */
export function maySend(sender: string, memberKeys: string[]): boolean {
  return memberKeys.includes(sender);
}

/** "Not delivered to Asha and Bilal" style summary for a group message. */
export function deliverySummary(total: number, missed: string[]): string {
  if (total === 0) return "Nobody else in this group yet";
  if (!missed.length) return total === 1 ? "Sent" : `Sent to all ${total}`;
  if (missed.length === total) return "Not delivered: nobody is connected";
  const names = missed.length <= 2 ? missed.join(" and ") : `${missed.slice(0, 2).join(", ")} and ${missed.length - 2} more`;
  return `Not delivered to ${names}`;
}
