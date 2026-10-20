import { apiGuard } from "@/lib/auth/api";
import { signOutCurrent } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/queries/activity";
import { noStore } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** Revokes the app's own session token. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  await logActivity({ userId: g.user.id, actor: "me", tool: "auth.sign_out", inputSummary: "Android app", outcome: "success" });
  await signOutCurrent();
  return Response.json({ ok: true }, { headers: noStore });
}
