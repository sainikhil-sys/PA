"use client";

import { ArrowClockwise, ChatCircle, Microphone, NotePencil, X } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { dismissIdea, draftFromIdea, refreshIdeas } from "@/app/actions/content";
import { useShell } from "@/components/layout/shell-context";
import { AgentOrb } from "@/components/voice/agent-orb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function AgentCardClient({
  agentName,
  stats,
  suggestion,
}: {
  agentName: string;
  stats: { repliesDue: number; review: number; overdue: number };
  suggestion: { text: string; prompt: string } | null;
}) {
  const { openChat, openVoice } = useShell();
  return (
    <Card className="flex h-full flex-col justify-between gap-6 p-5">
      <div className="flex items-start gap-4">
        <AgentOrb state="idle" size={48} />
        <div className="min-w-0">
          <p className="text-[13px] text-muted">{agentName}</p>
          <p className="mt-1 font-serif text-[20px] leading-snug tracking-[-0.01em]">{suggestion?.text ?? "I'm here when you need me."}</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {[
          { label: "Replies due", value: stats.repliesDue },
          { label: "To review", value: stats.review },
          { label: "Overdue", value: stats.overdue },
        ].map((s) => (
          <div key={s.label} className="rounded-[12px] bg-surface px-3 py-2.5">
            <dt className="text-[11px] text-muted">{s.label}</dt>
            <dd className="text-[20px] font-medium">
              <span className="tabular">{s.value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={openVoice}>
          <Microphone /> Talk
        </Button>
        <Button className="flex-1" onClick={() => openChat(suggestion?.prompt)}>
          <ChatCircle /> Chat
        </Button>
      </div>
    </Card>
  );
}

export function PrepButton({ title }: { title: string }) {
  const { openChat } = useShell();
  return (
    <button
      type="button"
      onClick={() => openChat(`Prep me for my meeting "${title}": attendees, recent emails with them, open tasks and talking points.`)}
      className="h-8 shrink-0 self-center rounded-[10px] border border-border px-3 text-[12px] text-muted opacity-100 transition-colors hover:border-border-strong hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
    >
      Prep
    </button>
  );
}

export function IdeaActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await draftFromIdea({ ideaId: id });
            if (!res.ok) return void toast.error(res.error);
            router.push(`/content/${res.data.id}`);
          })
        }
      >
        <NotePencil /> {pending ? "Drafting…" : "Draft"}
      </Button>
      <Button
        size="sm"
        variant="quiet"
        aria-label="Dismiss idea"
        onClick={() =>
          start(async () => {
            await dismissIdea({ id });
            router.refresh();
          })
        }
      >
        <X />
      </Button>
    </div>
  );
}

export function RefreshIdeasButton({ primary }: { primary?: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant={primary ? "secondary" : "quiet"}
      disabled={pending}
      aria-label="Suggest new ideas"
      onClick={() =>
        start(async () => {
          const res = await refreshIdeas({});
          if (!res.ok) return void toast.error(res.error);
          router.refresh();
        })
      }
    >
      <motion.span animate={pending ? { rotate: 360 } : { rotate: 0 }} transition={pending ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0 }} className="inline-flex">
        <ArrowClockwise />
      </motion.span>
      {primary ? (pending ? "Thinking…" : "Suggest ideas") : null}
    </Button>
  );
}
