import type { Metadata } from "next";
import { NotificationsForm } from "@/components/settings/prefs-form";
import { isAdmin } from "@/lib/auth/policy";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireOwner();
  const s = await getSettings(user.id);
  const e = env();
  return <NotificationsForm initial={s} telegramConfigured={Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID)} telegramAllowed={isAdmin(user.email)} digestAvailable={Boolean(e.RESEND_API_KEY)} />;
}
