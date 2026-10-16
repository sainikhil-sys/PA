import { withMcpAuth } from "mcp-handler";
import { appUrl } from "@/lib/env";
import { verifyMcpToken } from "@/lib/mcp/auth";
import { mcpHandler } from "@/lib/mcp/server";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { clientIp } from "@/lib/security/request";
import { extractBearer, hashToken } from "@/lib/security/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bearer token validated on EVERY request (stateless Streamable HTTP, no sessions). */
const authed = withMcpAuth(mcpHandler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
  resourceUrl: appUrl(),
});

async function handle(req: Request) {
  const bearer = extractBearer(req.headers.get("authorization"));
  // Rate limit per token (hashed) when present, otherwise per IP.
  const key = bearer ? `t:${hashToken(bearer).slice(0, 24)}` : `ip:${clientIp(req)}`;
  const rl = await rateLimit("mcp", key);
  if (!rl.success) return rateLimitResponse(rl);
  return authed(req);
}

export { handle as GET, handle as POST, handle as DELETE };
