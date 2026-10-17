import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { KnowledgeSource } from "@/lib/db/schema";
import { decrypt } from "@/lib/security/crypto";
import { upsertItem } from "@/lib/knowledge/ingest";
import { oauthAccessToken } from "./oauth";

/**
 * Read-only clients for token-connected tools. Every call is a GET (or the
 * provider's read-only search/OAuth token endpoint). Nothing here writes to the
 * third-party service. Credentials are stored as encrypted JSON.
 */
export type Creds = Record<string, string>;
export class ProviderError extends Error {}

const T = () => AbortSignal.timeout(15_000);

async function getJson<R>(url: string, init: RequestInit, what: string): Promise<R> {
  const res = await fetch(url, { ...init, signal: T() });
  if (!res.ok) throw new ProviderError(`${what} returned ${res.status}${await providerReason(res)}`);
  return (await res.json()) as R;
}

/** The provider's own short error message, if it sent one (shown to the person connecting). */
async function providerReason(res: Response): Promise<string> {
  try {
    const t = (await res.text()).slice(0, 2000);
    const j = JSON.parse(t) as Record<string, unknown>;
    const msg = [j.reason, j.message, j.error_description, j.error, (j.errors as { message?: string }[] | undefined)?.[0]?.message].find((v) => typeof v === "string" && v.trim());
    return msg ? `: ${String(msg).replace(/\s+/g, " ").slice(0, 160)}` : "";
  } catch {
    return "";
  }
}

export async function loadCreds(userId: string, provider: string): Promise<Creds> {
  const row = await db().query.integrations.findFirst({ where: and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, provider)) });
  if (!row?.accessTokenEnc || row.status === "disconnected") throw new ProviderError(`${provider} isn't connected`);
  const raw = decrypt(row.accessTokenEnc);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Creds;
  } catch {}
  return { token: raw };
}

// ---------- Zoom: Server-to-Server OAuth ----------
async function zoomToken(c: Creds): Promise<string> {
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(c.accountId ?? "")}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` },
    signal: T(),
  });
  if (!res.ok) throw new ProviderError(`Zoom rejected the credentials (${res.status})${await providerReason(res)}. Check the app is activated and the Account ID belongs to it.`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Validate credentials before saving; returns a human label for the account. */
export async function validateCreds(provider: string, c: Creds): Promise<string> {
  switch (provider) {
    case "asana": {
      const d = await getJson<{ data: { name: string } }>("https://app.asana.com/api/1.0/users/me", { headers: { authorization: `Bearer ${c.token}` } }, "Asana");
      return d.data.name;
    }
    case "linear": {
      const res = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { authorization: c.token!, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { name } }" }), signal: T() });
      const d = (await res.json()) as { data?: { viewer?: { name: string } }; errors?: unknown };
      if (!res.ok || !d.data?.viewer) throw new ProviderError("Linear didn't accept that key");
      return d.data.viewer.name;
    }
    case "hubspot": {
      await getJson("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { headers: { authorization: `Bearer ${c.token}` } }, "HubSpot");
      return "HubSpot private app";
    }
    case "stripe": {
      if (c.token?.startsWith("sk_")) throw new ProviderError("Use a restricted read-only key (rk_…), not a secret key.");
      if (!c.token?.startsWith("rk_")) throw new ProviderError("That doesn't look like a restricted key (rk_…).");
      const d = await getJson<{ livemode: boolean }>("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${c.token}` } }, "Stripe");
      return d.livemode ? "Stripe (live)" : "Stripe (test mode)";
    }
    case "zoom": {
      const token = await zoomToken(c);
      // Check with the scope Cowork actually uses (listing meetings), not a profile read it doesn't ask for.
      await getJson("https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=1", { headers: { authorization: `Bearer ${token}` } }, "Zoom meetings");
      return "Zoom account";
    }
    case "youtube": {
      const d = await getJson<{ items?: { snippet: { title: string } }[] }>(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(c.channelId ?? "")}&key=${encodeURIComponent(c.token ?? "")}`, {}, "YouTube");
      if (!d.items?.length) throw new ProviderError("No channel found for that Channel ID.");
      return d.items[0]!.snippet.title;
    }
    case "figma": {
      const d = await getJson<{ handle: string }>("https://api.figma.com/v1/me", { headers: { "x-figma-token": c.token! } }, "Figma");
      await getJson(`https://api.figma.com/v1/teams/${encodeURIComponent(c.teamId ?? "")}/projects`, { headers: { "x-figma-token": c.token! } }, "Figma team");
      return d.handle;
    }
    default:
      throw new ProviderError("Unknown provider");
  }
}

