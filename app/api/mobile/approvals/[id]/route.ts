import { z } from "zod";
import { dismissProposal, executeProposal } from "@/lib/agent/proposals";
import { apiGuard } from "@/lib/auth/api";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const body = z.object({
  action: z.enum(["approve", "dismiss"]),
  edits: z.object({ title: z.string().max(200).optional(), when: z.string().max(100).optional() }).optional(),
});

/** The app's Approve / Dismiss buttons. Like the web, an explicit tap is the only way a proposal runs. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail(404, "Not found");
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Invalid request");
  if (parsed.data.action === "dismiss") {
    await dismissProposal(g.user.id, id);
    return Response.json({ ok: true, message: "Dismissed" }, { headers: noStore });
  }
  const res = await executeProposal(g.user, id, parsed.data.edits);
  if (!res.ok) return fail(400, res.message);
  return Response.json({ ok: true, message: res.message }, { headers: noStore });
}
