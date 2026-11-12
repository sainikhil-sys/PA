import "server-only";
import { env } from "@/lib/env";
import { presign } from "./sigv4";

/** Upload links are short: enough for a slow phone connection to finish one file. */
export const UPLOAD_URL_TTL_S = 10 * 60;
/** Read links are shorter-lived than any cache in front of them; the API hands out fresh ones. */
export const READ_URL_TTL_S = 60 * 60;

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

/** Null until all four R2 values are set; media features then say they aren't available yet. */
export function r2Config(): R2Config | null {
  const e = env();
  if (!e.R2_ACCOUNT_ID || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY || !e.R2_BUCKET) return null;
  if (!/^[a-f0-9]{32}$/i.test(e.R2_ACCOUNT_ID) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(e.R2_BUCKET)) return null;
  return { accountId: e.R2_ACCOUNT_ID, accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY, bucket: e.R2_BUCKET };
}

function sign(cfg: R2Config, method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, expiresS: number, extra: { headers?: Record<string, string>; query?: Record<string, string> } = {}) {
  return presign({
    method,
    host: `${cfg.accountId}.r2.cloudflarestorage.com`,
    path: `/${cfg.bucket}/${key}`,
    region: "auto",
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresS,
    ...extra,
  });
}

/** A one-object PUT link. The client must send exactly this Content-Type, or R2 rejects the upload. */
export function uploadUrl(cfg: R2Config, key: string, contentType: string) {
  return { url: sign(cfg, "PUT", key, UPLOAD_URL_TTL_S, { headers: { "content-type": contentType } }), headers: { "content-type": contentType } };
}

export function readUrl(cfg: R2Config, key: string) {
  return sign(cfg, "GET", key, READ_URL_TTL_S);
}

/** Size and type of an uploaded object, or null if it isn't there. */
export async function headObject(cfg: R2Config, key: string): Promise<{ size: number; contentType: string | null } | null> {
  const res = await fetch(sign(cfg, "HEAD", key, 60), { method: "HEAD", signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
}

export async function deleteObject(cfg: R2Config, key: string): Promise<void> {
  const res = await fetch(sign(cfg, "DELETE", key, 60), { method: "DELETE", signal: AbortSignal.timeout(5000) });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
}
