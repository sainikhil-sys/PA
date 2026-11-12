import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase I, AI control: capability switches refused on the server (403 feature_off), the per-person
 * daily token limit (maths, router refusal, chat refusal), and user-facing copy that never names a
 * provider, a model, an internal setting or the console. The database is a small fake: selects
 * answer from a queue, writes are recorded.
 */
const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  selects: [] as unknown[][],
  writes: [] as { op: string; values?: unknown }[],
  role: null as string | null,
  ownKey: null as null | Record<string, unknown>,
  generated: 0,
}));

function chain(result: () => unknown, call?: { op: string; values?: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin", "set", "onConflictDoNothing", "onConflictDoUpdate"]) c[m] = () => c;
  c.values = (v: unknown) => {
    if (call) call.values = v;
    return c;
  };
  c.returning = () => Promise.resolve([{ id: "row1" }]);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}
const write = (op: string) => () => {
  const call = { op };
  state.writes.push(call);
  return chain(() => [], call);
};
const fakeDb = {
  select: () => chain(() => state.selects.shift() ?? []),
  insert: write("insert"),
  update: write("update"),
  delete: write("delete"),
  execute: async () => [],
  query: { conversations: { findFirst: async () => null }, messages: { findFirst: async () => null } },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: () => fakeDb, schema: await import("@/lib/db/schema"), rowsOf: (r: unknown) => r }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/config/store", async () => {
  const reg = await import("@/lib/config/registry");
  const values = () => reg.resolveValues([...state.values].map(([key, value]) => ({ key, value })));
  return { getConfigValue: async (key: string) => values().get(key) };
});
vi.mock("@/lib/auth/session", () => ({ getOwner: async () => null, getSession: async () => null }));
vi.mock("@/lib/admin/roles", () => ({ getAdminRole: async () => state.role }));
// An owner calls every route: the switches are product switches, so a role changes nothing.
vi.mock("@/lib/auth/api", () => ({ apiGuard: async () => ({ user: { id: USER, email: "owner@example.com" } }) }));
vi.mock("@/lib/admin/restrictions", () => ({
  restrictedResponse: async () => null,
  isRestricted: async () => false,
  AI_RESTRICTED_MESSAGE: "restricted",
  RESTRICTED_MESSAGE: "restricted",
}));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/env", () => ({
  env: () => ({ STT_BASE_URL: "https://stt.invalid", TTS_BASE_URL: "https://tts.invalid", AI_TIMEOUT_MS: 5000 }),
  appUrl: () => "https://app.invalid",
  isOnVercel: () => false,
}));
// The AI SDK and providers: one server provider; generateText counts calls.
vi.mock("ai", () => ({
  generateText: async () => {
    state.generated++;
    return { text: "ok", usage: { inputTokens: 3, outputTokens: 2 } };
  },
  streamText: () => ({ textStream: (async function* () {})() }),
  embed: async () => ({ embedding: [], usage: { tokens: 0 } }),
}));
vi.mock("@/lib/ai/providers", () => ({
  configuredProviders: () => [{ name: "primary", baseURL: "https://primary.invalid/v1", apiKey: "k", fastModel: "fast-1", smartModel: "smart-1" }],
  modelFor: (p: { name: string; fastModel: string }) => ({ id: p.fastModel, model: { provider: p.name } }),
  providerClient: () => ({}),
}));
vi.mock("@/lib/ai/user-provider", () => ({ userProvider: async () => state.ownKey }));
// The chat pipeline's heavy dependencies: refused turns return before any of them is used.
vi.mock("@/lib/agent/context", () => ({}));
vi.mock("@/lib/agent/memory", () => ({}));
vi.mock("@/lib/agent/plan", () => ({}));
vi.mock("@/lib/agent/proposals", () => ({}));
vi.mock("@/lib/knowledge/rank", () => ({}));
vi.mock("@/lib/trace", () => ({}));
vi.mock("@/lib/db/queries/settings", () => ({}));
vi.mock("@/lib/knowledge/ingest", () => ({ ensureSource: async () => ({}), refreshSourceCount: async () => {}, upsertItem: async () => ({}) }));

