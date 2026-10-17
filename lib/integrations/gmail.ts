import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { googleClient } from "./google";

/**
 * Gmail access is deliberately limited to READ and CREATE DRAFT.
 * There is intentionally no send, modify, trash or delete function in this module.
 */

async function gmail(userId: string) {
  return google.gmail({ version: "v1", auth: await googleClient(userId) });
}

export type GmailMeta = {
  gmailId: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  snippet: string;
  receivedAt: Date;
  labelIds: string[];
  messageIdHeader: string | null;
  references: string | null;
};

export { parseFrom, extractBody, buildReplyMime, buildComposeMime } from "./mime";
import { parseFrom, extractBody, buildReplyMime, buildComposeMime } from "./mime";

function header(msg: gmail_v1.Schema$Message, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** IDs of inbox messages received after `after` (newest first), capped. */
export async function listRecentMessageIds(userId: string, after: Date, max = 50): Promise<string[]> {
  const g = await gmail(userId);
  const q = `in:inbox after:${Math.floor(after.getTime() / 1000)}`;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await g.users.messages.list({ userId: "me", q, maxResults: Math.min(50, max - ids.length), pageToken });
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < max);
  return ids;
}

export async function getMessageMeta(userId: string, id: string): Promise<GmailMeta> {
  const g = await gmail(userId);
  const res = await g.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Date", "Message-ID", "References"],
  });
  const msg = res.data;
  const from = parseFrom(header(msg, "From"));
  return {
    gmailId: msg.id!,
    threadId: msg.threadId!,
    fromName: from.name,
    fromEmail: from.email,
    subject: header(msg, "Subject") ?? "(no subject)",
    snippet: decodeEntities(msg.snippet ?? ""),
    receivedAt: new Date(Number(msg.internalDate ?? Date.now())),
    labelIds: msg.labelIds ?? [],
    messageIdHeader: header(msg, "Message-ID"),
    references: header(msg, "References"),
  };
}

/** Plain-text body, fetched on demand and never persisted. */
export async function getMessageBody(userId: string, id: string): Promise<string> {
  const g = await gmail(userId);
  const res = await g.users.messages.get({ userId: "me", id, format: "full" });
  return extractBody(res.data.payload);
}

/** Create a Gmail DRAFT (never sends). Returns the draft id. */
export async function createReplyDraft(
  userId: string,
  opts: { threadId: string; to: string; subject: string; body: string; inReplyTo?: string | null; references?: string | null },
): Promise<string> {
  const g = await gmail(userId);
  const raw = Buffer.from(buildReplyMime(opts), "utf8").toString("base64url");
  const res = await g.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId: opts.threadId } } });
  if (!res.data.id) throw new Error("Gmail did not return a draft id");
  return res.data.id;
}


/** Create a Gmail DRAFT for a new email (never sends). Returns the draft id. */
export async function createComposeDraft(userId: string, opts: { to: string; subject: string; body: string }): Promise<string> {
  const g = await gmail(userId);
  const raw = Buffer.from(buildComposeMime(opts), "utf8").toString("base64url");
  const res = await g.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
  if (!res.data.id) throw new Error("Gmail did not return a draft id");
  return res.data.id;
}
