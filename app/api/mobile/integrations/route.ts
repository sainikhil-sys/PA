import { apiGuard } from "@/lib/auth/api";
import { listIntegrations } from "@/lib/db/queries/settings";
import { CATALOG } from "@/lib/integrations/catalog";
import { noStore } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * Connected services, read-only. Connecting and disconnecting stay on the website, where the
 * OAuth flows run; the app links there.
 */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const rows = await listIntegrations(g.user.id);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const items = CATALOG.filter((c) => c.connect !== "none").map((c) => {
    const row = byProvider.get(c.provider ?? c.id);
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      status: row && row.status !== "disconnected" ? row.status : "not_connected",
      account: row?.accountLabel ?? null,
      lastSyncAt: row?.lastSyncAt ?? null,
      error: row?.status === "error" ? (row.lastError ?? "Needs attention") : null,
    };
  });
  return Response.json({ items }, { headers: noStore });
}
