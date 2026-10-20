import { pendingProposals, PROPOSAL_LABEL } from "@/lib/agent/proposals";
import { apiGuard } from "@/lib/auth/api";
import { noStore } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** What the agent prepared and is waiting on you for. Nothing here has run. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const rows = await pendingProposals(g.user.id, 50);
  return Response.json(
    {
      items: rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        label: PROPOSAL_LABEL[p.kind] ?? p.kind,
        summary: p.summary,
        source: p.source,
        conversationId: p.conversationId,
        createdAt: p.createdAt,
      })),
    },
    { headers: noStore },
  );
}
