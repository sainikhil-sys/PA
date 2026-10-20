import { apiGuard } from "@/lib/auth/api";
import { listNotes, noteTagCounts } from "@/lib/db/queries/notes";
import { toNoteRow } from "@/lib/notes/service";
import { normalizeTags } from "@/lib/notes/text";

export const dynamic = "force-dynamic";

/** Notes list for the Notes tab: filtered rows plus tag counts. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.slice(0, 200) ?? "";
  const tag = normalizeTags(url.searchParams.get("tag") ?? "")[0];
  const k = url.searchParams.get("kind");
  const kind = k === "notes" || k === "bookmarks" ? k : "all";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const [rows, tags] = await Promise.all([listNotes(g.user.id, { q, tag, kind, limit }), noteTagCounts(g.user.id)]);
  return Response.json({ notes: rows.map(toNoteRow), tags }, { headers: { "cache-control": "no-store" } });
}
