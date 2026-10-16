import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { appUrl } from "@/lib/env";
import { metadata } from "@/lib/mcp/oauth-core";

export const dynamic = "force-dynamic";

/** RFC 8414 Authorization Server Metadata (served at /.well-known/oauth-authorization-server). */
export function GET() {
  return Response.json(metadata(appUrl()), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
