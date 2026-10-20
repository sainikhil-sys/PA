import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { MessageMemory, User } from "@/lib/db/schema";
import { logActivity } from "@/lib/db/queries/activity";
import { log } from "@/lib/log";
import { stripInvisible } from "@/lib/security/sanitize";
import type { Trace } from "@/lib/trace";
import { findDuplicate, groundedIn, hasMemoryCue, looksSensitive, rankMemories, type MemoryKind } from "./memory-rank";

/**
 * The owner's memory. Only ever written from the owner's own words (Settings,
 * or their own chat/voice message): never from email, web pages or documents.
 */

export const MEMORY_LIMIT = 300;
const PROMPT_CHAR_BUDGET = 2500;
const MAX_MESSAGE_CHARS = 1500;

export type SaveMemoryResult =
  | { status: "saved" | "updated" | "exists"; memory: { id: string; content: string; kind: string }; previous?: string }
  | { status: "full" };

/** Insert a memory unless it is already there; a more detailed version updates the old one in place. */
export async function saveMemory(
  userId: string,
  input: { content: string; kind: MemoryKind; source: "settings" | "chat" | "voice"; conversationId?: string | null },
): Promise<SaveMemoryResult> {
  const content = stripInvisible(input.content).replace(/\s+/g, " ").trim().slice(0, 500);
  const m = schema.memories;
  const existing = await db()
    .select({ id: m.id, content: m.content, kind: m.kind })
    .from(m)
    .where(eq(m.userId, userId))
    .orderBy(desc(m.createdAt))
    .limit(MEMORY_LIMIT + 50);

  const dup = findDuplicate(existing, content);
  if (dup) {
    const row = existing.find((r) => r.id === dup.id)!;
    if (dup.relation === "same") return { status: "exists", memory: row };
    await db()
      .update(m)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(m.id, row.id), eq(m.userId, userId)));
    return { status: "updated", memory: { ...row, content }, previous: row.content };
  }
  if (existing.length >= MEMORY_LIMIT) return { status: "full" };
  const [row] = await db()
    .insert(m)
    .values({ userId, content, kind: input.kind, source: input.source, conversationId: input.conversationId ?? null })
    .returning({ id: m.id, content: m.content, kind: m.kind });
  return { status: "saved", memory: row! };
}

/**
 * Save what the planner pulled from the owner's OWN message, behind
 * deterministic gates: a memory cue in the message, every item grounded in the
 * message's words, and nothing that looks like a secret.
 */
export async function captureMemories(
  user: User,
  opts: { message: string; planned: { content: string; kind: MemoryKind }[]; enabled: boolean; source: "chat" | "voice"; conversationId: string; trace: Trace },
): Promise<{ results: MessageMemory[]; promptNote: string }> {
  if (!hasMemoryCue(opts.message) || opts.message.length > MAX_MESSAGE_CHARS) return { results: [], promptNote: "" };
  if (!opts.enabled) {
    return {
      results: [],
      promptNote: "\nAutomatic memory is switched off, so nothing was saved this turn. If the owner wants something remembered, they can add it in Settings > Agent > Memory.",
    };
  }

  const results: MessageMemory[] = [];
  let sensitive = false;
  let full = false;
  for (const item of opts.planned.slice(0, 3)) {
    if (looksSensitive(item.content)) {
      sensitive = true;
      continue;
    }
    if (!groundedIn(opts.message, item.content)) {
      log.warn("memory.ungrounded");
      continue;
    }
    const r = await saveMemory(user.id, { content: item.content, kind: item.kind, source: opts.source, conversationId: opts.conversationId });
    if (r.status === "full") {
      full = true;
      continue;
    }
    if (results.some((x) => x.id === r.memory.id)) continue;
    results.push({ id: r.memory.id, content: r.memory.content, kind: r.memory.kind, status: r.status, ...(r.previous !== undefined ? { previous: r.previous } : {}) });
    if (r.status !== "exists") await logActivity({ userId: user.id, actor: "agent", tool: "memory.saved", inputSummary: r.status, outcome: "success" });
  }

  const count = (s: MessageMemory["status"]) => results.filter((r) => r.status === s).length;
  if (results.length) {
    await opts.trace.event("agent", `Saved ${results.length} item(s) to memory`, "ok", { saved: count("saved"), updated: count("updated"), exists: count("exists") });
  }

  let note = "";
  if (results.length) {
    note += `\nSaved to memory this turn (the owner sees a confirmation with Undo):\n${results.map((r) => `- ${r.content}${r.status === "exists" ? " (was already saved)" : r.status === "updated" ? " (updated an older, shorter version)" : ""}`).join("\n")}`;
  }
  if (sensitive) note += "\nThe owner asked you to remember something that looks like a password, code or account number. It was NOT saved; say you don't store secrets.";
  if (full) note += "\nMemory is full, so nothing new was saved; the owner can remove old items in Settings > Agent.";
  return { results, promptNote: note };
}

/** The memories most relevant to `text`, plus a few of the newest, within a prompt budget. */
export async function memoriesForPrompt(userId: string, text: string) {
  const m = schema.memories;
  const rows = await db()
    .select({ id: m.id, content: m.content, kind: m.kind, createdAt: m.createdAt })
    .from(m)
    .where(eq(m.userId, userId))
    .orderBy(desc(m.createdAt))
    .limit(MEMORY_LIMIT);
  const out: typeof rows = [];
  let chars = 0;
  for (const r of rankMemories(rows, text)) {
    chars += r.content.length + 3;
    if (chars > PROMPT_CHAR_BUDGET) break;
    out.push(r);
  }
  return out;
}