const USER = "7d3c3c0e-2b4c-4c1f-9a51-6c3d2f1f9e11";
const limits = await import("@/lib/ai/limits");
const messages = await import("@/lib/ai/messages");
const gate = await import("@/lib/ai/gate");
const router = await import("@/lib/ai/router");
const chat = await import("@/lib/agent/chat");

beforeEach(() => {
  state.values = new Map();
  state.selects = [];
  state.writes = [];
  state.role = "owner";
  state.ownKey = null;
  state.generated = 0;
});

const off = (...caps: string[]) => caps.forEach((c) => state.values.set(`ai.${c}`, false));
const usedToday = (n: number) => state.selects.push([{ n: String(n) }]);

async function expectFeatureOff(res: Response, capability: keyof typeof messages.AI_FEATURE_OFF) {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error: string; code: string; message: string };
  expect(body).toEqual({ error: messages.AI_FEATURE_OFF[capability], code: "feature_off", message: messages.AI_FEATURE_OFF[capability] });
}

function upload(url: string, file = new File(["hello"], "a.txt", { type: "text/plain" }), field = "file") {
  const form = new FormData();
  form.set(field, file);
  return new Request(url, { method: "POST", body: form });
}

describe("daily limit maths", () => {
  it("null, 0 and nonsense mean no limit", () => {
    for (const l of [null, undefined, 0, -5, Number.NaN, "1000"]) {
      expect(limits.effectiveDailyLimit(l)).toBeNull();
      expect(limits.isOverDailyLimit(10_000_000, l)).toBe(false);
      expect(limits.remainingToday(10_000_000, l)).toBeNull();
    }
  });
  it("refuses at the limit, not before", () => {
    expect(limits.isOverDailyLimit(4999, 5000)).toBe(false);
    expect(limits.isOverDailyLimit(5000, 5000)).toBe(true);
    expect(limits.isOverDailyLimit(5001, 5000)).toBe(true);
    expect(limits.remainingToday(1200, 5000)).toBe(3800);
    expect(limits.remainingToday(9000, 5000)).toBe(0);
  });
  it("days start at midnight UTC", () => {
    expect(limits.utcDayStart(new Date("2026-11-12T23:59:59+05:30")).toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(limits.utcDayStart(new Date("2026-11-13T02:00:00+05:30")).toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(limits.utcDayStart(new Date("2026-11-13T00:00:00Z")).toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
});

describe("dailyLimitReached", () => {
  it("doesn't read usage when there is no limit", async () => {
    usedToday(10_000_000);
    expect(await gate.dailyLimitReached(USER)).toBe(false);
    expect(state.selects).toHaveLength(1);
  });
  it("compares today's server tokens with the limit", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 5000);
    usedToday(4999);
    expect(await gate.dailyLimitReached(USER)).toBe(false);
    usedToday(5000);
    expect(await gate.dailyLimitReached(USER)).toBe(true);
  });
  it("never limits calls without a person", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(999_999);
    expect(await gate.dailyLimitReached(null)).toBe(false);
    expect(await gate.dailyLimitReached(undefined)).toBe(false);
  });
  it("route helper answers 429 with the plain message", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(1000);
    const res = (await gate.dailyLimitResponse(USER))!;
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: messages.AI_DAILY_LIMIT, code: "ai_daily_limit", message: messages.AI_DAILY_LIMIT });
  });
});

