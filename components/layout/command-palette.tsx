"use client";

import { ChatCircle, Graph, Microphone, Plus, Sparkle, TreeStructure } from "@phosphor-icons/react";
import { useLinkPanel } from "@/components/flow/link-panel-context";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { quickAddTask } from "@/app/actions/tasks";
import { PRIMARY_NAV, SECONDARY_NAV } from "./nav";
import { useShell } from "./shell-context";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { openChat, openVoice } = useShell();
  const { openPanel } = useLinkPanel();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const itemClass =
    "flex h-11 cursor-pointer select-none items-center gap-3 rounded-[10px] px-3 text-sm text-foreground data-[selected=true]:bg-surface-hover [&_svg]:text-muted";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[60] bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={() => onOpenChange(false)}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="mx-auto mt-[12vh] w-[calc(100vw-32px)] max-w-[560px] overflow-hidden rounded-[16px] border border-border bg-background shadow-pop"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <Command
              label="Command palette"
              loop
              onKeyDown={(e) => {
                if (e.key === "Escape") onOpenChange(false);
              }}
            >
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search, jump to a page, or ask your agent…"
                className="h-14 w-full border-b border-border bg-transparent px-5 text-[15px] outline-none placeholder:text-subtle"
              />
              <Command.List data-lenis-prevent className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches. Press Enter to ask your agent.</Command.Empty>
                {query.trim() ? (
                  <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-muted">
                    <Command.Item value={`ask ${query}`} className={itemClass} onSelect={() => run(() => openChat(query))}>
                      <Sparkle size={18} /> Ask agent: “{query}”
                    </Command.Item>
                    <Command.Item
                      value={`task ${query}`}
                      className={itemClass}
                      onSelect={() =>
                        run(async () => {
                          const res = await quickAddTask(query);
                          if (res.ok) toast.success("Task added", { description: res.summary });
                          else toast.error(res.error);
                        })
                      }
                    >
                      <Plus size={18} /> Create task: “{query}”
                    </Command.Item>
                  </Command.Group>
                ) : null}
                <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-muted">
                  {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item key={item.href} value={`go ${item.label}`} className={itemClass} onSelect={() => run(() => router.push(item.href))}>
                        <Icon size={18} /> {item.label}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
                <Command.Group heading="Agent" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-muted">
                  <Command.Item value="open chat panel" className={itemClass} onSelect={() => run(() => openChat())}>
                    <ChatCircle size={18} /> Open chat panel <span className="ml-auto text-[12px] text-subtle">⌘J</span>
                  </Command.Item>
                  <Command.Item value="talk voice" className={itemClass} onSelect={() => run(openVoice)}>
                    <Microphone size={18} /> Talk to your agent
                  </Command.Item>
                  <Command.Item value="live links panel" className={itemClass} onSelect={() => run(() => openPanel())}>
                    <Graph size={18} /> Live links panel <span className="ml-auto text-[12px] text-subtle">⌘⇧L</span>
                  </Command.Item>
                  <Command.Item value="flow runs" className={itemClass} onSelect={() => run(() => router.push("/flow"))}>
                    <TreeStructure size={18} /> Flow: recent runs
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
