import type { Metadata } from "next";
import { PhoneView } from "@/components/phone/phone-view";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { listPhoneFeed } from "@/lib/phone-server";

export const metadata: Metadata = { title: "Phone" };
export const dynamic = "force-dynamic";

/** APK for the Android companion app, served from /downloads when it has been built. */
const APK_URL = process.env.NEXT_PUBLIC_PHONE_APK_URL || "/downloads/cowork-phone-link.apk";

export default async function PhonePage() {
  const user = await requireOwner();
  const feed = await listPhoneFeed(user.id);
  return (
    <>
      <PageHeader title="Phone" description="Your Android phone's calls, messages and notifications, live in Cowork." />
      <PhoneView initial={feed} apkUrl={APK_URL} />
    </>
  );
}
