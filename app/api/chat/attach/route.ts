import { apiGuard } from "@/lib/auth/api";
import { detectKind, extractText, MAX_UPLOAD_BYTES } from "@/lib/knowledge/extract";
import { errMessage, log } from "@/lib/log";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Extracts text from an attached PDF/DOCX/TXT/MD so the agent can answer about it. Nothing is stored. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 10_000) return errorJson(413, "File is too large (max 4 MB).");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorJson(400, "No file received.");
  if (file.size > MAX_UPLOAD_BYTES) return errorJson(413, "File is too large (max 4 MB).");
  const kind = detectKind(file.name, file.type);
  if (!kind) return errorJson(415, "Use a PDF, DOCX, TXT or Markdown file.");
  try {
    const text = (await extractText(await file.arrayBuffer(), kind)).trim();
    if (!text) return errorJson(422, "No readable text found in that file.");
    return Response.json({ name: file.name.slice(0, 200), text: text.slice(0, 60_000), truncated: text.length > 60_000 });
  } catch (err) {
    log.warn("attach.extract_failed", { kind, error: errMessage(err) });
    return errorJson(422, "Couldn't read that file.");
  }
}
