import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { KnowledgePage } from "@/components/knowledge/knowledge-page";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { listIntegrations } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Knowledge" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function Page() {
  const user = await requireOwner();
  const [sources, integrations] = await Promise.all([
    db().select().from(schema.knowledgeSources).where(eq(schema.knowledgeSources.userId, user.id)).orderBy(desc(schema.knowledgeSources.createdAt)),
    listIntegrations(user.id),
  ]);
  const connected = Object.fromEntries(integrations.map((i) => [i.provider, i.status === "connected"]));
  // The page header and the Sources/Notes tabs come from knowledge/layout.tsx.
  return (
    <KnowledgePage
      connected={connected}
      sources={sources.map((s) => ({ id: s.id, type: s.type, name: s.name, included: s.included, status: s.status, itemCount: s.itemCount, lastSyncAt: s.lastSyncAt?.toISOString() ?? null, lastError: s.lastError, config: s.config }))}
    />
  );
}
