import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { buildClientConfig } from "@/lib/config/client";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { clientIp } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Configuration for the website and the app (docs/ADMIN_CONSOLE_PROPOSAL.md 4.2). Stays up during
 * maintenance and for outdated app builds. Without a session: maintenance, update status, public
 * announcements and public settings. With a session: also flags, targeted announcements minus the
 * ones dismissed, and the person's restrictions.
 */
export async function GET(req: Request) {
  const rl = await rateLimit("api", `config:ip:${clientIp(req)}`);
  if (!rl.success) return rateLimitResponse(rl);
  const session = await getSession();
  const body = JSON.stringify(await buildClientConfig(session?.user ?? null, req.headers));
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = {
    "content-type": "application/json",
    etag,
    "cache-control": session ? "private, max-age=60" : "public, s-maxage=30, stale-while-revalidate=300",
    vary: "Authorization, Cookie, X-Cowork-Platform, X-Cowork-Build, X-Cowork-App-Version",
  };
  const match = req.headers.get("if-none-match");
  if (match && match.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
