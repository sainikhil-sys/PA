import "server-only";
import { and, arrayOverlaps, eq, gt, isNotNull } from "drizzle-orm";
import { google } from "googleapis";
import { db, schema } from "@/lib/db";
import type { KnowledgeSource } from "@/lib/db/schema";
import { googleClient } from "@/lib/integrations/google";
import { decrypt } from "@/lib/security/crypto";
import { extractText } from "./extract";
import { upsertItem } from "./ingest";
import { syncAsana, syncCanva, syncFigma, syncHubspot, syncLinear, syncStripe, syncYoutube, syncZoom } from "@/lib/integrations/providers";

/**
 * Read-only source adapters. Each sync call processes a SMALL batch and returns
 * a cursor, so cron runs stay well inside Vercel's time limits.
 * All fetched content is untrusted and only ever stored as searchable text.
 */
export type SyncResult = { processed: number; cursor: Record<string, unknown>; done: boolean };
export const BATCH = 10;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function tokenFor(userId: string, provider: string): Promise<string> {
  const row = await db().query.integrations.findFirst({ where: and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, provider)) });
  if (!row?.accessTokenEnc || row.status === "disconnected") throw new Error(`${provider} isn't connected`);
  return decrypt(row.accessTokenEnc);
}

function list(config: Record<string, unknown>, key: string): string[] {
  const v = config[key];
  return Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

// ---------- Google Drive (incl. Docs & Sheets) ----------
export async function syncDrive(source: KnowledgeSource): Promise<SyncResult> {
  const drive = google.drive({ version: "v3", auth: await googleClient(source.userId) });
  const folders = list(source.config, "folderIds");
  if (!folders.length) return { processed: 0, cursor: source.cursor ?? {}, done: true };
  const since = String(source.cursor?.modifiedAfter ?? "1970-01-01T00:00:00Z");
  const q = `(${folders.map((f) => `'${f.replace(/'/g, "")}' in parents`).join(" or ")}) and trashed = false and modifiedTime > '${since}' and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/pdf' or mimeType = 'text/plain' or mimeType = 'text/markdown')`;
  const res = await drive.files.list({ q, orderBy: "modifiedTime", pageSize: BATCH, fields: "files(id,name,mimeType,modifiedTime,webViewLink,size)" });
  const files = res.data.files ?? [];
  let latest = since;
  for (const f of files) {
    if (!f.id) continue;
    let text = "";
    if (f.mimeType === "application/vnd.google-apps.document") {
      text = String((await drive.files.export({ fileId: f.id, mimeType: "text/plain" }, { responseType: "text" })).data ?? "");
    } else if (f.mimeType === "application/vnd.google-apps.spreadsheet") {
      text = String((await drive.files.export({ fileId: f.id, mimeType: "text/csv" }, { responseType: "text" })).data ?? "").slice(0, 100_000);
    } else if (Number(f.size ?? 0) <= MAX_FILE_BYTES) {
      const buf = (await drive.files.get({ fileId: f.id, alt: "media" }, { responseType: "arraybuffer" })).data as ArrayBuffer;
      text = await extractText(buf, f.mimeType === "application/pdf" ? "pdf" : "txt");
    }
    await upsertItem(source, { externalId: f.id, title: f.name ?? "Untitled", url: f.webViewLink, mimeType: f.mimeType, text, sourceUpdatedAt: f.modifiedTime ? new Date(f.modifiedTime) : null });
    if (f.modifiedTime && f.modifiedTime > latest) latest = f.modifiedTime;
  }
  return { processed: files.length, cursor: { modifiedAfter: latest }, done: files.length < BATCH };
}

// ---------- Gmail (subjects + AI summaries only; bodies are never stored) ----------
export async function syncGmailKnowledge(source: KnowledgeSource): Promise<SyncResult> {
  const labels = list(source.config, "labelIds");
  const since = new Date(String(source.cursor?.since ?? "1970-01-01T00:00:00Z"));
  const conds = [eq(schema.emails.userId, source.userId), isNotNull(schema.emails.summary), gt(schema.emails.classifiedAt, since)];
  if (labels.length) conds.push(arrayOverlaps(schema.emails.labelIds, labels));
  const rows = await db().select().from(schema.emails).where(and(...conds)).orderBy(schema.emails.classifiedAt).limit(BATCH * 3);
  let latest = since;
  for (const e of rows) {
    await upsertItem(source, { externalId: e.gmailId, title: `${e.fromName ?? e.fromEmail ?? "Email"}: ${e.subject}`, url: `/inbox?email=${e.id}`, mimeType: "message/summary", text: `${e.subject}\n${e.summary ?? ""}`, sourceUpdatedAt: e.receivedAt });
    if (e.classifiedAt && e.classifiedAt > latest) latest = e.classifiedAt;
  }
  return { processed: rows.length, cursor: { since: latest.toISOString() }, done: rows.length < BATCH * 3 };
}

// ---------- Notion (read-only internal integration) ----------
type NotionBlock = { type: string; [k: string]: unknown };
function notionText(block: NotionBlock): string {
  const data = block[block.type] as { rich_text?: { plain_text: string }[]; title?: string } | undefined;
  return (data?.rich_text ?? []).map((r) => r.plain_text).join("") || "";
}

export async function syncNotion(source: KnowledgeSource): Promise<SyncResult> {
  const token = await tokenFor(source.userId, "notion");
  const headers = { authorization: `Bearer ${token}`, "notion-version": "2022-06-28", "content-type": "application/json" };
  const allow = new Set(list(source.config, "pageIds").map((p) => p.replace(/-/g, "")));
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ filter: { property: "object", value: "page" }, sort: { direction: "ascending", timestamp: "last_edited_time" }, page_size: BATCH, ...(source.cursor?.next ? { start_cursor: source.cursor.next } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Notion returned ${res.status}`);
  const data = (await res.json()) as { results: { id: string; url: string; last_edited_time: string; properties: Record<string, { type: string; title?: { plain_text: string }[] }> }[]; next_cursor: string | null; has_more: boolean };
  let processed = 0;
  for (const page of data.results) {
    if (allow.size && !allow.has(page.id.replace(/-/g, ""))) continue;
    const titleProp = Object.values(page.properties).find((p) => p.type === "title");
    const title = titleProp?.title?.map((t) => t.plain_text).join("") || "Untitled";
    const blocks = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=100`, { headers, signal: AbortSignal.timeout(15_000) });
    const body = blocks.ok ? ((await blocks.json()) as { results: NotionBlock[] }).results.map(notionText).filter(Boolean).join("\n") : "";
    await upsertItem(source, { externalId: page.id, title, url: page.url, mimeType: "text/notion", text: body, sourceUpdatedAt: new Date(page.last_edited_time) });
    processed++;
  }
  return { processed, cursor: data.has_more && data.next_cursor ? { next: data.next_cursor } : {}, done: !data.has_more };
}

// ---------- Slack (read-only bot token; channels you choose) ----------
export async function syncSlack(source: KnowledgeSource): Promise<SyncResult> {
  const token = await tokenFor(source.userId, "slack");
  const channels = list(source.config, "channels");
  const oldest = (source.cursor?.oldest as Record<string, string> | undefined) ?? {};
  let processed = 0;
  for (const ch of channels.slice(0, 5)) {
    const url = new URL("https://slack.com/api/conversations.history");
    url.searchParams.set("channel", ch);
    url.searchParams.set("limit", "100");
    if (oldest[ch]) url.searchParams.set("oldest", oldest[ch]);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const data = (await res.json()) as { ok: boolean; error?: string; messages?: { ts: string; text: string; subtype?: string }[] };
    if (!data.ok) throw new Error(`Slack: ${data.error ?? "error"}`);
    const msgs = (data.messages ?? []).filter((m) => !m.subtype && m.text).reverse();
    if (!msgs.length) continue;
    // One knowledge item per channel per day.
    const byDay = new Map<string, string[]>();
    for (const m of msgs) {
      const day = new Date(Number(m.ts) * 1000).toISOString().slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), m.text]);
    }
    for (const [day, texts] of byDay) {
      await upsertItem(source, { externalId: `${ch}:${day}`, title: `Slack #${ch} · ${day}`, url: null, mimeType: "text/slack", text: texts.join("\n") });
      processed++;
    }
    oldest[ch] = msgs.at(-1)!.ts;
  }
  return { processed, cursor: { oldest }, done: true };
}

