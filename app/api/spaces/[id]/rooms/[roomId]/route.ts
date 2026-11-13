import { body, handle, param, uuidSchema } from "@/lib/social/http";
import { changeRoom, deleteRoom, getRoom, roomActionSchema } from "@/lib/spaces/rooms";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; roomId: string }> };

async function ids(params: Params["params"]) {
  const p = await params;
  return { spaceId: param(p.id, uuidSchema), roomId: param(p.roomId, uuidSchema) };
}

/** The room: timer (synced to serverNow), shared link, and who chose to show they are here. */
export async function GET(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, roomId } = await ids(params);
    return getRoom(user, spaceId, roomId);
  });
}

/** Timer: start {minutes}, pause, resume, reset. Listen together: media {url}, restart, clearMedia. Answers {ok, room}. */
export async function PATCH(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, roomId } = await ids(params);
    return changeRoom(user, spaceId, roomId, await body(req, roomActionSchema));
  });
}

/** Whoever made the room, or the Space's owners and moderators. */
export async function DELETE(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, roomId } = await ids(params);
    await deleteRoom(user, spaceId, roomId);
    return { ok: true };
  });
}
