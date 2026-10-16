import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { saveNote, searchNotes } from "@/lib/db/queries/notes";
import { truncate } from "@/lib/security/sanitize";
import { registerTool } from "./define";

export function registerMemoryTools(server: McpServer) {
  registerTool(server, {
    name: "search_memory",
    title: "Search memory",
    description: "Search the owner's saved notes (semantic search when embeddings are configured, keyword otherwise).",
    scope: "memory:read",
    readOnly: true,
    input: z.object({ query: z.string().trim().min(1).max(500) }),
    summarize: (a) => `query=${a.query.length} chars`,
    run: async (a, ctx) => {
      const { mode, results } = await searchNotes(ctx.userId, a.query, 8);
      return {
        mode,
        results: results.map((n) => ({
          id: n.id,
          title: n.title,
          excerpt: truncate(n.content, 600),
          source: n.source,
          score: Number(n.score?.toFixed?.(3) ?? 0),
          created_at: n.createdAt.toISOString(),
        })),
      };
    },
  });

  registerTool(server, {
    name: "save_note",
    title: "Save note",
    description: "Save a note to the owner's memory. It appears in the dashboard labelled as written by Claude.",
    scope: "memory:write",
    readOnly: false,
    input: z.object({
      title: z.string().trim().min(1).max(200),
      content: z.string().min(1).max(20_000),
    }),
    summarize: (a) => `title="${truncate(a.title, 60)}" content=${a.content.length} chars`,
    run: async (a, ctx) => {
      const note = await saveNote(ctx.userId, { title: a.title, content: a.content, source: "claude" });
      return { id: note.id, title: note.title, saved_at: note.createdAt.toISOString() };
    },
  });
}
