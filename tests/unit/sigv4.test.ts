import { describe, expect, it } from "vitest";
import { presign } from "@/lib/media/sigv4";

describe("SigV4 presigned URLs", () => {
  // AWS documentation: "Example: Authenticating Requests by Using Query Parameters" (S3, SigV4).
  it("matches AWS's published example signature", () => {
    const url = presign({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresS: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("signs required headers and encodes path segments", () => {
    const url = presign({
      method: "PUT",
      host: "acct.r2.cloudflarestorage.com",
      path: "/bucket/media/a b.jpg",
      region: "auto",
      accessKeyId: "k",
      secretAccessKey: "s",
      expiresS: 300,
      headers: { "Content-Type": "image/jpeg" },
      now: new Date("2026-11-12T10:00:00Z"),
    });
    expect(url).toContain("/bucket/media/a%20b.jpg?");
    expect(url).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });
});
