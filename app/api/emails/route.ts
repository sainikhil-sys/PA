import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { listEmails, listImportantEmails } from "@/lib/db/queries/emails";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const filter = z.enum(["important", "all", "URGENT", "REPLY_NEEDED", "FYI", "NEWSLETTER", "SPAM"]);

/** Email metadata + one-line summaries only. Bodies are never stored or returned. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const f = filter.safeParse(new URL(req.url).searchParams.get("filter") ?? "important");
  if (!f.success) return errorJson(400, "invalid filter");
  const rows = f.data === "important" ? await listImportantEmails(g.user.id, 50) : await listEmails(g.user.id, { category: f.data === "all" ? undefined : f.data, limit: 100 });
  return Response.json(
    { items: rows.map((e) => ({ id: e.id, fromName: e.fromName, fromEmail: e.fromEmail, subject: e.subject, summary: e.summary, snippet: e.snippet, category: e.category, receivedAt: e.receivedAt.toISOString(), draftId: e.draftId })) },
    { headers: { "cache-control": "no-store" } },
  );
}
