import type { Metadata } from "next";
import { ClaudeConnect } from "@/components/settings/claude-connect";
import { requireOwner } from "@/lib/auth/session";
import { listApiTokens } from "@/lib/db/queries/tokens";
import { appUrl } from "@/lib/env";
import { SCOPES } from "@/lib/security/scopes";

export const metadata: Metadata = { title: "Connect Claude" };
export const dynamic = "force-dynamic";

export default async function ClaudePage() {
  const user = await requireOwner();
  const tokens = await listApiTokens(user.id);
  return (
    <ClaudeConnect
      mcpUrl={`${appUrl()}/api/mcp`}
      scopes={SCOPES}
      tokens={tokens.map((t) => ({ ...t, expiresAt: t.expiresAt?.toISOString() ?? null, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() }))}
    />
  );
}
