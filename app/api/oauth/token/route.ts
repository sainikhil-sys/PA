import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { exchangeCode, OAuthError, refreshTokens } from "@/lib/mcp/oauth";
import { oauthError, tokenRequestSchema } from "@/lib/mcp/oauth-core";
import { log, errMessage } from "@/lib/log";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { clientIp } from "@/lib/security/request";

export const dynamic = "force-dynamic";

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

export async function POST(req: Request) {
  const rl = await rateLimit("oauth", `token:${clientIp(req)}`);
  if (!rl.success) return rateLimitResponse(rl);
  let raw: Record<string, string>;
  try {
    raw = await readBody(req);
  } catch {
    return oauthError("invalid_request", "Malformed body");
  }
  const parsed = tokenRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const gt = raw.grant_type;
    return oauthError(gt && !["authorization_code", "refresh_token"].includes(gt) ? "unsupported_grant_type" : "invalid_request", "Invalid token request");
  }
  try {
    const body =
      parsed.data.grant_type === "authorization_code"
        ? await exchangeCode({
            code: parsed.data.code,
            clientId: parsed.data.client_id,
            redirectUri: parsed.data.redirect_uri,
            codeVerifier: parsed.data.code_verifier,
          })
        : await refreshTokens({ refreshToken: parsed.data.refresh_token, clientId: parsed.data.client_id });
    return Response.json(body, { headers: { "cache-control": "no-store", pragma: "no-cache", "access-control-allow-origin": "*" } });
  } catch (err) {
    if (err instanceof OAuthError) return oauthError(err.code, err.message);
    log.error("oauth.token_failed", { error: errMessage(err) });
    return oauthError("server_error", "Token request failed", 500);
  }
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
