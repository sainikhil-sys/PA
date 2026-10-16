import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { PrivacyView, type DataFlow } from "@/components/settings/privacy-view";
import { configuredProviders } from "@/lib/ai/providers";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Data & privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const user = await requireOwner();
  const sources = await db().select().from(schema.knowledgeSources).where(eq(schema.knowledgeSources.userId, user.id));
  const e = env();
  const ai = configuredProviders().map((p) => new URL(p.baseURL).host).join(", ") || "Not configured";
  const flows: DataFlow[] = [
    { what: "Email text (for sorting & drafts)", where: `AI provider: ${ai}`, why: "Classify, summarize and draft replies. Bodies are fetched on demand and never stored by PA." },
    { what: "Chat messages & retrieved excerpts", where: `AI provider: ${ai}`, why: "Answer your questions with citations." },
    { what: "Knowledge text chunks", where: e.EMBEDDING_MODEL ? `AI provider: ${ai} (embeddings)` : "Stays in your database (keyword search)", why: "Semantic search." },
    { what: "Voice recordings", where: e.STT_BASE_URL ? new URL(e.STT_BASE_URL).host : "Your browser's speech service", why: "Speech-to-text. Audio isn't stored." },
    { what: "Spoken answers", where: e.TTS_BASE_URL ? new URL(e.TTS_BASE_URL).host : "Your browser (on device)", why: "Text-to-speech." },
    { what: "Sign-in codes", where: e.RESEND_API_KEY ? "Resend (email delivery)" : "Not configured", why: "Deliver your one-time code." },
    { what: "Notifications", where: e.TELEGRAM_BOT_TOKEN ? "Telegram (your chat only)" : "In-app only", why: "Alerts and reminders, if enabled." },
    { what: "Everything else", where: "Your Postgres database", why: "Tokens encrypted with AES-256-GCM; codes, sessions and API tokens stored only as hashes." },
    { what: "Rate-limit counters", where: e.UPSTASH_REDIS_REST_URL ? "Upstash Redis" : "In memory", why: "Abuse protection. Keys are hashed, no content." },
  ];
  return <PrivacyView sources={sources.filter((s) => s.itemCount > 0).map((s) => ({ id: s.id, name: s.name, itemCount: s.itemCount }))} flows={flows} />;
}
