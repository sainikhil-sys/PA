import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { PrivacyView, type DataFlow } from "@/components/settings/privacy-view";
import { AI_PRESETS } from "@/lib/ai/user-provider";
import { isAdmin } from "@/lib/auth/policy";
import { getSettings } from "@/lib/db/queries/settings";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Data & privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const user = await requireOwner();
  const [sources, s] = await Promise.all([db().select().from(schema.knowledgeSources).where(eq(schema.knowledgeSources.userId, user.id)), getSettings(user.id)]);
  const e = env();
  // Infrastructure details (hosts, vendors) are not shown to accounts; only what touches their data, in plain words.
  const ai = s.aiProvider ? `Your own key: ${AI_PRESETS[s.aiProvider.preset as keyof typeof AI_PRESETS]?.label ?? "custom provider"}` : "Cowork's AI provider";
  const flows: DataFlow[] = [
    { what: "Email text (for sorting & drafts)", where: ai, why: "Classify, summarize and draft replies. Bodies are fetched on demand and never stored by Cowork." },
    { what: "Chat messages & retrieved excerpts", where: ai, why: "Answer your questions with citations." },
    { what: "Knowledge text chunks", where: e.EMBEDDING_MODEL ? "Cowork's AI provider (search index)" : "Stays in your database (keyword search)", why: "Semantic search." },
    { what: "Voice recordings", where: e.STT_BASE_URL ? "Cowork's speech service" : "Your browser's speech service", why: "Speech-to-text. Audio isn't stored." },
    { what: "Spoken answers", where: e.TTS_BASE_URL ? "Cowork's speech service" : "Your browser (on device)", why: "Text-to-speech." },
    { what: "Sign-in codes", where: e.RESEND_API_KEY ? "Resend (email delivery)" : "Not configured", why: "Deliver your one-time code." },
    { what: "Notifications", where: isAdmin(user.email) && e.TELEGRAM_BOT_TOKEN ? "In-app, email and Telegram" : "In-app and email", why: "Alerts and reminders you choose in Notifications." },
    { what: "Everything else", where: "Cowork's encrypted database", why: "Tokens encrypted with AES-256-GCM; codes, sessions and API tokens stored only as hashes." },
    { what: "Rate-limit counters", where: "Cowork's servers", why: "Abuse protection. Keys are hashed, no content." },
  ];
  return <PrivacyView sources={sources.filter((s) => s.itemCount > 0).map((s) => ({ id: s.id, name: s.name, itemCount: s.itemCount }))} flows={flows} />;
}
