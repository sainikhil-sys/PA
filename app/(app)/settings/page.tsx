import type { Metadata } from "next";
import { ProfileForm } from "@/components/settings/profile-form";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireOwner();
  const s = await getSettings(user.id);
  return (
    <ProfileForm
      initial={{ name: user.name ?? "", email: user.email, role: user.role ?? "", bio: user.bio ?? "", avatarUrl: user.avatarUrl, timezone: s.timezone, language: s.language, dateFormat: s.dateFormat, timeFormat: s.timeFormat }}
    />
  );
}
