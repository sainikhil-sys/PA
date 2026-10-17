import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { DevicesView } from "@/components/settings/devices-view";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { fcmConfigured } from "@/lib/fcm";

export const metadata: Metadata = { title: "Devices" };

/** Public Firebase web config + Web Push key (both safe to send to the browser), if FCM is set up. */
function firebaseClient(): { config: Record<string, string>; vapidKey: string } | null {
  const e = env();
  // Only when the server can also SEND via Firebase; otherwise keep standard Web Push.
  if (!e.NEXT_PUBLIC_FIREBASE_CONFIG || !e.NEXT_PUBLIC_FIREBASE_VAPID_KEY || !fcmConfigured()) return null;
  try {
    const config = JSON.parse(e.NEXT_PUBLIC_FIREBASE_CONFIG) as Record<string, string>;
    return config.apiKey && config.projectId && config.messagingSenderId && config.appId ? { config, vapidKey: e.NEXT_PUBLIC_FIREBASE_VAPID_KEY } : null;
  } catch {
    return null;
  }
}
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
      firebase={firebaseClient()}
      justPaired={paired === "1"}
      devices={devices.map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt.toISOString(), lastUsedAt: d.lastUsedAt?.toISOString() ?? null }))}
    />
  );
}
