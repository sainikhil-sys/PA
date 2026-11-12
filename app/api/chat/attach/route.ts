import { restrictedResponse } from "@/lib/admin/restrictions";
import { capabilityOffResponse } from "@/lib/ai/gate";
import { apiGuard } from "@/lib/auth/api";
import { detectChatKind, IMAGE_UNSUPPORTED, isImageFile, isSecretFile, MAX_ATTACHMENT_CHARS, MAX_TEXT_FILE_BYTES, SECRET_FILE_REFUSED, UNSUPPORTED_FILE } from "@/lib/chat/attachments";
import { getConfigValue } from "@/lib/config/store";
import { cappedLimit, fileTooLargeMessage, formatLimit, uploadLimitBytes } from "@/lib/config/uploads";
import { extractText, looksBinary } from "@/lib/knowledge/extract";
import { errMessage, log } from "@/lib/log";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Extracts text from an attached PDF, DOCX, text or code file so the agent can
 * answer about it. The file is not kept; the extracted text is saved with the
 * chat message when it is sent.
 */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const restricted = await restrictedResponse(g.user.id, "uploads");
  if (restricted) return restricted;
  const off = await capabilityOffResponse("documents");
  if (off) return off;
  const maxMb = await getConfigValue("uploads.maxMb");
  const maxBytes = uploadLimitBytes(maxMb);
  const textMax = cappedLimit(MAX_TEXT_FILE_BYTES, maxMb);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes + 10_000) return errorJson(413, fileTooLargeMessage(maxBytes));
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorJson(400, "No file received.");
  if (isImageFile(file.name, file.type)) return errorJson(415, IMAGE_UNSUPPORTED);
  if (isSecretFile(file.name)) return errorJson(415, SECRET_FILE_REFUSED);
  const kind = detectChatKind(file.name, file.type);
  if (!kind) return errorJson(415, UNSUPPORTED_FILE);
  const isText = kind === "txt" || kind === "md" || kind === "code";
  if (file.size > (isText ? textMax : maxBytes)) return errorJson(413, isText ? `Text and code files up to ${formatLimit(textMax)}, please.` : fileTooLargeMessage(maxBytes));
  try {
    const buf = await file.arrayBuffer();
    if (isText && looksBinary(buf)) return errorJson(415, "That file isn't plain text.");
    const raw = await extractText(buf, kind);
    if (!raw.trim()) return errorJson(422, "No readable text found in that file.");
    // Keep leading indentation in code; only normalise line endings and trailing space.
    const text = isText ? raw.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : raw.trim();
    return Response.json({ name: file.name.slice(0, 200), kind, text: text.slice(0, MAX_ATTACHMENT_CHARS), truncated: text.length > MAX_ATTACHMENT_CHARS });
  } catch (err) {
    log.warn("attach.extract_failed", { kind, error: errMessage(err) });
    return errorJson(422, "Couldn't read that file.");
  }
}