// ---------- Task importers (Asana, Linear) → Cowork tasks ----------
async function importTasks(userId: string, items: { ref: string; title: string; url: string; due: string | null; notes: string }[]) {
  let added = 0;
  for (const it of items) {
    const rows = await db()
      .insert(schema.tasks)
      .values({ userId, title: it.title.slice(0, 200), description: it.notes.slice(0, 4000), dueDate: it.due, createdBy: "system", assignee: "me", externalRef: it.ref, externalUrl: it.url, tags: [it.ref.split(":")[0]!] })
      .onConflictDoUpdate({ target: [schema.tasks.userId, schema.tasks.externalRef], set: { title: it.title.slice(0, 200), dueDate: it.due, externalUrl: it.url } })
      .returning({ id: schema.tasks.id });
    added += rows.length;
  }
  return added;
}

export async function syncAsana(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "asana");
  const h = { authorization: `Bearer ${c.token}` };
  const me = await getJson<{ data: { gid: string; workspaces: { gid: string }[] } }>("https://app.asana.com/api/1.0/users/me", { headers: h }, "Asana");
  const items: Parameters<typeof importTasks>[1] = [];
  for (const ws of me.data.workspaces.slice(0, 3)) {
    const d = await getJson<{ data: { gid: string; name: string; due_on: string | null; notes: string; permalink_url: string }[] }>(
      `https://app.asana.com/api/1.0/tasks?assignee=me&workspace=${ws.gid}&completed_since=now&limit=50&opt_fields=name,due_on,notes,permalink_url`,
      { headers: h },
      "Asana",
    );
    for (const t of d.data) items.push({ ref: `asana:${t.gid}`, title: t.name, url: t.permalink_url, due: t.due_on, notes: t.notes ?? "" });
  }
  return { processed: await importTasks(source.userId, items), cursor: {}, done: true };
}

export async function syncLinear(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "linear");
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: c.token!, "content-type": "application/json" },
    body: JSON.stringify({ query: "{ viewer { assignedIssues(first: 50, filter: { completedAt: { null: true }, canceledAt: { null: true } }) { nodes { identifier title url dueDate description } } } }" }),
    signal: T(),
  });
  const d = (await res.json()) as { data?: { viewer: { assignedIssues: { nodes: { identifier: string; title: string; url: string; dueDate: string | null; description: string | null }[] } } } };
  if (!res.ok || !d.data) throw new ProviderError(`Linear returned ${res.status}`);
  const items = d.data.viewer.assignedIssues.nodes.map((i) => ({ ref: `linear:${i.identifier}`, title: `${i.identifier} ${i.title}`, url: i.url, due: i.dueDate, notes: i.description ?? "" }));
  return { processed: await importTasks(source.userId, items), cursor: {}, done: true };
}

// ---------- Knowledge adapters ----------
export async function syncHubspot(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "hubspot");
  const after = source.cursor?.after ? `&after=${encodeURIComponent(String(source.cursor.after))}` : "";
  const d = await getJson<{ results: { id: string; properties: Record<string, string | null> }[]; paging?: { next?: { after: string } } }>(
    `https://api.hubapi.com/crm/v3/objects/contacts?limit=50&properties=firstname,lastname,email,company,jobtitle,lifecyclestage${after}`,
    { headers: { authorization: `Bearer ${c.token}` } },
    "HubSpot",
  );
  for (const r of d.results) {
    const p = r.properties;
    const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || "Contact";
    await upsertItem(source, { externalId: r.id, title: `${name}${p.company ? ` · ${p.company}` : ""}`, url: null, mimeType: "crm/contact", text: [name, p.jobtitle, p.company, p.email, p.lifecyclestage && `Stage: ${p.lifecyclestage}`].filter(Boolean).join("\n") });
  }
  const next = d.paging?.next?.after;
  return { processed: d.results.length, cursor: next ? { after: next } : {}, done: !next };
}

