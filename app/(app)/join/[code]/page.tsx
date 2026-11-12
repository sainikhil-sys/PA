import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { JoinButton } from "@/components/spaces/space-actions";
import { StatusPage } from "@/components/layout/status-page";
import { requireOwner } from "@/lib/auth/session";
import { inviteInfo } from "@/lib/spaces/service";
import { getProfile, SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** An invite link: shows the Space first, then joins with the code. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireOwner();
  if (!user.birthDate || !(await getProfile(user.id))) redirect("/feed");
  const { code } = await params;
  const invite = await inviteInfo(code.slice(0, 40)).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!invite) return <StatusPage title="This invite doesn't work anymore" message="It expired, was used up, or the Space was closed. Ask a member for a new link." action={{ href: "/spaces", label: "Browse Spaces" }} />;
  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-3 py-10">
      <p className="text-[13px] text-muted">You&apos;re invited to</p>
      <h1 className="font-serif text-[30px] leading-tight">{invite.name}</h1>
      {invite.description ? <p className="text-[15px] leading-7 text-muted">{invite.description}</p> : null}
      <p className="text-[13px] text-muted">
        {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
      </p>
      <div>
        <JoinButton spaceId={invite.spaceId} status={null} joinPolicy="invite" inviteCode={code.slice(0, 40)} afterJoinHref={`/s/${invite.slug}`} />
      </div>
    </div>
  );
}
