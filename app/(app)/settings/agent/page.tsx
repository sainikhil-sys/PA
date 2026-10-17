import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AgentForm } from "@/components/settings/agent-form";
import { AI_PRESETS } from "@/lib/ai/user-provider";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/db/queries/settings";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Agent" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const user = await requireOwner();
  const [s, memories] = await Promise.all([getSettings(user.id), db().select().from(schema.memories).where(eq(schema.memories.userId, user.id)).orderBy(desc(schema.memories.createdAt)).limit(100)]);
  const aiPresets = Object.entries(AI_PRESETS).map(([id, x]) => ({ id, ...x }));
  const own = s.aiProvider;
  const ownKey = own ? { preset: own.preset, label: AI_PRESETS[own.preset as keyof typeof AI_PRESETS]?.label ?? "Custom", keyHint: own.keyHint, fastModel: own.fastModel, smartModel: own.smartModel, addedAt: own.addedAt } : null;
  return (
    <AgentForm
      initial={s.agent}
      aiPresets={aiPresets}
      ownKey={ownKey}
      memories={memories.map((m) => ({ id: m.id, content: m.content, kind: m.kind }))}
      quiet={{ start: s.quietHoursStart, end: s.quietHoursEnd }}
      serverTts={Boolean(env().TTS_BASE_URL)}
    />
  );
}
