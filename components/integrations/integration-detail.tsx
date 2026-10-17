"use client";

import { ChatCircleText, Plugs } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useShell } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import type { CatalogEntry } from "@/lib/integrations/catalog";
import { ConnectPanel, type ConnState } from "./integration-grid";

/** Connect / manage + "ask about it" for one integration's page. */
export function IntegrationActions({ entry, state, telegramConfigured, oauthReady }: { entry: CatalogEntry; state: ConnState; telegramConfigured: boolean; oauthReady: Record<string, boolean> }) {
  const router = useRouter();
  const { openChat } = useShell();
  const [open, setOpen] = React.useState(false);
  const connected = state.status === "connected" || state.status === "syncing";
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant={connected ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        <Plugs /> {connected ? "Manage connection" : "Connect"}
      </Button>
      {connected ? (
        <Button variant="ghost" onClick={() => openChat(`Using my ${entry.name} data, what should I know or do today?`)}>
          <ChatCircleText /> Ask about {entry.name}
        </Button>
      ) : null}
      <ConnectPanel entry={open ? entry : null} state={state} onClose={() => setOpen(false)} onChanged={() => router.refresh()} telegramConfigured={telegramConfigured} oauthReady={oauthReady} />
    </div>
  );
}
