import { handle } from "@/lib/social/http";
import { mySpaces } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Spaces you're in, or asked to join. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await mySpaces(user) }));
}
