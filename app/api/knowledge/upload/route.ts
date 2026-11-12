import { restrictedResponse } from "@/lib/admin/restrictions";
import { apiGuard } from "@/lib/auth/api";
import { detectKind, extractText, MAX_UPLOAD_BYTES } from "@/lib/knowledge/extract";
import { ensureSource, refreshSourceCount, upsertItem } from "@/lib/knowledge/ingest";
import { errMessage, log } from "@/lib/log";
import { sha256 } from "@/lib/security/crypto";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Upload PDF/DOCX/TXT/MD into the knowledge base (text extracted; the file itself is not kept). */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const restricted = await restrictedResponse(g.user.id, "uploads");
  if (restricted) return restricted;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorJson(400, "No file received.");
  if (file.size > MAX_UPLOAD_BYTES) return errorJson(413, "Files up to 4 MB, please.");
  const kind = detectKind(file.name, file.type);
  if (!kind) return errorJson(415, "Use a PDF, DOCX, TXT or Markdown file.");
  try {
    const buf = await file.arrayBuffer();
    const text = await extractText(buf, kind);
    if (!text.trim()) return errorJson(422, "No readable text found in that file.");
    const source = await ensureSource(g.user.id, "upload", "Uploads");
    const result = await upsertItem(source, { externalId: sha256(Buffer.from(buf).toString("base64")).slice(0, 32), title: file.name.slice(0, 200), mimeType: file.type || kind, text });
    await refreshSourceCount(source.id);
    return Response.json({ ok: true, result });
  } catch (err) {
    log.warn("knowledge.upload_failed", { kind, error: errMessage(err) });
    return errorJson(422, "Couldn't read that file.");
  }
}