export async function syncStripe(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "stripe");
  const h = { authorization: `Bearer ${c.token}` };
  const since = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const [bal, charges] = await Promise.all([
    getJson<{ available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] }>("https://api.stripe.com/v1/balance", { headers: h }, "Stripe"),
    getJson<{ data: { amount: number; currency: string; paid: boolean; refunded: boolean }[]; has_more: boolean }>(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`, { headers: h }, "Stripe"),
  ]);
  const fmt = (a: number, cur: string) => `${(a / 100).toFixed(2)} ${cur.toUpperCase()}`;
  const paid = charges.data.filter((x) => x.paid && !x.refunded);
  const byCur = new Map<string, number>();
  for (const x of paid) byCur.set(x.currency, (byCur.get(x.currency) ?? 0) + x.amount);
  const today = new Date().toISOString().slice(0, 10);
  const text = [
    `Stripe summary for the 7 days to ${today}.`,
    `Successful charges: ${paid.length}${charges.has_more ? "+" : ""}.`,
    `Gross volume: ${[...byCur].map(([cur, a]) => fmt(a, cur)).join(", ") || "0"}.`,
    `Available balance: ${bal.available.map((b) => fmt(b.amount, b.currency)).join(", ") || "0"}. Pending: ${bal.pending.map((b) => fmt(b.amount, b.currency)).join(", ") || "0"}.`,
  ].join("\n");
  await upsertItem(source, { externalId: "summary-latest", title: `Stripe · last 7 days (${today})`, url: "https://dashboard.stripe.com", mimeType: "text/plain", text });
  return { processed: 1, cursor: {}, done: true };
}

export async function syncZoom(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "zoom");
  const token = await zoomToken(c);
  const h = { authorization: `Bearer ${token}` };
  const meetings = await getJson<{ meetings: { id: number; topic: string; start_time?: string; join_url: string; duration?: number }[] }>("https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=30", { headers: h }, "Zoom");
  for (const m of meetings.meetings) {
    await upsertItem(source, { externalId: `meeting:${m.id}`, title: `Zoom: ${m.topic}`, url: m.join_url, mimeType: "zoom/meeting", text: `${m.topic}\nStarts: ${m.start_time ?? "recurring"}\nDuration: ${m.duration ?? "?"} min` });
  }
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const rec = await getJson<{ meetings: { uuid: string; topic: string; start_time: string; share_url?: string }[] }>(`https://api.zoom.us/v2/users/me/recordings?from=${from}&page_size=30`, { headers: h }, "Zoom recordings").catch(() => ({ meetings: [] }));
  for (const r of rec.meetings) {
    await upsertItem(source, { externalId: `recording:${r.uuid}`, title: `Recording: ${r.topic}`, url: r.share_url ?? null, mimeType: "zoom/recording", text: `${r.topic}\nRecorded: ${r.start_time}` });
  }
  return { processed: meetings.meetings.length + rec.meetings.length, cursor: {}, done: true };
}

export async function syncYoutube(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "youtube");
  const key = encodeURIComponent(c.token ?? "");
  const ch = await getJson<{ items: { snippet: { title: string }; statistics: Record<string, string>; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(c.channelId ?? "")}&key=${key}`,
    {},
    "YouTube",
  );
  const channel = ch.items[0];
  if (!channel) throw new ProviderError("Channel not found");
  const s = channel.statistics;
  await upsertItem(source, { externalId: "channel", title: `YouTube channel: ${channel.snippet.title}`, url: `https://www.youtube.com/channel/${c.channelId}`, mimeType: "text/plain", text: `${channel.snippet.title}\nSubscribers: ${s.subscriberCount ?? "hidden"}\nViews: ${s.viewCount}\nVideos: ${s.videoCount}` });
  const vids = await getJson<{ items: { snippet: { title: string; description: string; publishedAt: string; resourceId: { videoId: string } } }[] }>(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=${channel.contentDetails.relatedPlaylists.uploads}&key=${key}`,
    {},
    "YouTube",
  );
  for (const v of vids.items) {
    await upsertItem(source, { externalId: v.snippet.resourceId.videoId, title: `Video: ${v.snippet.title}`, url: `https://www.youtube.com/watch?v=${v.snippet.resourceId.videoId}`, mimeType: "youtube/video", text: `${v.snippet.title}\nPublished ${v.snippet.publishedAt}\n${v.snippet.description.slice(0, 2000)}` });
  }
  return { processed: vids.items.length + 1, cursor: {}, done: true };
}

export async function syncFigma(source: KnowledgeSource) {
  const c = await loadCreds(source.userId, "figma");
  const h = { "x-figma-token": c.token! };
  const projects = await getJson<{ projects: { id: string; name: string }[] }>(`https://api.figma.com/v1/teams/${encodeURIComponent(c.teamId ?? "")}/projects`, { headers: h }, "Figma");
  let n = 0;
  for (const p of projects.projects.slice(0, 20)) {
    const files = await getJson<{ files: { key: string; name: string; last_modified: string }[] }>(`https://api.figma.com/v1/projects/${p.id}/files`, { headers: h }, "Figma");
    for (const f of files.files.slice(0, 50)) {
      await upsertItem(source, { externalId: f.key, title: `Figma: ${f.name}`, url: `https://www.figma.com/file/${f.key}`, mimeType: "figma/file", text: `${f.name}\nProject: ${p.name}\nLast edited: ${f.last_modified}`, sourceUpdatedAt: new Date(f.last_modified) });
      n++;
    }
  }
  return { processed: n, cursor: {}, done: true };
}

export async function syncCanva(source: KnowledgeSource) {
  const { token } = await oauthAccessToken(source.userId, "canva");
  const cont = source.cursor?.continuation ? `&continuation=${encodeURIComponent(String(source.cursor.continuation))}` : "";
  const d = await getJson<{ items: { id: string; title?: string; urls?: { view_url?: string }; updated_at?: number }[]; continuation?: string }>(
    `https://api.canva.com/rest/v1/designs?limit=50${cont}`,
    { headers: { authorization: `Bearer ${token}` } },
    "Canva",
  );
  for (const x of d.items) {
    await upsertItem(source, { externalId: x.id, title: `Canva: ${x.title || "Untitled design"}`, url: x.urls?.view_url ?? null, mimeType: "canva/design", text: `${x.title || "Untitled design"}`, sourceUpdatedAt: x.updated_at ? new Date(x.updated_at * 1000) : null });
  }
  return { processed: d.items.length, cursor: d.continuation ? { continuation: d.continuation } : {}, done: !d.continuation };
}