describe("the AI router enforces the daily limit", () => {
  const call = (userId: string | null) => router.generate({ kind: "test", userId, tier: "fast", system: "s", prompt: "p" });

  it("refuses over the limit with AiLimitError and calls no provider", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(1500);
    const err = await call(USER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(gate.AiLimitError);
    expect((err as Error).message).toBe(messages.AI_DAILY_LIMIT);
    expect(state.generated).toBe(0);
  });
  it("lets the call through under the limit", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(10);
    const r = await call(USER);
    expect(r.provider).toBe("primary");
    expect(state.generated).toBe(1);
  });
  it("over the limit, a person's own key still works and the server's is not used", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(1500);
    state.ownKey = { name: "own", baseURL: "https://own.invalid/v1", apiKey: "x", fastModel: "own-fast", smartModel: "own-smart" };
    const r = await call(USER);
    expect(r.provider).toBe("own");
    const run = state.writes.find((w) => w.op === "insert")?.values as { keySource: string };
    expect(run.keySource).toBe("own");
  });
  it("background calls without a person are not limited", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(1_000_000);
    await expect(call(null)).resolves.toMatchObject({ provider: "primary" });
  });
});

describe("capability switches are refused by the API (403 feature_off), admins included", () => {
  it("chat", async () => {
    off("chat");
    const { POST } = await import("@/app/api/chat/route");
    await expectFeatureOff(await POST(new Request("https://app.invalid/api/chat", { method: "POST", body: JSON.stringify({ message: "hi" }) })), "chat");
  });
  it("spoken chat turns need voice", async () => {
    off("voice");
    const { POST } = await import("@/app/api/chat/route");
    await expectFeatureOff(await POST(new Request("https://app.invalid/api/chat", { method: "POST", body: JSON.stringify({ message: "hi", trigger: "voice" }) })), "voice");
  });
  it("chat turns with a document need documents", async () => {
    off("documents");
    const { POST } = await import("@/app/api/chat/route");
    const body = { message: "what does it say", attachment: { name: "a.txt", text: "x", kind: "txt" } };
    await expectFeatureOff(await POST(new Request("https://app.invalid/api/chat", { method: "POST", body: JSON.stringify(body) })), "documents");
  });
  it("voice transcription and speech", async () => {
    off("voice");
    const stt = await import("@/app/api/voice/transcribe/route");
    await expectFeatureOff(await stt.POST(new Request("https://app.invalid/api/voice/transcribe", { method: "POST", body: new FormData() })), "voice");
    const tts = await import("@/app/api/voice/speak/route");
    await expectFeatureOff(await tts.POST(new Request("https://app.invalid/api/voice/speak", { method: "POST", body: JSON.stringify({ text: "hi" }) })), "voice");
  });
  it("chat attachments and Knowledge uploads", async () => {
    off("documents");
    const attach = await import("@/app/api/chat/attach/route");
    await expectFeatureOff(await attach.POST(upload("https://app.invalid/api/chat/attach")), "documents");
    const knowledge = await import("@/app/api/knowledge/upload/route");
    await expectFeatureOff(await knowledge.POST(upload("https://app.invalid/api/knowledge/upload")), "documents");
  });
  it("another switch doesn't block a route", async () => {
    off("chat", "voice", "research", "automations");
    const attach = await import("@/app/api/chat/attach/route");
    const res = await attach.POST(upload("https://app.invalid/api/chat/attach"));
    expect(res.status).toBe(200);
  });
  it("server actions get the plain message", async () => {
    off("automations");
    await expect(gate.assertCapability("automations")).rejects.toThrow(messages.AI_FEATURE_OFF.automations);
    await expect(gate.assertCapability("chat")).resolves.toBeUndefined();
  });
  it("only an explicit false turns a capability off", async () => {
    expect(await gate.capabilityOn("chat")).toBe(true);
    state.values.set("ai.chat", "no");
    expect(await gate.capabilityOn("chat")).toBe(true);
  });
});

