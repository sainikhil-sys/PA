import { ArrowLeft, ArrowRight, Lightning } from "@phosphor-icons/react/dist/ssr";
import { and, desc, eq, inArray, isNull, like } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { IntegrationActions } from "@/components/integrations/integration-detail";
import type { ConnState } from "@/components/integrations/integration-grid";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { isAdmin } from "@/lib/auth/policy";
import { requireOwner } from "@/lib/auth/session";
import { TEMPLATES } from "@/lib/automations/templates";
import { db, schema } from "@/lib/db";
import { getSettings, listIntegrations } from "@/lib/db/queries/settings";
import { env } from "@/lib/env";
import { listEvents } from "@/lib/integrations/calendar";
import { CATALOG } from "@/lib/integrations/catalog";
import { oauthAccessToken, oauthReadyMap } from "@/lib/integrations/oauth";
import { formatDateTime, formatTime } from "@/lib/time";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Knowledge source type behind each catalog entry. */
const SOURCE_TYPE: Record<string, string> = { googledrive: "drive", googledocs: "drive", googlesheets: "drive" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: CATALOG.find((c) => c.id === id)?.name ?? "Integration" };
}

type Row = { key: string; title: string; meta: string; href?: string | null };

async function recentRows(userId: string, id: string, tz: string): Promise<{ heading: string; rows: Row[] }> {
  if (id === "gmail") {
    const rows = await db().select().from(schema.emails).where(eq(schema.emails.userId, userId)).orderBy(desc(schema.emails.receivedAt)).limit(8);
    return { heading: "Latest mail", rows: rows.map((e) => ({ key: e.id, title: e.subject || "(no subject)", meta: `${e.fromName ?? e.fromEmail ?? ""} · ${timeAgo(e.receivedAt.toISOString())}${e.category ? ` · ${e.category.toLowerCase().replace("_", " ")}` : ""}`, href: "/inbox" })) };
  }
  if (id === "googlecalendar") {
    const now = new Date();
    const events = await listEvents(userId, now, new Date(now.getTime() + 7 * 86_400_000)).catch(() => []);
    return { heading: "Next 7 days", rows: events.slice(0, 8).map((e) => ({ key: e.id, title: e.title, meta: e.allDay ? "All day" : `${formatDateTime(e.start, tz)}${e.end ? ` – ${formatTime(e.end, tz)}` : ""}`, href: "/tasks?view=schedule" })) };
  }
  if (id === "asana" || id === "linear") {
    const rows = await db().select().from(schema.tasks).where(and(eq(schema.tasks.userId, userId), like(schema.tasks.externalRef, `${id}:%`))).orderBy(desc(schema.tasks.updatedAt)).limit(8);
    return { heading: "Imported tasks", rows: rows.map((t) => ({ key: t.id, title: t.title, meta: `${t.status.replace("_", " ")}${t.dueDate ? ` · due ${t.dueDate}` : ""}`, href: `/tasks?task=${t.id}` })) };
  }
  if (id === "whatsapp") {
    const rows = await db()
      .select()
      .from(schema.phoneEvents)
      .where(and(eq(schema.phoneEvents.userId, userId), eq(schema.phoneEvents.kind, "whatsapp")))
      .orderBy(desc(schema.phoneEvents.postedAt))
      .limit(8);
    return { heading: "Latest WhatsApp messages", rows: rows.map((m) => ({ key: m.id, title: m.title || "WhatsApp", meta: `${m.text.slice(0, 80)} · ${timeAgo(m.postedAt.toISOString())}`, href: "/phone" })) };
  }
  if (id === "spotify") {
    const { token } = await oauthAccessToken(userId, "spotify");
    const r = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=8", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    const d = r.ok ? ((await r.json()) as { items?: { played_at: string; track: { id: string; name: string; artists: { name: string }[] } }[] }) : {};
    return { heading: "Recently played", rows: (d.items ?? []).map((i) => ({ key: `${i.track.id}:${i.played_at}`, title: i.track.name, meta: `${i.track.artists.map((a) => a.name).join(", ")} · ${timeAgo(i.played_at)}`, href: "/" })) };
  }
  if (id === "linkedin" || id === "canva") {
    const rows = await db().select().from(schema.contentDrafts).where(eq(schema.contentDrafts.userId, userId)).orderBy(desc(schema.contentDrafts.updatedAt)).limit(8);
    return { heading: "Your drafts", rows: rows.map((d) => ({ key: d.id, title: d.title, meta: `${d.status} · ${timeAgo(d.updatedAt.toISOString())}`, href: `/content/${d.id}` })) };
  }
  const type = SOURCE_TYPE[id] ?? id;
  const sources = await db().select({ id: schema.knowledgeSources.id }).from(schema.knowledgeSources).where(and(eq(schema.knowledgeSources.userId, userId), eq(schema.knowledgeSources.type, type)));
  if (!sources.length) return { heading: "Recently synced", rows: [] };
  const items = await db()
    .select({ id: schema.knowledgeItems.id, title: schema.knowledgeItems.title, url: schema.knowledgeItems.url, updatedAt: schema.knowledgeItems.updatedAt })
    .from(schema.knowledgeItems)
    .where(inArray(schema.knowledgeItems.sourceId, sources.map((s) => s.id)))
    .orderBy(desc(schema.knowledgeItems.updatedAt))
    .limit(8);
  return { heading: "Recently synced", rows: items.map((i) => ({ key: i.id, title: i.title, meta: `updated ${timeAgo(i.updatedAt.toISOString())}`, href: `/knowledge?item=${i.id}` })) };
}