// ---------- GitHub (READMEs and docs/*.md from repos you choose) ----------
export async function syncGithub(source: KnowledgeSource): Promise<SyncResult> {
  const token = await tokenFor(source.userId, "github");
  const repos = list(source.config, "repos").filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "PA-knowledge" };
  let processed = 0;
  for (const repo of repos.slice(0, 5)) {
    const readme = await fetch(`https://api.github.com/repos/${repo}/readme`, { headers: { ...headers, accept: "application/vnd.github.raw" }, signal: AbortSignal.timeout(15_000) });
    if (readme.ok) {
      await upsertItem(source, { externalId: `${repo}:README`, title: `${repo} · README`, url: `https://github.com/${repo}`, mimeType: "text/markdown", text: await readme.text() });
      processed++;
    }
    const docs = await fetch(`https://api.github.com/repos/${repo}/contents/docs`, { headers, signal: AbortSignal.timeout(15_000) });
    if (docs.ok) {
      const files = ((await docs.json()) as { name: string; path: string; download_url: string | null; html_url: string; size: number }[]).filter((f) => f.name.endsWith(".md") && f.download_url && f.size < 500_000).slice(0, BATCH);
      for (const f of files) {
        const raw = await fetch(f.download_url!, { headers, signal: AbortSignal.timeout(15_000) });
        if (!raw.ok) continue;
        await upsertItem(source, { externalId: `${repo}:${f.path}`, title: `${repo} · ${f.path}`, url: f.html_url, mimeType: "text/markdown", text: await raw.text() });
        processed++;
      }
    }
  }
  return { processed, cursor: {}, done: true };
}

export const ADAPTERS: Record<string, (s: KnowledgeSource) => Promise<SyncResult>> = {
  drive: syncDrive,
  gmail: syncGmailKnowledge,
  notion: syncNotion,
  slack: syncSlack,
  github: syncGithub,
  asana: syncAsana,
  linear: syncLinear,
  hubspot: syncHubspot,
  stripe: syncStripe,
  zoom: syncZoom,
  youtube: syncYoutube,
  figma: syncFigma,
  canva: syncCanva,
};

