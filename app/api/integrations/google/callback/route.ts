import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/queries/activity";
import { appUrl } from "@/lib/env";
import { saveGoogleConnection } from "@/lib/integrations/google";
import { errMessage, log } from "@/lib/log";
import { safeEqual } from "@/lib/security/crypto";
import { enqueue } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/** Redirect back to the page that started the connect, keeping any query string it already had. */
function back(returnTo: string, key: "connected" | "error", value: string) {
  const base = appUrl();
  let dest = new URL(returnTo, base);
  if (dest.origin !== new URL(base).origin) dest = new URL("/integrations", base);
  dest.searchParams.set(key, value);
  return Response.redirect(dest.toString(), 302);
}

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
  if (!expected || !state || !safeEqual(expected, state)) return back(returnTo, "error", "state");
  if (!code) return back(returnTo, "error", "denied");

  try {
    await saveGoogleConnection(user.id, code);
    await logActivity({ userId: user.id, actor: "me", tool: "integration.connected", inputSummary: "google", outcome: "success" });
    await enqueue(user.id, "sync_inbox", {}, { dedupeKey: `sync:${user.id}:connect` });
    return back(returnTo, "connected", "google");
  } catch (err) {
    log.error("google.connect_failed", { error: errMessage(err) });
    return back(returnTo, "error", "google");
  }
}
