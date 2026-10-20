import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatPage } from "@/components/chat/chat-page";
import type { UiMessage } from "@/components/chat/use-chat";
import { getConversation } from "@/lib/agent/chat";
import { PROPOSAL_LABEL } from "@/lib/agent/proposals";
import { suggestedPrompts } from "@/lib/agent/suggestions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c, s, suggestions] = await Promise.all([getConversation(user.id, id), getSettings(user.id), suggestedPrompts(user.id)]);
  if (!c) notFound();
  const props = new Map(c.proposals.map((p) => [p.id, p]));
  const live = new Set(c.memoryIds);
  const initial: UiMessage[] = c.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    tools: (m.meta.toolsUsed ?? []).map((t) => ({ tool: t, label: "" })),
    citations: m.meta.citations,
    generalKnowledge: m.meta.generalKnowledge,
    attachment: m.meta.attachment ? { name: m.meta.attachment.name } : null,
    runId: m.meta.runId,
    memories: m.meta.memories?.map((x) => ({ ...x, undone: x.status === "saved" && !live.has(x.id) })),
    notices: m.meta.notices,
    proposals: (m.meta.proposalIds ?? [])
      .map((pid) => props.get(pid))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, kind: p.kind, label: PROPOSAL_LABEL[p.kind], summary: p.summary, status: p.status })),
  }));
  return <ChatPage conversationId={id} initial={initial} suggestions={suggestions} agentName={s.agent.name} />;
}
