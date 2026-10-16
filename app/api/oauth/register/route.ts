import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { OAuthError, registerClient } from "@/lib/mcp/oauth";
import { oauthError } from "@/lib/mcp/oauth-core";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { clientIp } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/** RFC 7591 Dynamic Client Registration (public clients, PKCE required). */
export async function POST(req: Request) {
  const rl = await rateLimit("oauth", `register:${clientIp(req)}`);
  if (!rl.success) return rateLimitResponse(rl);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  try {
    const client = await registerClient(body);
    return Response.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      { status: 201, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof OAuthError) return oauthError(err.code, err.message);
    return oauthError("server_error", "Registration failed", 500);
  }
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