describe("chat turns refuse inside the pipeline too", () => {
  async function turn(opts: Partial<Parameters<typeof chat.runChatTurn>[0]> = {}) {
    const events = [];
    for await (const e of chat.runChatTurn({ user: { id: USER } as never, message: "hi", trigger: "text", ...opts })) events.push(e);
    return events;
  }
  it("chat off: one error event, nothing saved", async () => {
    off("chat");
    expect(await turn()).toEqual([{ type: "error", message: messages.AI_FEATURE_OFF.chat }]);
    expect(state.writes).toEqual([]);
  });
  it("documents off with an attachment or a quick action", async () => {
    off("documents");
    expect(await turn({ attachment: { name: "a.txt", text: "x", kind: "txt" } })).toEqual([{ type: "error", message: messages.AI_FEATURE_OFF.documents }]);
    expect(await turn({ attachment: { name: "a.txt", text: "x", kind: "txt" }, transform: { kind: "summarize" } })).toEqual([{ type: "error", message: messages.AI_FEATURE_OFF.documents }]);
  });
  it("voice off for spoken turns", async () => {
    off("voice");
    expect(await turn({ trigger: "voice" })).toEqual([{ type: "error", message: messages.AI_FEATURE_OFF.voice }]);
  });
  it("daily limit reached without an own key: the limit message, nothing saved", async () => {
    state.values.set("ai.dailyTokenLimitPerUser", 2000);
    usedToday(2500);
    expect(await turn()).toEqual([{ type: "error", message: messages.AI_DAILY_LIMIT }]);
    expect(state.writes).toEqual([]);
  });
  it("the capabilities a turn needs", () => {
    expect(chat.turnCapabilities({ trigger: "text" })).toEqual(["chat"]);
    expect(chat.turnCapabilities({ trigger: "voice", attachment: {} })).toEqual(["chat", "voice", "documents"]);
  });
});

describe("user-facing AI copy", () => {
  const BANNED = /openai|anthropic|claude|gpt|groq|together|gemini|llama|mistral|ollama|deepseek|qwen|whisper|kokoro|tavily|provider|model|admin|console|AI_[A-Z]|_MODEL|_KEY|—|–/i;
  const copy = [messages.AI_UNAVAILABLE, messages.AI_NO_RESPONSE, messages.AI_DAILY_LIMIT, ...Object.values(messages.AI_FEATURE_OFF)];

  it("never names a provider, a model, a setting or the console", () => {
    for (const m of copy) expect(m, m).not.toMatch(BANNED);
  });
  it("covers every capability with a plain sentence", () => {
    expect(Object.keys(messages.AI_FEATURE_OFF).sort()).toEqual([...messages.AI_CAPABILITIES].sort());
    for (const m of copy) expect(m).toMatch(/^[A-Z].*\.$/);
  });
  it("refusals sent by routes carry only that copy", async () => {
    off("chat", "voice", "documents");
    state.values.set("ai.dailyTokenLimitPerUser", 1000);
    usedToday(5000);
    const bodies = await Promise.all([gate.capabilityOffResponse("chat"), gate.capabilityOffResponse("voice"), gate.capabilityOffResponse("documents"), gate.dailyLimitResponse(USER)].map(async (r) => (await r)!.json() as Promise<Record<string, string>>));
    // The machine code (feature_off, ai_daily_limit) is not copy; the text people see is error and message.
    for (const b of bodies) {
      expect(Object.keys(b).sort()).toEqual(["code", "error", "message"]);
      expect(b.error).not.toMatch(BANNED);
      expect(b.message).not.toMatch(BANNED);
    }
  });
  it("a missing server provider shows the plain copy in the email action", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("app/actions/email.ts", "utf8");
    expect(src).toMatch(/NoProviderError\) throw new UserFacingError\(AI_UNAVAILABLE\)/);
  });
});

describe("automations that use AI", () => {
  it("are recognised by their actions", async () => {
    const { usesAi } = await import("@/lib/automations/templates");
    expect(usesAi([{ type: "create_task" }, { type: "notify" }])).toBe(false);
    expect(usesAi([{ type: "notify" }, { type: "call_agent" }])).toBe(true);
    expect(usesAi([{ type: "generate_briefing" }])).toBe(true);
    expect(usesAi([])).toBe(false);
  });
});
