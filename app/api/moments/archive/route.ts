import { handle } from "@/lib/social/http";
import { archive } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

/** Your own Moments, expired ones included: ?before=<iso> for older. */
export async function GET(req: Request) {
  return handle(req, (user) => archive(user.id, new URL(req.url).searchParams.get("before")));
}
