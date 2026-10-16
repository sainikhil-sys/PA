import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/queries/activity";
import { appUrl } from "@/lib/env";
import { saveGoogleConnection } from "@/lib/integrations/google";
import { errMessage, log } from "@/lib/log";
import { safeEqual } from "@/lib/security/crypto";
import { enqueue } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getOwner();
  if (!user) return Response.redirect(`${appUrl()}/login`, 302);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("pa_google_state")?.value;
  const returnTo = jar.get("pa_google_return")?.value ?? "/integrations";
  jar.delete("pa_google_state");
  jar.delete("pa_google_return");

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!expected || !state || !safeEqual(expected, state)) return Response.redirect(`${appUrl()}${returnTo}?error=state`, 302);
  if (!code) return Response.redirect(`${appUrl()}${returnTo}?error=denied`, 302);

  try {
    await saveGoogleConnection(user.id, code);
    await logActivity({ userId: user.id, actor: "me", tool: "integration.connected", inputSummary: "google", outcome: "success" });
    await enqueue(user.id, "sync_inbox", {}, { dedupeKey: `sync:${user.id}:connect` });
    return Response.redirect(`${appUrl()}${returnTo}?connected=google`, 302);
  } catch (err) {
    log.error("google.connect_failed", { error: errMessage(err) });
    return Response.redirect(`${appUrl()}${returnTo}?error=google`, 302);
  }
}
