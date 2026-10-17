import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { DevicesView } from "@/components/settings/devices-view";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Devices" };
export const dynamic = "force-dynamic";

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ paired?: string }> }) {
  const user = await requireOwner();
  const { paired } = await searchParams;
  const devices = await db()
    .select({ id: schema.pushSubscriptions.id, label: schema.pushSubscriptions.label, createdAt: schema.pushSubscriptions.createdAt, lastUsedAt: schema.pushSubscriptions.lastUsedAt })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, user.id))
    .orderBy(desc(schema.pushSubscriptions.createdAt));
  return (
    <DevicesView
      vapidKey={env().VAPID_PUBLIC_KEY ?? null}
      justPaired={paired === "1"}
      devices={devices.map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt.toISOString(), lastUsedAt: d.lastUsedAt?.toISOString() ?? null }))}
    />
  );
}
