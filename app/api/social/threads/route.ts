import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX } from "@/lib/social/rules";
import { liveThread } from "@/lib/realtime/social";
import { createGroup, listThreads, openDirect } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Your person-to-person chats, newest first. AI chats are separate (/api/chat). */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await listThreads(user.id) }));
}

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), userId: uuidSchema }),
  z.object({
    kind: z.literal("group"),
    title: z.string().trim().min(1, "Give the group a name.").max(GROUP_TITLE_MAX),
    memberIds: z.array(uuidSchema).min(1, "Add at least one friend.").max(GROUP_MAX_MEMBERS - 1),
  }),
]);

/** Opens the direct chat with a friend (finding the existing one), or creates a group. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    const input = await body(req, schema);
    const id = input.kind === "direct" ? await openDirect(user.id, input.userId) : await createGroup(user.id, input.title, input.memberIds);
    if (input.kind === "group") liveThread(id, { event: "dm.updated", payload: { threadId: id } }, { except: user.id });
    return { id };
  });
}
