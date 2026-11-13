import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { createRoom, listRooms, roomCreateSchema } from "@/lib/spaces/rooms";

export const dynamic = "force-dynamic";

/** Focus rooms and listen-together rooms in the Space, with how many people are here: {items}. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await listRooms(user, param((await params).id, uuidSchema)) }));
}

/** Members who can post: open a room {kind: "focus" | "listen", title}. Answers {ok, id}. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => createRoom(user, param((await params).id, uuidSchema), await body(req, roomCreateSchema)));
}