export default async function IntegrationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  const entry = CATALOG.find((c) => c.id === id);
  const admin = isAdmin(user.email);
  if (!entry || (entry.provider === "telegram" && !admin)) notFound();

  const [integrations, s] = await Promise.all([listIntegrations(user.id), getSettings(user.id)]);
  const e = env();
  const telegramConfigured = admin && Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID);
  const row = integrations.find((i) => i.provider === entry.provider);
  // WhatsApp has no login of its own: it's "connected" once an Android phone is linked.
  const phones = id === "whatsapp" ? await db().select({ name: schema.phoneDevices.name }).from(schema.phoneDevices).where(and(eq(schema.phoneDevices.userId, user.id), isNull(schema.phoneDevices.revokedAt))).limit(1) : [];
  const state: ConnState =
    id === "whatsapp"
      ? phones.length
        ? { status: "connected", label: `via ${phones[0]!.name}` }
        : { status: "none" }
      : entry.provider === "telegram"
        ? { status: telegramConfigured ? "connected" : "none" }
        : row
          ? { status: row.status as ConnState["status"], label: row.accountLabel, error: row.lastError }
          : { status: "none" };
  const connected = state.status === "connected" || state.status === "syncing";
  const recent = connected ? await recentRows(user.id, id, s.timezone).catch(() => ({ heading: "Recently synced", rows: [] as Row[] })) : null;
  const recipes = TEMPLATES.filter((t) => t.uses?.includes(id));
  const partners = new Set(recipes.flatMap((r) => r.uses ?? []).filter((u) => u !== id));
  const partnerEntries = CATALOG.filter((c) => partners.has(c.id));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/integrations" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft size={14} /> Integrations
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BrandLogo id={entry.logo} size={32} box />
          <div className="min-w-0">
            <h1 className="font-serif text-[26px] leading-tight tracking-[-0.02em] sm:text-[30px]">{entry.name}</h1>
            <p className="text-[13px] text-muted">
              {connected ? `Connected${state.label ? ` as ${state.label}` : ""}` : state.status === "error" ? "Needs attention" : "Not connected"} · {entry.description}
            </p>
          </div>
        </div>
        <IntegrationActions entry={entry} state={state} telegramConfigured={telegramConfigured} oauthReady={oauthReadyMap()} />
      </div>
      {state.error ? <p className="rounded-[12px] border border-border bg-surface px-3 py-2 text-[13px] text-danger">{state.error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={recent?.heading ?? "What it does"} />
          <CardBody>
            {!connected ? (
              <ul className="flex flex-col gap-2 text-[13px]">
                {entry.permissions.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : recent && recent.rows.length ? (
              <ul className="-mx-2 flex flex-col">
                {recent.rows.map((r) => (
                  <li key={r.key}>
                    <Link href={r.href ?? "#"} className="flex min-w-0 flex-col rounded-[10px] px-2 py-2 hover:bg-surface-hover">
                      <span className="truncate text-sm">{r.title}</span>
                      <span className="truncate text-[12px] text-muted">{r.meta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Nothing synced yet. New items appear here after the next sync.</p>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader icon={<Lightning size={18} />} title="Use it together" description="Recipes that combine this with your other tools. Review before saving." />
          <CardBody className="flex flex-col gap-2">
            {recipes.length ? (
              recipes.map((r) => (
                <Link key={r.id} href={`/automations/new?template=${r.id}`} className="group flex items-start justify-between gap-3 rounded-[12px] border border-border px-3 py-2.5 hover:border-foreground/60">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{r.name}</span>
                    <span className="block text-[12px] text-muted">{r.description}</span>
                  </span>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-muted group-hover:text-foreground" />
                </Link>
              ))
            ) : (
              <p className="text-[13px] text-muted">No recipes for this one yet. Build your own in Automations.</p>
            )}
            {partnerEntries.length ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                Works with
                {partnerEntries.map((p) => (
                  <Link key={p.id} href={`/integrations/${p.id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:border-foreground/60">
                    <BrandLogo id={p.logo} size={12} /> {p.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
