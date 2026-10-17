"use client";

import { MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import * as React from "react";
import { LinkPanelProvider, useLinkPanel } from "@/components/flow/link-panel-context";
import { TooltipProvider } from "@/components/ui/misc";
import { AppilixSync } from "./appilix-sync";
import { CommandPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { ShellContext } from "./shell-context";
import { Sidebar } from "./sidebar";
import { SmoothScroll } from "./smooth-scroll";
import { Topbar } from "./topbar";

// Heavy, on-demand widgets are lazy-loaded.
const ChatPanel = dynamic(() => import("@/components/chat/chat-panel").then((m) => m.ChatPanel), { ssr: false });
const LinkPanel = dynamic(() => import("@/components/flow/link-panel").then((m) => m.LinkPanel), { ssr: false });
const VoiceOverlay = dynamic(() => import("@/components/voice/voice-overlay").then((m) => m.VoiceOverlay), { ssr: false });

export type ShellUser = { name: string | null; email: string; avatarUrl: string | null; timezone: string; agentName: string };

export function AppShell(props: Parameters<typeof ShellInner>[0]) {
  return (
    <LinkPanelProvider initial={props.prefs.linkPanel}>
      <ShellInner {...props} />
    </LinkPanelProvider>
  );
}

function ShellInner({
  user,
  prefs,
  children,
}: {
  user: ShellUser;
  prefs: { reduceMotion: boolean; fontScale: string; density: string; linkPanel: unknown };
  children: React.ReactNode;
}) {
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatPrompt, setChatPrompt] = React.useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const linkPanel = useLinkPanel();
  const togglePanel = linkPanel.togglePanel;

  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontScale = prefs.fontScale;
    root.dataset.reduceMotion = String(prefs.reduceMotion);
    root.dataset.density = prefs.density;
  }, [prefs]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        togglePanel();
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const ctx = React.useMemo(
    () => ({
      user,
      chatOpen,
      chatPrompt,
      voiceOpen,
      openChat: (prompt?: string) => {
        setChatPrompt(prompt ?? null);
        setChatOpen(true);
      },
      closeChat: () => setChatOpen(false),
      openVoice: () => setVoiceOpen(true),
      closeVoice: () => setVoiceOpen(false),
      openPalette: () => setPaletteOpen(true),
    }),
    [user, chatOpen, chatPrompt, voiceOpen],
  );

  return (
    <ShellContext.Provider value={ctx}>
      <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
        <TooltipProvider>
          <SmoothScroll disabled={prefs.reduceMotion} />
          {/* Docked Live Link panel pushes content via --lp-right / --lp-bottom. */}
          <div className="flex min-h-dvh pb-[var(--lp-bottom,0px)] pr-[var(--lp-right,0px)] transition-[padding] duration-200">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-3 pb-24 pt-4 focus:outline-none sm:px-6 sm:pt-6 lg:px-8 lg:pb-12">
                {children}
              </main>
            </div>
          </div>
          <MobileNav />
          <AppilixSync email={user.email} />
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          {chatOpen ? <ChatPanel /> : null}
          {voiceOpen ? <VoiceOverlay /> : null}
          {linkPanel.everOpened ? <LinkPanel /> : null}
        </TooltipProvider>
      </MotionConfig>
    </ShellContext.Provider>
  );
}
