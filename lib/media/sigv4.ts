import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 query-string presigning (S3-compatible), used for Cloudflare R2.
 * A presigned URL lets the phone or browser upload or download one object directly, for a few
 * minutes, without the server proxying the bytes (Vercel caps request bodies at 4.5 MB).
 * Verified against AWS's published example in tests/unit/sigv4.test.ts.
 */

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  host: string;
  /** Path including bucket when path-style, e.g. "/bucket/media/abc.jpg". Each segment is encoded here. */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresS: number;
  now?: Date;
  /** Extra signed query parameters (e.g. response-content-disposition). */
  query?: Record<string, string>;
  /** Headers the client must send with exactly these values (e.g. content-type on PUT). `host` is always signed. */
  headers?: Record<string, string>;
};

export function presign(i: PresignInput): string {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const headers: Record<string, string> = { host: i.host };
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = v.trim();
  const signedHeaders = Object.keys(headers).sort().join(";");
  const params: Record<string, string> = {
    ...i.query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${i.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(i.expiresS),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k]!)}`)
    .join("&");
  const canonicalPath = i.path
    .split("/")
    .map((seg) => enc(seg))
    .join("/");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonicalRequest = [i.method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `https://${i.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
