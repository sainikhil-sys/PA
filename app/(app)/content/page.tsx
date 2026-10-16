import { and, desc, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { ContentPage } from "@/components/content/content-page";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { truncate } from "@/lib/security/sanitize";

export const metadata: Metadata = { title: "Content" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const user = await requireOwner();
  const [ideas, drafts] = await Promise.all([
    db().select().from(schema.ideas).where(and(eq(schema.ideas.userId, user.id), ne(schema.ideas.status, "dismissed"))).orderBy(desc(schema.ideas.createdAt)).limit(30),
    db().select().from(schema.contentDrafts).where(eq(schema.contentDrafts.userId, user.id)).orderBy(desc(schema.contentDrafts.updatedAt)).limit(50),
  ]);
  return (
    <>
      <PageHeader title="Content" description="Ideas, drafts and your posting calendar. You approve every word; nothing posts by itself." />
      <ContentPage
        ideas={ideas.map((i) => ({ id: i.id, title: i.title, hook: i.hook, source: i.source, createdAt: i.createdAt.toISOString() }))}
        drafts={drafts.map((d) => ({ id: d.id, title: d.title, status: d.status, writtenBy: d.writtenBy, updatedAt: d.updatedAt.toISOString(), scheduledFor: d.scheduledFor?.toISOString() ?? null, preview: truncate(d.body, 140) }))}
      />
    </>
  );
}
