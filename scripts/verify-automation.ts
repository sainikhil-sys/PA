// End-to-end automation check on the local TEST account only (dev@cowork.test):
// creates an automation, runs it through the real engine and AI, prints the result, then cleans up.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { eq, and, desc } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db");
const { queueRun } = await import("../lib/automations/events");
const { runAutomation } = await import("../lib/automations/engine");

const [user] = await db().select().from(schema.users).where(eq(schema.users.email, "dev@cowork.test")).limit(1);
if (!user) throw new Error("test account missing");

const [a] = await db()
  .insert(schema.automations)
  .values({
    userId: user.id,
    name: "E2E check",
    enabled: true,
    trigger: { type: "schedule", cron: "0 9 * * *", text: "every day at 9am" },
    conditions: [],
    actions: [
      { type: "call_agent", prompt: "In one sentence, suggest a focus for today." },
      { type: "add_note", title: "E2E check note", content: "{{agent_output}}" },
      { type: "create_task", title: "E2E check task" },
      { type: "notify", title: "E2E check", body: "{{agent_output}}" },
    ],
    permissions: ["call_agent", "add_note", "create_task", "notify"],
  })
  .returning();

const runId = await queueRun(a!, `e2e:${Date.now()}`, { type: "manual" }, false);
const t = Date.now();
await runAutomation(runId!, 1, 3);
const [run] = await db().select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId!)).limit(1);
console.log("run status:", run?.status, `${Date.now() - t}ms`, run?.error ?? "");
for (const s of run?.steps ?? []) console.log(" step", s.index, s.action, s.status, "-", String(s.message).slice(0, 140));
const notes = await db().select({ id: schema.notes.id, content: schema.notes.content }).from(schema.notes).where(and(eq(schema.notes.userId, user.id), eq(schema.notes.title, "E2E check note"))).orderBy(desc(schema.notes.createdAt)).limit(1);
console.log("note created:", Boolean(notes[0]), notes[0] ? `"${notes[0].content.slice(0, 120)}"` : "");
const tasks = await db().select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.userId, user.id), eq(schema.tasks.title, "E2E check task")));
console.log("task created:", tasks.length > 0);

// Clean up everything this check made.
await db().delete(schema.automations).where(eq(schema.automations.id, a!.id));
await db().delete(schema.notes).where(and(eq(schema.notes.userId, user.id), eq(schema.notes.title, "E2E check note")));
await db().delete(schema.tasks).where(and(eq(schema.tasks.userId, user.id), eq(schema.tasks.title, "E2E check task")));
await db().delete(schema.notifications).where(and(eq(schema.notifications.userId, user.id), eq(schema.notifications.title, "E2E check")));
console.log("cleaned up");
process.exit(0);
