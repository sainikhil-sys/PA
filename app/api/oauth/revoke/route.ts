import { revokeToken } from "@/lib/mcp/oauth";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { clientIp } from "@/lib/security/request";
import { looksLikeToken } from "@/lib/security/tokens";

export const dynamic = "force-dynamic";

/** RFC 7009 token revocation. Always 200 so token validity isn't revealed. */
export async function POST(req: Request) {
  const rl = await rateLimit("oauth", `revoke:${clientIp(req)}`);
  if (!rl.success) return rateLimitResponse(rl);
  const params = new URLSearchParams(await req.text());
  const token = params.get("token");
  if (looksLikeToken(token)) await revokeToken(token);
  return new Response(null, { status: 200, headers: { "access-control-allow-origin": "*" } });
}
