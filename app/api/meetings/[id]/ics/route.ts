import { apiGuard } from "@/lib/auth/api";
import { meetingIcs } from "@/lib/business/deals";
import { fail } from "@/lib/mobile/http";
import { SocialError } from "@/lib/social/service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The meeting as a calendar file to add to any calendar app. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  if (!UUID.test(id)) return fail(404, "That meeting isn't available.");
  try {
    const ics = await meetingIcs(g.user, id);
    return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="cowork-meeting.ics"`, "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof SocialError) return fail(err.status, err.message);
    throw err;
  }
}
