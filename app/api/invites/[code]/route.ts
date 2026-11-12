import { handle } from "@/lib/social/http";
import { inviteInfo } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** What an invite link opens (name, description, members), before you join. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(req, async () => ({ invite: await inviteInfo((await params).code.slice(0, 40)) }));
}
