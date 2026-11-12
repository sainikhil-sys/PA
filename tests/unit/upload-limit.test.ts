import { beforeEach, describe, expect, it, vi } from "vitest";

/** uploads.maxMb: read by chat attachments, Knowledge uploads and voice recordings. */
const state = vi.hoisted(() => ({ maxMb: 4 as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/store", () => ({ getConfigValue: async (key: string) => (key === "uploads.maxMb" ? state.maxMb : undefined) }));
vi.mock("@/lib/ai/gate", () => ({ capabilityOffResponse: async () => null }));
vi.mock("@/lib/admin/restrictions", () => ({ restrictedResponse: async () => null }));
vi.mock("@/lib/auth/api", () => ({ apiGuard: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/env", () => ({ env: () => ({ STT_BASE_URL: "https://stt.invalid" }) }));
vi.mock("@/lib/knowledge/ingest", () => ({ ensureSource: async () => ({ id: "s" }), refreshSourceCount: async () => {}, upsertItem: async () => ({}) }));
vi.mock("@/lib/knowledge/extract", () => ({
  detectKind: () => "pdf",
  extractText: async () => "text",
  looksBinary: () => false,
}));

const uploads = await import("@/lib/config/uploads");
const MB = 1024 * 1024;

function upload(url: string, size: number, name = "a.pdf", type = "application/pdf", field = "file") {
  const form = new FormData();
  form.set(field, new File([new Uint8Array(size)], name, { type }));
  return new Request(url, { method: "POST", body: form });
}

beforeEach(() => {
  state.maxMb = 4;
});

describe("upload limit helpers", () => {
  it("turns the setting into bytes, clamped to 1..4 MB", () => {
    expect(uploads.uploadLimitBytes(2)).toBe(2 * MB);
    expect(uploads.uploadLimitBytes(9)).toBe(4 * MB);
    expect(uploads.uploadLimitBytes(0)).toBe(1 * MB);
    expect(uploads.uploadLimitBytes(undefined)).toBe(4 * MB);
    expect(uploads.uploadLimitBytes("3")).toBe(4 * MB);
  });
  it("never raises a route's own smaller limit", () => {
    expect(uploads.cappedLimit(1 * MB, 4)).toBe(1 * MB);
    expect(uploads.cappedLimit(3 * MB, 2)).toBe(2 * MB);
  });
  it("says the limit plainly", () => {
    expect(uploads.fileTooLargeMessage(2 * MB)).toBe("Files up to 2 MB, please.");
    expect(uploads.formatLimit(512 * 1024)).toBe("512 KB");
  });
});

describe("routes read uploads.maxMb", () => {
  it("Knowledge uploads: a 1.5 MB file is refused at 1 MB and accepted at 2 MB", async () => {
    const { POST } = await import("@/app/api/knowledge/upload/route");
    state.maxMb = 1;
    const res = await POST(upload("https://app.invalid/api/knowledge/upload", 1.5 * MB));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("Files up to 1 MB, please.");
    state.maxMb = 2;
    expect((await POST(upload("https://app.invalid/api/knowledge/upload", 1.5 * MB))).status).toBe(200);
  });
  it("chat attachments: documents follow the setting", async () => {
    const { POST } = await import("@/app/api/chat/attach/route");
    state.maxMb = 1;
    const res = await POST(upload("https://app.invalid/api/chat/attach", 1.5 * MB));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("Files up to 1 MB, please.");
    state.maxMb = 2;
    expect((await POST(upload("https://app.invalid/api/chat/attach", 1.5 * MB))).status).toBe(200);
  });
  it("voice recordings: capped by the setting below their own 3 MB limit", async () => {
    const { POST } = await import("@/app/api/voice/transcribe/route");
    state.maxMb = 1;
    const res = await POST(upload("https://app.invalid/api/voice/transcribe", 1.5 * MB, "a.webm", "audio/webm", "audio"));
    expect(res.status).toBe(413);
  });
});
