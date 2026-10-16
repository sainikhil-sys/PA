"use client";

import * as React from "react";

type ShellState = {
  openChat: (prompt?: string) => void;
  closeChat: () => void;
  chatOpen: boolean;
  chatPrompt: string | null;
  openVoice: () => void;
  closeVoice: () => void;
  voiceOpen: boolean;
  openPalette: () => void;
  user: { name: string | null; email: string; avatarUrl: string | null; timezone: string; agentName: string };
};

export const ShellContext = React.createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}
