import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentEditor } from "@/components/content/editor";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { sha256 } from "@/lib/security/crypto";

export const metadata: Metadata = { title: "Editor" };
export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await db().query.contentDrafts.findFirst({ where: and(eq(schema.contentDrafts.id, id), eq(schema.contentDrafts.userId, user.id)) });
  if (!d) notFound();
  return (
    <>
      <PageHeader title="Edit post" />
      <ContentEditor
        draft={{ id: d.id, title: d.title, body: d.body, status: d.status, writtenBy: d.writtenBy, approved: Boolean(d.approvedHash && d.approvedHash === sha256(d.body)), scheduledFor: d.scheduledFor?.toISOString() ?? null }}
        author={{ name: user.name, role: user.role, avatarUrl: user.avatarUrl, email: user.email }}
      />
    </>
  );
}
