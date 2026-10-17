// Runs every automation action type through the real engine (and real AI) on the TEST account
// (dev@cowork.test), one automation per action, prints the result, then deletes what it created.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { eq, and, inArray, like } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db");
const { queueRun } = await import("../lib/automations/events");
const { runAutomation } = await import("../lib/automations/engine");
type Action = import("../lib/db/schema").AutomationAction;

const [user] = await db().select().from(schema.users).where(eq(schema.users.email, "dev@cowork.test")).limit(1);
if (!user) throw new Error("test account missing");
const only = process.argv.slice(2);

const cases: [string, Action][] = [
  ["create_task", { type: "create_task", title: "VERIFY task" }],
  ["add_note", { type: "add_note", title: "VERIFY note", content: "Hello from the action check." }],
  ["notify", { type: "notify", title: "VERIFY notify", body: "Check" }],
  ["call_agent", { type: "call_agent", prompt: "In one sentence: what is a good habit for focused work?" }],
  ["create_linkedin_draft", { type: "create_linkedin_draft", prompt: "VERIFY why small daily wins compound" }],
  ["generate_briefing", { type: "generate_briefing" }],
  ["call_webhook", { type: "call_webhook", url: "https://postman-echo.com/post" }],
  ["create_draft (no email)", { type: "create_draft" }],
  ...((["write_email", "create_youtube_package"] as const).map((t) =>
    t === "write_email"
      ? (["write_email", { type: "write_email", to: "someone@example.com", instructions: "VERIFY ask to reschedule our Friday call to Monday" }] as [string, Action])
      : (["create_youtube_package", { type: "create_youtube_package", topic: "VERIFY 5 study habits that actually work" }] as [string, Action]),
  ) as [string, Action][]),
];

const made: string[] = [];
for (const [name, action] of cases) {
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  const [a] = await db()
    .insert(schema.automations)
    .values({ userId: user.id, name: `VERIFY ${name}`, enabled: true, trigger: { type: "schedule", cron: "0 9 * * *", text: "daily" }, conditions: [], actions: [action], permissions: [action.type] })
    .returning();
  made.push(a!.id);
  const runId = await queueRun(a!, `verify:${name}:${Date.now()}`, { type: "manual", title: "Manual check" }, false);
  const t = Date.now();
  try {
    await runAutomation(runId!, 3, 3); // last attempt: failures are reported, not retried
  } catch {}
  const [run] = await db().select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId!)).limit(1);
  const step = run?.steps?.[0];
  console.log(`${run?.status === "succeeded" ? "OK  " : "FAIL"} ${name.padEnd(24)} ${String(Date.now() - t).padStart(6)}ms  ${(step?.message ?? run?.error ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
}

// Clean up everything the checks created.
await db().delete(schema.automations).where(inArray(schema.automations.id, made));
await db().delete(schema.tasks).where(and(eq(schema.tasks.userId, user.id), like(schema.tasks.title, "VERIFY%")));
await db().delete(schema.knowledgeItems).where(and(eq(schema.knowledgeItems.userId, user.id), like(schema.knowledgeItems.title, "VERIFY%")));
await db().delete(schema.notifications).where(and(eq(schema.notifications.userId, user.id), like(schema.notifications.title, "VERIFY%")));
await db().delete(schema.contentDrafts).where(eq(schema.contentDrafts.userId, user.id));
await db().delete(schema.briefings).where(eq(schema.briefings.userId, user.id));
console.log("cleaned up");
process.exit(0);
