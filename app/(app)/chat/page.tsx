import type { Metadata } from "next";
import { ChatPage } from "@/components/chat/chat-page";
import { suggestedPrompts } from "@/lib/agent/suggestions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function NewChatPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireOwner();
  const [s, suggestions, sp] = await Promise.all([getSettings(user.id), suggestedPrompts(user.id), searchParams]);
  return <ChatPage initial={[]} suggestions={suggestions} agentName={s.agent.name} prompt={sp.q?.slice(0, 2000)} />;
}
