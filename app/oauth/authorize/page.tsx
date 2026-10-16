import type { Metadata } from "next";
import { ConsentCard } from "@/components/settings/consent-card";
import { Logo } from "@/components/layout/logo";
import { requireOwner } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";
import { assertRedirect, OAuthError, resolveClient } from "@/lib/mcp/oauth";
import { authorizeParamsSchema, resolveRequestedScopes } from "@/lib/mcp/oauth-core";
import { SCOPES } from "@/lib/security/scopes";

export const metadata: Metadata = { title: "Authorize" };
export const dynamic = "force-dynamic";

function ErrorCard({ message }: { message: string }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-surface px-4">
      <div className="w-full max-w-[420px] rounded-[20px] border border-border bg-background p-8 text-center">
        <Logo withWord={false} />
        <h1 className="mt-6 font-serif text-[24px]">Can't authorize</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
      </div>
    </main>
  );
}

/** OAuth 2.1 consent for MCP clients (Claude). PKCE S256 required; redirect URIs allowlisted. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner();
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined)) as Record<string, string>;
  const parsed = authorizeParamsSchema.safeParse(raw);
  if (!parsed.success) return <ErrorCard message="This request is missing required parameters (PKCE S256 is required)." />;
  const p = parsed.data;
  if (p.resource && ![`${appUrl()}/api/mcp`, appUrl()].includes(p.resource.replace(/\/$/, ""))) return <ErrorCard message="This request is for a different server." />;
  let clientName = "";
  try {
    const client = await resolveClient(p.client_id);
    assertRedirect(client, p.redirect_uri);
    clientName = client.clientName;
  } catch (err) {
    return <ErrorCard message={err instanceof OAuthError ? err.message : "Unknown application."} />;
  }
  const requested = resolveRequestedScopes(p.scope);
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-surface px-4 py-12">
      <ConsentCard params={raw} clientName={clientName} redirectHost={new URL(p.redirect_uri).host} scopes={requested.map((s) => ({ id: s, label: SCOPES[s] }))} />
    </main>
  );
}
