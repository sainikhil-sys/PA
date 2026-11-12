import { describe, expect, it } from "vitest";
import { toBase64 } from "../../src/features/connect/bytes";
import { checkOutgoing, cleanMime, formatBytes, isBlockedFile, matchesOffer, MAX_FILE_BYTES, OFFER_TTL_MS, parseOffer, percent, safeName } from "../../src/features/connect/files-logic";

const NOW = 1_800_000_000_000;
const SHA = "a".repeat(64);
const KEY = toBase64(new Uint8Array(32).fill(7));
const JPEG_THUMB = toBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]));

function offer(over: Record<string, unknown> = {}) {
  return { t: "file.offer", transferId: "0f8b2c4e-1111-4a5b-9c7d-123456789abc", name: "notes.pdf", size: 1234, mime: "application/pdf", sha256: SHA, fileKey: KEY, expiresAt: NOW + 60_000, ...over };
}

describe("blocked types", () => {
  it("blocks apps, installers and scripts by extension and type", () => {
    expect(isBlockedFile("game.apk", "application/octet-stream")).toBe(true);
    expect(isBlockedFile("photo.jpg.apk", "image/jpeg")).toBe(true);
    expect(isBlockedFile("setup.EXE. ", "application/octet-stream")).toBe(true);
    expect(isBlockedFile("run.sh", "text/plain")).toBe(true);
    expect(isBlockedFile("file.bin", "application/octet-stream")).toBe(true);
    expect(isBlockedFile("installer", "application/vnd.android.package-archive")).toBe(true);
  });

  it("allows documents and media, including names that only contain a blocked word", () => {
    expect(isBlockedFile("photo.jpg", "image/jpeg")).toBe(false);
    expect(isBlockedFile("apk-guide.pdf", "application/pdf")).toBe(false);
    expect(isBlockedFile("report.exe.pdf", "application/pdf")).toBe(false);
  });
});

describe("checkOutgoing", () => {
  it("enforces the 200 MB limit and rejects empty files", () => {
    expect(checkOutgoing("a.mp4", MAX_FILE_BYTES, "video/mp4").ok).toBe(true);
    expect(checkOutgoing("a.mp4", MAX_FILE_BYTES + 1, "video/mp4").ok).toBe(false);
    expect(checkOutgoing("a.mp4", 0, "video/mp4").ok).toBe(false);
    expect(checkOutgoing("a.apk", 10, "application/octet-stream").ok).toBe(false);
  });
});

describe("parseOffer", () => {
  it("accepts a well-formed offer", () => {
    const o = parseOffer(offer({ thumb: JPEG_THUMB }), NOW);
    expect(o).toMatchObject({ name: "notes.pdf", size: 1234, mime: "application/pdf", kind: "file", disappearing: false, thumb: JPEG_THUMB });
  });

  it("rejects bad keys, hashes, sizes and ids", () => {
    expect(parseOffer(offer({ fileKey: toBase64(new Uint8Array(16)) }), NOW)).toBeNull();
    expect(parseOffer(offer({ fileKey: "not base64!" }), NOW)).toBeNull();
    expect(parseOffer(offer({ sha256: "xyz" }), NOW)).toBeNull();
    expect(parseOffer(offer({ size: MAX_FILE_BYTES + 1 }), NOW)).toBeNull();
    expect(parseOffer(offer({ size: 1.5 }), NOW)).toBeNull();
    expect(parseOffer(offer({ transferId: "../../x" }), NOW)).toBeNull();
  });

  it("rejects expired offers and offers that claim too long a life", () => {
    expect(parseOffer(offer({ expiresAt: NOW - 1 }), NOW)).toBeNull();
    expect(parseOffer(offer({ expiresAt: NOW + OFFER_TTL_MS + 6 * 60_000 }), NOW)).toBeNull();
  });

  it("rejects executables even when the sender claims another type", () => {
    expect(parseOffer(offer({ name: "cute-cat.apk", mime: "image/jpeg" }), NOW)).toBeNull();
  });

  it("strips folders from names and drops thumbnails that are not JPEG", () => {
    const o = parseOffer(offer({ name: "../../data/evil.pdf", thumb: toBase64(new Uint8Array([1, 2, 3, 4, 5, 6])) }), NOW);
    expect(o?.name).toBe("evil.pdf");
    expect(o?.thumb).toBeNull();
  });

  it("never keeps a preview for a view-once snap", () => {
    const o = parseOffer(offer({ name: "p.jpg", mime: "image/jpeg", kind: "snap", disappearing: true, thumb: JPEG_THUMB }), NOW);
    expect(o?.disappearing).toBe(true);
    expect(o?.thumb).toBeNull();
  });

  it("only allows view-once on snaps and audio types on voice messages", () => {
    expect(parseOffer(offer({ disappearing: true }), NOW)?.disappearing).toBe(false);
    expect(parseOffer(offer({ kind: "voice" }), NOW)).toBeNull();
    expect(parseOffer(offer({ kind: "voice", name: "v.m4a", mime: "audio/mp4", durationMs: 4200 }), NOW)?.durationMs).toBe(4200);
    expect(parseOffer(offer({ kind: "snap" }), NOW)).toBeNull();
  });
});

describe("helpers", () => {
  it("verifies hash and size against the offer", () => {
    expect(matchesOffer({ size: 10, sha256: SHA.toUpperCase() }, { size: 10, sha256: SHA })).toBe(true);
    expect(matchesOffer({ size: 11, sha256: SHA }, { size: 10, sha256: SHA })).toBe(false);
    expect(matchesOffer({ size: 10, sha256: "b".repeat(64) }, { size: 10, sha256: SHA })).toBe(false);
  });

  it("cleans names and types", () => {
    expect(safeName("..hidden")).toBe("hidden");
    expect(safeName("a\u0000b<c>.txt")).toBe("abc.txt");
    expect(safeName("")).toBe("file");
    expect(safeName(`${"x".repeat(300)}.pdf`).endsWith(".pdf")).toBe(true);
    expect(safeName(`${"x".repeat(300)}.pdf`).length).toBe(120);
    expect(cleanMime("IMAGE/JPEG; charset=x")).toBe("image/jpeg");
    expect(cleanMime("<script>")).toBe("application/octet-stream");
  });

  it("formats sizes and progress", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
    expect(percent(50, 200)).toBe(25);
    expect(percent(300, 200)).toBe(100);
    expect(percent(1, 0)).toBe(0);
  });
});
