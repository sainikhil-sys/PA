import { and, eq } from "drizzle-orm";
import { getOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;

/**
 * Proxies a news item's lead image. Only the URL stored for that item (from the
 * configured feeds) is fetched — never a URL from the request — so this can't be
 * used to reach arbitrary hosts, and readers' IPs aren't sent to publishers.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOwner();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const [row] = await db()
    .select({ url: schema.newsItems.imageUrl })
    .from(schema.newsItems)
    .where(and(eq(schema.newsItems.id, id), eq(schema.newsItems.userId, user.id)))
    .limit(1);
  if (!row?.url || !row.url.startsWith("https://")) return new Response(null, { status: 404 });

  const upstream = await fetch(row.url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { accept: "image/avif,image/webp,image/*" } }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !/^image\/(jpeg|png|webp|gif|avif)/.test(type)) return new Response(null, { status: 404 });
  const len = Number(upstream.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return new Response(null, { status: 404 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response(null, { status: 404 });
  return new Response(body, {
    headers: { "content-type": type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" },
  });
}
