import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type MomentItem, MomentViewer } from "@/components/moments/moments";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { momentsOf } from "@/lib/moments/service";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Moments" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One person's live Moments you may see. Anything you may not see is simply not there. */
export default async function MomentsPage({ params }: { params: Promise<{ userId: string }> }) {
  const user = await requireOwner();
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const items = await momentsOf(user.id, userId);
  if (!items.length) notFound();
  const [author] = await db()
    .select({ name: schema.socialProfiles.displayName, handle: schema.socialProfiles.handle, avatarUrl: schema.users.avatarUrl })
    .from(schema.socialProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.socialProfiles.userId))
    .where(eq(schema.socialProfiles.userId, userId))
    .limit(1);
  if (!author) notFound();
  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-3">
      <Link href="/feed" className="text-[13px] text-muted hover:text-foreground">
        Back to feed
      </Link>
      <MomentViewer author={author} items={items as MomentItem[]} />
    </div>
  );
}
