import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { leaveStartup } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await leaveStartup(user, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
