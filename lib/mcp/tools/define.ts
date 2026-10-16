import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { logActivity } from "@/lib/db/queries/activity";
import { TaskError } from "@/lib/db/queries/tasks";
import { errMessage } from "@/lib/log";
import { hasScope, type Scope } from "@/lib/security/scopes";
import { Trace } from "@/lib/trace";
import { authExtra, type PaAuthExtra } from "../auth";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export type ToolDef<S extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  readOnly: boolean;
  input: S;
  /** Content-free description of the input for the activity log. */
  summarize: (args: z.infer<S>) => string;
  run: (args: z.infer<S>, ctx: PaAuthExtra) => Promise<unknown>;
};

function text(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Register a tool with scope enforcement, zod validation (by the SDK), uniform
 * error handling, and an activity_log entry for every call.
 */
export function registerTool<S extends z.ZodObject>(server: McpServer, def: ToolDef<S>) {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: { readOnlyHint: def.readOnly, destructiveHint: false, openWorldHint: false },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (args: any, extra: any) => {
      const auth = authExtra(extra?.http?.authInfo);
      if (!auth) return text("Unauthorized", true);
      const granted: string[] = extra?.http?.authInfo?.scopes ?? [];
      let summary = "";
      try {
        summary = def.summarize(args);
      } catch {
        summary = "";
      }
      if (!hasScope(granted, def.scope)) {
        await logActivity({ userId: auth.userId, actor: "claude", tool: def.name, inputSummary: summary, outcome: "denied", detail: `missing scope ${def.scope}`, tokenId: auth.tokenId });
        return text(`This token lacks the "${def.scope}" scope. Ask the owner to grant it in PA > Connect Claude.`, true);
      }
      const trace = new Trace(auth.userId, "mcp", "claude");
      await trace.event("input:claude", `Claude called ${def.name}`);
      try {
        const result = await trace.span(`tool:${def.name}`, `Claude: ${def.title}`, () => def.run(args, auth));
        await logActivity({ userId: auth.userId, actor: "claude", tool: def.name, inputSummary: summary, outcome: "success", tokenId: auth.tokenId });
        return text(result);
      } catch (err) {
        const message = err instanceof TaskError || err instanceof z.ZodError ? err.message : "Internal error";
        await logActivity({ userId: auth.userId, actor: "claude", tool: def.name, inputSummary: summary, outcome: "error", detail: errMessage(err), tokenId: auth.tokenId });
        return text(message, true);
      }
    }) as never,
  );
}
