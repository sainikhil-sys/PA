import type { Metadata } from "next";
import { AppearanceForm } from "@/components/settings/prefs-form";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Appearance" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireOwner();
  return <AppearanceForm initial={await getSettings(user.id)} />;
}
