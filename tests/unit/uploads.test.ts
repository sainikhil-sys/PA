import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkUpload, LIMITS } = await import("@/lib/media/uploads");

describe("upload checks", () => {
  it("accepts supported types within the size limit", () => {
    expect(checkUpload("image", "image/jpeg", 2_000_000)).toBeNull();
    expect(checkUpload("video", "video/mp4", 50_000_000)).toBeNull();
    expect(checkUpload("audio", "audio/mp4", 1_000_000)).toBeNull();
  });

  it("refuses other types, empty files and files over the limit", () => {
    expect(checkUpload("image", "image/svg+xml", 1000)).toMatch(/isn't supported/);
    expect(checkUpload("image", "video/mp4", 1000)).toMatch(/isn't supported/);
    expect(checkUpload("image", "image/png", 0)).toMatch(/empty/);
    expect(checkUpload("image", "image/png", LIMITS.image.maxBytes + 1)).toMatch(/15 MB/);
  });
});
