import { pruneUnsentFiles, saveBroadcastFile } from "@/lib/admin/broadcast-files";
import { adminRequestWith } from "@/lib/admin/route-guard";
import { classifyUpload, MAX_ATTACHMENT_BYTES } from "@/lib/email/attachments";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Upload one image (role "inline") or document (role "attachment") for a broadcast email.
 * Role holders with notifications.send and an unlocked console only; everyone else gets the same 404
 * as a missing route. The file's type is decided by its bytes (lib/email/attachments.ts), never by
 * what the browser claims.
 */
export async function POST(req: Request) {
  const g = await adminRequestWith(req, "notifications.send");
  if (g instanceof Response) return g;

  if (Number(req.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 64 * 1024) return errorJson(413, "That file is too large.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const role = form?.get("role");
  if (!(file instanceof File) || (role !== "inline" && role !== "attachment")) return errorJson(400, "Choose a file to upload.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const c = classifyUpload(file.name, bytes, role);
  if (!c.ok) return errorJson(415, c.error);

  await pruneUnsentFiles().catch(() => {});
  const saved = await saveBroadcastFile({
    uploadedBy: g.user.id,
    role,
    filename: c.filename,
    contentType: c.contentType,
    size: bytes.length,
    width: c.width,
    height: c.height,
    data: Buffer.from(bytes),
  });
  return Response.json(saved);
}
