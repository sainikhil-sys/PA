import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { appUrl } from "@/lib/env";
import { ALL_SCOPES } from "@/lib/security/scopes";

export const dynamic = "force-dynamic";

/** RFC 9728 Protected Resource Metadata for /api/mcp. */
export function GET() {
  const base = appUrl();
  return Response.json(
    generateProtectedResourceMetadata({
      authServerUrls: [base],
      resourceUrl: `${base}/api/mcp`,
      additionalMetadata: { scopes_supported: ALL_SCOPES, resource_name: "Cowork" },
    }),
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } },
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
