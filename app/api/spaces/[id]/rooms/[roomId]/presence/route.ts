import { body, handle, param, uuidSchema } from "@/lib/social/http";
import { heartbeat, leaveRoom, presenceSchema } from "@/lib/spaces/rooms";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; roomId: string }> };

async function ids(params: Params["params"]) {
  const p = await params;
  return { spaceId: param(p.id, uuidSchema), roomId: param(p.roomId, uuidSchema) };
}

/** Heartbeat {consent: true}, every heartbeatMs while "Show that I'm here" is on. Answers {ok, room}. */
export async function POST(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, roomId } = await ids(params);
    await body(req, presenceSchema);
    return heartbeat(user, spaceId, roomId);
  });
}

/** Leave: your presence in the room is deleted at once. */
export async function DELETE(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, roomId } = await ids(params);
    return leaveRoom(user, spaceId, roomId);
  });
}
