import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationGrid, type ConnState } from "@/components/integrations/integration-grid";
import { CardSkeleton } from "@/components/today/card-skeleton";
import { PageHeader } from "@/components/ui/states";
import { isAdmin } from "@/lib/auth/policy";
import { requireOwner } from "@/lib/auth/session";
import { listIntegrations } from "@/lib/db/queries/settings";
import { env } from "@/lib/env";
import { CATALOG } from "@/lib/integrations/catalog";
import { oauthConfigured } from "@/lib/integrations/oauth";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const user = await requireOwner();
  const rows = await listIntegrations(user.id);
  const states: Record<string, ConnState> = Object.fromEntries(rows.map((r) => [r.provider, { status: r.status as ConnState["status"], label: r.accountLabel, error: r.lastError }]));
  const e = env();
  return (
    <>
      <PageHeader title="Integrations" description="Connect the tools you use. Read-only by default; drafts at most. Nothing is ever sent or deleted for you." />
      <Suspense fallback={<CardSkeleton rows={4} />}>
        <IntegrationGrid catalog={CATALOG} states={states} telegramConfigured={isAdmin(user.email) && Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID)} oauthReady={{ linkedin: oauthConfigured("linkedin"), canva: oauthConfigured("canva") }} />
      </Suspense>
      <p className="mt-10 text-[12px] text-subtle">Brand logos are trademarks of their owners, shown in original colors to identify each service. Marks courtesy of Simple Icons (CC0).</p>
    </>
  );
}
