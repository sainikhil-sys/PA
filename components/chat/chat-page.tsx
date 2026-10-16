"use client";

import { ChatView } from "./chat-view";
import { ConversationList } from "./conversation-list";
import type { UiMessage } from "./use-chat";

export function ChatPage({ conversationId, initial, suggestions, agentName, prompt }: { conversationId?: string; initial: UiMessage[]; suggestions: string[]; agentName: string; prompt?: string }) {
  return (
    <div className="-mx-4 -mb-28 -mt-8 flex h-[calc(100dvh-8rem)] border-border sm:-mx-6 lg:-mx-10 lg:-mb-16 lg:h-[calc(100dvh-4rem)]">
      <aside className="hidden w-[280px] shrink-0 border-r border-border bg-surface md:block">
        <ConversationList activeId={conversationId} />
      </aside>
      <section className="min-w-0 flex-1" aria-label="Chat">
        <ChatView
          key={conversationId ?? "new"}
          conversationId={conversationId}
          initial={initial}
          suggestions={suggestions}
          agentName={agentName}
          initialPrompt={prompt}
          // Update the URL without remounting (a navigation would abort the stream).
          onConversation={(id) => window.history.replaceState(null, "", `/chat/${id}`)}
        />
      </section>
    </div>
  );
}
