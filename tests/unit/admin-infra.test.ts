import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake secrets in the environment. None of them may appear in any probe output.
const b64url = (b: Buffer) => b.toString("base64url");
const FAKE = {
  DATABASE_URL: "postgres://cowork_owner:Sup3rS3cretDbPw@db.internal-fake.example:6543/postgres",
  DATABASE_URL_UNPOOLED: "postgres://cowork_owner:Sup3rS3cretDbPw@db.internal-fake.example:5432/postgres",
  RESEND_API_KEY: "re_FAKEresendKey_0123456789abcdef",
  AI_BASE_URL: "https://ai-gateway.fake-host.example/v1",
  AI_API_KEY: "sk-fakeAiKey0123456789abcdefABCDEF",
  FAST_MODEL: "fake-fast-model-name",
  SMART_MODEL: "fake-smart-model-name",
  VAPID_PUBLIC_KEY: b64url(Buffer.concat([Buffer.from([4]), randomBytes(64)])),
  VAPID_PRIVATE_KEY: b64url(randomBytes(32)),
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "fake-project-id", client_email: "push@fake-project-id.iam.example", private_key: "-----BEGIN PRIVATE KEY-----\nFAKEPRIVATEKEYMATERIAL\n-----END PRIVATE KEY-----\n" }),
  AUTH_SECRET: "fake-auth-secret-0123456789abcdef0123456789",
  ENCRYPTION_KEY: "fake-encryption-key-0123456789abcdef",
  CRON_SECRET: "fake-cron-secret-0123456789",
};
Object.assign(process.env, FAKE);
const NEEDLES = ["Sup3rS3cretDbPw", "db.internal-fake.example", "postgres://", FAKE.RESEND_API_KEY, "ai-gateway.fake-host.example", FAKE.AI_API_KEY, "fake-fast-model", "fake-smart-model", FAKE.VAPID_PRIVATE_KEY, "FAKEPRIVATEKEYMATERIAL", "fake-project-id", FAKE.AUTH_SECRET, FAKE.ENCRYPTION_KEY, FAKE.CRON_SECRET];

const state = vi.hoisted(() => ({ mode: "ok" as "ok" | "throw" | "slow-db", rows: {} as Record<string, unknown> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  rowsOf: (r: unknown) => (Array.isArray(r) ? r : []),
  db: () => ({
    execute: async () => {
      if (state.mode === "throw") {
        // A driver error that carries the connection string, as some do.
        throw Object.assign(new Error(`connect ECONNREFUSED while using ${process.env.DATABASE_URL} key=${process.env.AI_API_KEY}`), { code: "ECONNREFUSED" });
      }
      return [state.rows];
    },
  }),
}));

const { runProbes, judgeAi, judgeJobs, judgeDatabase, scrubSecrets, probeReason } = await import("@/lib/admin/probes");
const utils = await import("@/lib/utils");

/**
 * The console component, compiled here because the test runner keeps JSX as is (tsconfig jsx: preserve).
 * Renders exactly what the Infrastructure page and the Overview show.
 */
function loadProbeComponents() {
  const file = path.resolve(__dirname, "../../components/admin/infra-probes.tsx");
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const deps: Record<string, unknown> = { "react/jsx-runtime": jsxRuntime, "@/lib/utils": utils, "next/link": { __esModule: true, default: (p: { href: string; children: React.ReactNode }) => React.createElement("a", { href: p.href }, p.children) } };
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", outputText)((id: string) => deps[id], mod, mod.exports);
  return mod.exports as { ProbeGrid: React.FC<{ probes: unknown[] }>; ProbeSummary: React.FC<{ probes: unknown[]; href?: string }> };
}
const { ProbeGrid, ProbeSummary } = loadProbeComponents();

function serialized(probes: Awaited<ReturnType<typeof runProbes>>) {
  return JSON.stringify(probes) + renderToStaticMarkup(React.createElement(React.Fragment, null, React.createElement(ProbeGrid, { probes }), React.createElement(ProbeSummary, { probes, href: "/console/system" })));
}

beforeEach(() => {
  state.mode = "ok";
  state.rows = { due: 2, running: 1, dead: 0, oldest_due_ms: 30_000, calls: 10, failed: 1, spans: 40, errors: 1 };
});

