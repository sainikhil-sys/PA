import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { logActivity } from "@/lib/db/queries/activity";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/db/queries/tokens";
import { ALL_SCOPES } from "@/lib/security/scopes";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/** Token management API (cookie session + same-origin check). Raw tokens are returned once on POST. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  return Response.json({ items: await listApiTokens(g.user.id) }, { headers: { "cache-control": "no-store" } });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1), expiresInDays: z.number().int().min(1).max(365).nullable() });

export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "invalid_request");
  const { token, record } = await createApiToken(g.user.id, { ...parsed.data, scopes: parsed.data.scopes as never });
  await logActivity({ userId: g.user.id, actor: "me", tool: "token.created", inputSummary: parsed.data.name, outcome: "success" });
  return Response.json({ token, id: record.id }, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(400, "invalid id");
  const ok = await revokeApiToken(g.user.id, id);
  if (ok) await logActivity({ userId: g.user.id, actor: "me", tool: "token.revoked", inputSummary: `id=${id}`, outcome: "success" });
  return ok ? new Response(null, { status: 204 }) : errorJson(404, "not found");
}
