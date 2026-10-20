import { authHeaders } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { useSession } from "@/lib/session";

/** Same limits as the server (lib/knowledge/extract.ts): PDF, DOCX, TXT or Markdown, up to 4 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const PICKER_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown", "text/x-markdown"];

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

export type PickedFile = { uri: string; name: string; size?: number | null; mimeType?: string | null };

/** Returns an error sentence when the file can't be uploaded, or the MIME type to send it as. */
export function checkFile(f: PickedFile): { ok: true; type: string } | { ok: false; message: string } {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const byExt = MIME_BY_EXT[ext];
  const type = f.mimeType && PICKER_TYPES.includes(f.mimeType) ? f.mimeType : byExt;
  if (!type) return { ok: false, message: "Use a PDF, DOCX, TXT or Markdown file." };
  if (f.size != null && f.size > MAX_UPLOAD_BYTES) return { ok: false, message: "Files up to 4 MB, please." };
  return { ok: true, type };
}

export type UploadResult = "created" | "updated" | "unchanged" | "empty";

/** An upload failure. `retryable` is false when sending the same file again can't help (wrong type, too big, unreadable). */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Multipart upload to /api/knowledge/upload with real progress. XMLHttpRequest because fetch has no
 * upload progress. `onUploaded` fires once every byte is sent and the server starts reading the file.
 */
export function uploadDocument(
  f: PickedFile,
  type: string,
  handlers: { onProgress: (fraction: number) => void; onUploaded: () => void },
): { promise: Promise<UploadResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let uploaded = false;
  // React Native's XHR fires only "progress" on xhr.upload (never "load"), so the last byte marks the switch.
  const markUploaded = () => {
    if (uploaded) return;
    uploaded = true;
    handlers.onUploaded();
  };
  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.open("POST", `${API_URL}/api/knowledge/upload`);
    xhr.setRequestHeader("Accept", "application/json");
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || e.total <= 0) return;
      const f = Math.min(1, e.loaded / e.total);
      handlers.onProgress(f);
      if (f >= 1) markUploaded();
    };
    xhr.onerror = () => reject(new UploadError("You're offline. Check your connection and try again.", true));
    xhr.ontimeout = () => reject(new UploadError("The upload took too long. Try again.", true));
    xhr.onabort = () => reject(new UploadError("Upload stopped.", true));
    xhr.onload = () => {
      let body: { ok?: boolean; result?: UploadResult; error?: string; message?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status === 401) {
        useSession.getState().markExpired();
        return reject(new UploadError("Your session has ended. Sign in again.", false));
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) return resolve(body.result ?? "created");
      // 4xx other than rate limiting means the file itself was refused: retrying the same file won't help.
      const retryable = xhr.status === 429 || xhr.status >= 500 || xhr.status === 0;
      const msg = body?.error || body?.message;
      if (msg) return reject(new UploadError(msg, retryable));
      if (xhr.status === 413) return reject(new UploadError("Files up to 4 MB, please.", false));
      if (xhr.status === 429) return reject(new UploadError("Too many requests. Wait a moment and try again.", true));
      if (xhr.status >= 500) return reject(new UploadError("Cowork is having trouble right now. Try again in a minute.", true));
      reject(new UploadError("Couldn't upload that file. Please try again.", retryable));
    };
    xhr.timeout = 150_000;
    const form = new FormData();
    // React Native's FormData takes a file descriptor object in place of a Blob.
    form.append("file", { uri: f.uri, name: f.name, type } as unknown as Blob);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