describe("infrastructure probes", () => {
  it("measures every probe with a status, a time and the measuring moment", async () => {
    const probes = await runProbes();
    expect(probes.map((p) => p.id)).toEqual(["database", "jobs", "ai", "traces", "mail", "push"]);
    for (const p of probes) {
      expect(["working", "degraded", "unavailable"]).toContain(p.status);
      expect(p.ms).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(Date.parse(p.measuredAt))).toBe(false);
    }
    expect(probes.find((p) => p.id === "mail")).toMatchObject({ status: "working", value: "Set up" });
    expect(probes.find((p) => p.id === "push")).toMatchObject({ status: "working" });
    expect(probes.find((p) => p.id === "ai")).toMatchObject({ status: "working", value: "10% failed" });
  });

  it("a probe that throws shows Unavailable with a short reason, never zero", async () => {
    state.mode = "throw";
    const probes = await runProbes();
    for (const id of ["database", "jobs", "ai", "traces"]) {
      const p = probes.find((x) => x.id === id)!;
      expect(p).toMatchObject({ status: "unavailable", value: "Unavailable", detail: "Couldn't connect to the database." });
      expect(p.value).not.toMatch(/^0/);
    }
  });

  it("no credential, key, connection string, host or model name in any output, working or failing", async () => {
    for (const mode of ["ok", "throw"] as const) {
      state.mode = mode;
      const out = serialized(await runProbes());
      expect(out).toContain("Measured at");
      expect(out).toContain("<li");
      for (const needle of NEEDLES) expect(out, `${mode}: ${needle}`).not.toContain(needle);
    }
  });

  it("probe reasons are fixed text whatever the error says", () => {
    const err = new Error(`password authentication failed: ${FAKE.DATABASE_URL}`);
    expect(probeReason(Object.assign(err, { code: "28P01" }))).toBe("The database refused the server's sign-in.");
    expect(probeReason(new Error(FAKE.DATABASE_URL))).toBe("The check failed. The server log has the details.");
  });
});

describe("probe judgements", () => {
  it("database: slow is degraded", () => {
    expect(judgeDatabase(90).status).toBe("working");
    expect(judgeDatabase(2000).status).toBe("degraded");
  });
  it("jobs: dead letters or a stale backlog are degraded", () => {
    expect(judgeJobs({ due: 0, running: 0, dead: 0, oldestDueMs: null }).status).toBe("working");
    expect(judgeJobs({ due: 3, running: 0, dead: 2, oldestDueMs: 1000 }).status).toBe("degraded");
    expect(judgeJobs({ due: 3, running: 0, dead: 0, oldestDueMs: 60 * 60_000 }).detail).toMatch(/dispatcher/);
  });
  it("AI: no provider is unavailable, no calls is not a zero error rate, all failing is unavailable", () => {
    expect(judgeAi({ providers: 0, calls: 5, failed: 0 }).status).toBe("unavailable");
    expect(judgeAi({ providers: 1, calls: 0, failed: 0 })).toMatchObject({ status: "working", value: "No calls" });
    expect(judgeAi({ providers: 1, calls: 10, failed: 5 }).status).toBe("degraded");
    expect(judgeAi({ providers: 1, calls: 4, failed: 4 }).status).toBe("unavailable");
  });
});

describe("scrubSecrets (stored job and automation errors)", () => {
  it("hides URL credentials, secret query parameters, bearer tokens, API keys and configured secrets", () => {
    const text = [
      `connect to ${FAKE.DATABASE_URL} failed`,
      "GET https://api.example.com/v1/items?token=abc123secret&page=2",
      "Authorization: Bearer eyJabc.def.ghi0123456789",
      "used key sk-live0123456789abcdefXYZ",
      `resend said ${FAKE.RESEND_API_KEY} is invalid`,
    ].join("\n");
    const out = scrubSecrets(text);
    for (const s of ["Sup3rS3cretDbPw", "abc123secret", "eyJabc.def.ghi0123456789", "sk-live0123456789abcdefXYZ", FAKE.RESEND_API_KEY]) expect(out).not.toContain(s);
    expect(out).toContain("page=2");
    expect(scrubSecrets(null)).toBe("");
  });
});
