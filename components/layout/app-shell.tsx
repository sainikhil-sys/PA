"use client";

import { MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import * as React from "react";
import { TooltipProvider } from "@/components/ui/misc";
import { CommandPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { ShellContext } from "./shell-context";
import { Sidebar } from "./sidebar";
import { SmoothScroll } from "./smooth-scroll";
import { Topbar } from "./topbar";

// Heavy, on-demand widgets are lazy-loaded.
const ChatPanel = dynamic(() => import("@/components/chat/chat-panel").then((m) => m.ChatPanel), { ssr: false });
const VoiceOverlay = dynamic(() => import("@/components/voice/voice-overlay").then((m) => m.VoiceOverlay), { ssr: false });

export type ShellUser = { name: string | null; email: string; avatarUrl: string | null; timezone: string; agentName: string };

export function AppShell({
  user,
  prefs,
  children,
}: {
  user: ShellUser;
  prefs: { reduceMotion: boolean; fontScale: string; density: string };
  children: React.ReactNode;
}) {
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatPrompt, setChatPrompt] = React.useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontScale = prefs.fontScale;
    root.dataset.reduceMotion = String(prefs.reduceMotion);
    root.dataset.density = prefs.density;
  }, [prefs]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <div className="flex min-h-dvh">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-8 focus:outline-none sm:px-6 lg:px-10 lg:pb-16">
                {children}
              </main>
            </div>
          </div>
          <MobileNav />
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          {chatOpen ? <ChatPanel /> : null}
          {voiceOpen ? <VoiceOverlay /> : null}
        </TooltipProvider>
      </MotionConfig>
    </ShellContext.Provider>
  );
}
