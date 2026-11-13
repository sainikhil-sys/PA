import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProProfileForm } from "@/components/startups/forms";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { myProProfile, requireNetwork } from "@/lib/startups/service";
import { getProfile, SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Professional profile" };
export const dynamic = "force-dynamic";

export default async function ProProfilePage() {
  const user = await requireOwner();
  if (!user.birthDate || !(await getProfile(user.id))) redirect("/feed");
  const gate = await requireNetwork(user).catch((err) => (err instanceof SocialError ? err.message : Promise.reject(err)));
  if (typeof gate === "string") redirect("/startups");
  const pro = await myProProfile(user.id);
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <Link href="/startups" className="text-[13px] text-muted hover:text-foreground">
        Startups
      </Link>
      <PageHeader title="Professional profile" description="How you appear in the startup network: shown on your profile to the people you choose." />
      <ProProfileForm initial={pro} />
    </div>
  );
}
