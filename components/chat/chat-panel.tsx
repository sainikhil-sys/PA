"use client";

import { ArrowsOut } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { useShell } from "@/components/layout/shell-context";
import { Sheet } from "@/components/ui/dialog";
import { fetcher } from "@/lib/fetcher";
import { ChatView } from "./chat-view";

/** Slide-over chat available from anywhere (⌘J). */
export function ChatPanel() {
  const { chatOpen, closeChat, chatPrompt, user } = useShell();
  const [conversationId, setConversationId] = React.useState<string | undefined>();
  const { data } = useSWR<{ items: string[] }>("/api/chat/suggestions", fetcher);
  return (
    <Sheet open={chatOpen} onOpenChange={(o) => !o && closeChat()} title={`Chat with ${user.agentName}`} className="sm:max-w-[480px]" bodyClassName="flex flex-col overflow-hidden p-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex justify-end px-4 pt-2">
          <Link href={conversationId ? `/chat/${conversationId}` : "/chat"} onClick={closeChat} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground">
            <ArrowsOut size={14} /> Open full page
          </Link>
        </div>
        <div className="min-h-0 flex-1">
          <ChatView compact conversationId={conversationId} suggestions={data?.items ?? ["What did I miss today?"]} agentName={user.agentName} initialPrompt={chatPrompt} onConversation={setConversationId} />
        </div>
      </div>
    </Sheet>
  );
}
