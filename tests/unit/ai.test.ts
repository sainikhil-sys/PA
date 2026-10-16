import { describe, expect, it, vi } from "vitest";
import { briefingSchema, emailClassificationSchema } from "@/lib/agents/schemas";
import { applyCapabilities, heuristicPlan } from "@/lib/agent/plan";
import { extractJson, generateStructured, StructuredOutputError } from "@/lib/ai/structured";

describe("extractJson", () => {
  it("handles fences, chatter and nested braces in strings", () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"t":"a } b","n":{"x":[1,2]}} thanks')).toEqual({ t: "a } b", n: { x: [1, 2] } });
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("generateStructured (retry-on-invalid)", () => {
  it("retries with validation feedback and succeeds", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"category":"maybe","summary":"x","priority":3,"action_required":false}')
      .mockResolvedValueOnce('{"category":"reply needed","summary":"Asks for review","priority":"3","action_required":"false"}');
    const { data, attempts } = await generateStructured({ schema: emailClassificationSchema, prompt: "p", generate });
    expect(attempts).toBe(3);
    expect(data).toEqual({ category: "REPLY_NEEDED", summary: "Asks for review", priority: 3, action_required: false });
    expect(generate.mock.calls[2]![0].at(-1).content).toMatch(/did not match/);
  });
  it("gives up after 2 retries", async () => {
    const generate = vi.fn().mockResolvedValue("{}");
    await expect(generateStructured({ schema: briefingSchema, prompt: "p", generate })).rejects.toBeInstanceOf(StructuredOutputError);
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe("email classification schema", () => {
  it("does not coerce the string 'false' to true", () => {
    const r = emailClassificationSchema.parse({ category: "FYI", summary: "s", priority: 1, action_required: "false" });
    expect(r.action_required).toBe(false);
  });
  it("rejects unknown categories", () => {
    expect(emailClassificationSchema.safeParse({ category: "PROMO", summary: "s", priority: 1, action_required: false }).success).toBe(false);
  });
});

describe("agent planner fallback", () => {
  it("routes common requests to read-only sources", () => {
    expect(heuristicPlan("what did I miss today?").sources).toEqual(expect.arrayContaining(["gmail", "calendar", "tasks"]));
    expect(heuristicPlan("what do my notes say about pricing").sources).toContain("knowledge");
  });
  it("turns explicit requests into proposals, never executions", () => {
    expect(heuristicPlan("add a task to call Ravi tomorrow at 5").actions[0]).toMatchObject({ kind: "create_task", title: "call Ravi tomorrow at 5" });
    expect(heuristicPlan("draft a reply to the last email from Anita").actions[0]).toMatchObject({ kind: "create_draft", email_hint: "Anita" });
    expect(heuristicPlan("run my morning automation").actions[0]).toMatchObject({ kind: "run_automation", automation_name: "morning" });
    expect(heuristicPlan("how are you").actions).toEqual([]);
  });
  it("respects capability switches", () => {
    const p = heuristicPlan("draft a reply to the last email from Anita");
    const off = applyCapabilities(p, { readEmail: false, createDrafts: true, manageTasks: true, runAutomations: true, searchKnowledge: true });
    expect(off.sources).not.toContain("gmail");
    expect(off.actions).toEqual([]);
  });
});
