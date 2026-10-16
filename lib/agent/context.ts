import "server-only";
import type { Citation, User } from "@/lib/db/schema";
import { getBriefingForDate } from "@/lib/db/queries/briefings";
import { listImportantEmails } from "@/lib/db/queries/emails";
import { getSettings } from "@/lib/db/queries/settings";
import { listTasks } from "@/lib/db/queries/tasks";
import { listEvents } from "@/lib/integrations/calendar";
import { searchKnowledge } from "@/lib/knowledge/search";
import { listNews } from "@/lib/news/fetch";
import { stripInvisible } from "@/lib/security/sanitize";
import { formatTime, localDate, localDayBounds } from "@/lib/time";
import type { Trace } from "@/lib/trace";
import type { SourceId } from "./plan";

export type GatheredContext = {
  blocks: string[];
  citations: Citation[];
  toolsUsed: string[];
  /** Short, content-free labels for the "Used:" chips. */
  toolLabels: { tool: string; label: string }[];
};

const TOOL_NAME: Record<SourceId, string> = { gmail: "Gmail", calendar: "Calendar", tasks: "Tasks", knowledge: "Knowledge base", news: "News", briefing: "Briefing" };

/** Neutralise attempts to close our data tags from inside untrusted text. */
function safe(text: string): string {
  return stripInvisible(text).replace(/<\/?\s*source_content[^>]*>/gi, "[tag removed]");
}

/**
 * Read-only data gathering for the agent. Everything third-party (email
 * summaries, news, documents) is wrapped in <source_content> as untrusted data.
 */
export async function gatherContext(user: User, sources: SourceId[], query: string, trace: Trace, onTool?: (tool: string, label: string) => void): Promise<GatheredContext> {
  const s = await getSettings(user.id);
  const tz = s.timezone;
  const out: GatheredContext = { blocks: [], citations: [], toolsUsed: [], toolLabels: [] };
  const used = (source: SourceId, label: string) => {
    out.toolsUsed.push(TOOL_NAME[source]);
    out.toolLabels.push({ tool: TOOL_NAME[source], label });
    onTool?.(TOOL_NAME[source], label);
  };
  const cite = (c: Omit<Citation, "n">) => {
    const n = out.citations.length + 1;
    out.citations.push({ n, ...c });
    return n;
  };

  for (const source of sources) {
    try {
      if (source === "gmail") {
        const emails = await trace.span("gmail", "Reading important mail", () => listImportantEmails(user.id, 8), (r) => ({ label: `Read ${r.length} important emails`, meta: { count: r.length } }));
        used("gmail", `${emails.length} important emails`);
        if (emails.length) {
          out.blocks.push(
            `Important emails (summaries only):\n<source_content>\n${emails
              .map((e) => `[${cite({ title: `${e.fromName ?? e.fromEmail}: ${e.subject}`, url: `/inbox?email=${e.id}`, sourceType: "gmail" })}] ${e.category} from ${safe(e.fromName ?? e.fromEmail ?? "unknown")} — "${safe(e.subject)}": ${safe(e.summary ?? e.snippet)}${e.draftId ? " (draft exists)" : ""}`)
              .join("\n")}\n</source_content>`,
          );
        } else out.blocks.push("Important emails: none.");
      }
      if (source === "calendar") {
        const today = localDayBounds(tz, 0);
        const tomorrow = localDayBounds(tz, 1);
        const events = await trace.span("calendar", "Checking your calendar", () => listEvents(user.id, today.start, tomorrow.end), (r) => ({ label: `Found ${r.length} events today and tomorrow`, meta: { count: r.length } }));
        used("calendar", `${events.length} events`);
        out.blocks.push(
          events.length
            ? `Calendar (today ${today.date}, tomorrow ${tomorrow.date}):\n<source_content>\n${events
                .map((e) => `- ${e.start.slice(0, 10)} ${e.allDay ? "all day" : formatTime(e.start, tz)}: ${safe(e.title)}${e.attendees.length ? ` (${e.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email).slice(0, 5).join(", ")})` : ""}`)
                .join("\n")}\n</source_content>`
            : "Calendar: no events today or tomorrow.",
        );
      }
      if (source === "tasks") {
        const tasks = await trace.span("tasks", "Reviewing open tasks", () => listTasks(user.id, { status: ["todo", "in_progress", "needs_review"], limit: 20 }), (r) => ({ label: `Reviewed ${r.length} open tasks`, meta: { count: r.length } }));
        used("tasks", `${tasks.length} open tasks`);
        const today = localDate(tz);
        out.blocks.push(
          tasks.length
            ? `Open tasks (today is ${today}):\n${tasks.map((t) => `- [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate}${t.dueDate < today ? ", OVERDUE" : ""})` : ""}${t.assignee !== "me" ? ` — assigned to ${t.assignee}` : ""}`).join("\n")}`
            : "Open tasks: none.",
        );
      }
      if (source === "knowledge") {
        const { results } = await trace.span("knowledge", "Searching your knowledge base", () => searchKnowledge(user.id, query || "overview", { limit: 6 }), (r) => ({ label: `Knowledge base returned ${r.results.length} sources`, meta: { count: r.results.length, top: r.results[0]?.score ?? 0 } }));
        used("knowledge", `${results.length} sources`);
        out.blocks.push(
          results.length
            ? `Knowledge base excerpts:\n<source_content>\n${results.map((r) => `[${cite({ title: r.title, url: r.url ?? `/knowledge?item=${r.itemId}`, sourceType: r.sourceType, itemId: r.itemId })}] ${safe(r.title)}: ${safe(r.content.slice(0, 900))}`).join("\n\n")}\n</source_content>`
            : "Knowledge base: no matching documents.",
        );
      }
      if (source === "news") {
        const news = await trace.span("news", "Checking the news", () => listNews(user.id, s.newsTopics, 8), (r) => ({ label: `Read ${r.length} headlines`, meta: { count: r.length } }));
        used("news", `${news.length} headlines`);
        if (news.length) {
          out.blocks.push(`Recent headlines:\n<source_content>\n${news.map((n) => `[${cite({ title: `${n.sourceName}: ${n.title}`, url: n.url, sourceType: "news" })}] ${safe(n.title)} — ${safe(n.summary)}`).join("\n")}\n</source_content>`);
        }
      }
      if (source === "briefing") {
        const b = await getBriefingForDate(user.id, localDate(tz));
        used("briefing", b ? "today's briefing" : "no briefing yet");
        if (b) out.blocks.push(`Today's briefing: ${safe(b.content.headline)} ${safe(b.content.summary)}`);
      }
    } catch {
      out.blocks.push(`${TOOL_NAME[source]}: unavailable right now (not connected or temporarily failing).`);
      await trace.event(source, `${TOOL_NAME[source]} unavailable`, "error");
    }
  }
  return out;
}
