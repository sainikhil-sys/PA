import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AgentForm } from "@/components/settings/agent-form";
import { configuredProviders } from "@/lib/ai/providers";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/db/queries/settings";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Agent" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const user = await requireOwner();
  const [s, memories] = await Promise.all([getSettings(user.id), db().select().from(schema.memories).where(eq(schema.memories.userId, user.id)).orderBy(desc(schema.memories.createdAt)).limit(100)]);
  const providers = configuredProviders().map((p) => ({ name: p.name, fastModel: p.fastModel, smartModel: p.smartModel, embeddingModel: p.embeddingModel, baseHost: new URL(p.baseURL).host }));
  return (
    <AgentForm
      initial={s.agent}
      providers={providers}
      memories={memories.map((m) => ({ id: m.id, content: m.content, kind: m.kind }))}
      quiet={{ start: s.quietHoursStart, end: s.quietHoursEnd }}
      serverTts={Boolean(env().TTS_BASE_URL)}
    />
  );
}
