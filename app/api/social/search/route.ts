import { handle } from "@/lib/social/http";
import { searchMessages } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Search the text of your own person-to-person chats. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await searchMessages(user.id, new URL(req.url).searchParams.get("q") ?? "") }));
}
