"use client";

import * as React from "react";
import { saveLinkPanelPrefs } from "@/app/actions/flow";
import type { DraftPlan } from "@/lib/flow/model";
import { parsePrefs, type PanelPrefs } from "@/lib/flow/prefs";

type Ctx = {
  open: boolean;
  everOpened: boolean;
  prefs: PanelPrefs;
  setPrefs: (patch: Partial<PanelPrefs>) => void;
  openPanel: (opts?: { runId?: string; draft?: DraftPlan }) => void;
  closePanel: () => void;
  togglePanel: () => void;
  pinnedRunId: string | null;
  pinRun: (runId: string | null) => void;
  draft: DraftPlan | null;
  setDraft: (d: DraftPlan | null) => void;
};

const LinkPanelContext = React.createContext<Ctx | null>(null);
const LS_KEY = "pa:link-panel";

export function useLinkPanel(): Ctx {
  const ctx = React.useContext(LinkPanelContext);
  if (!ctx) throw new Error("useLinkPanel must be used inside <LinkPanelProvider>");
  return ctx;
}

/** Panel state lives in the shell so it survives navigation (no reloads). */
export function LinkPanelProvider({ initial, children }: { initial: unknown; children: React.ReactNode }) {
  const [prefs, setPrefsState] = React.useState<PanelPrefs>(() => parsePrefs(initial));
  const [open, setOpen] = React.useState(false);
  const [everOpened, setEverOpened] = React.useState(false);
  const [pinnedRunId, setPinned] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftPlan | null>(null);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<Partial<PanelPrefs>>({});

  // Per-device convenience cache (server copy is the source of truth across devices).
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setPrefsState((p) => parsePrefs({ ...p, ...JSON.parse(raw) }));
    } catch {}
  }, []);

  const setPrefs = React.useCallback((patch: Partial<PanelPrefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    pending.current = { ...pending.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const toSave = pending.current;
      pending.current = {};
      void saveLinkPanelPrefs(toSave);
    }, 800);
  }, []);

  const openPanel = React.useCallback(
    (opts?: { runId?: string; draft?: DraftPlan }) => {
      setOpen(true);
      setEverOpened(true);
      if (opts?.runId) setPinned(opts.runId);
      if (opts?.draft) setDraft(opts.draft);
      setPrefsState((p) => (p.mode === "minimized" ? { ...p, mode: "floating" } : p));
    },
    [],
  );

  const value = React.useMemo<Ctx>(
    () => ({
      open,
      everOpened,
      prefs,
      setPrefs,
      openPanel,
      closePanel: () => setOpen(false),
      togglePanel: () => {
        setEverOpened(true);
        setOpen((o) => !o);
      },
      pinnedRunId,
      pinRun: setPinned,
      draft,
      setDraft,
    }),
    [open, everOpened, prefs, setPrefs, openPanel, pinnedRunId, draft],
  );

  return <LinkPanelContext.Provider value={value}>{children}</LinkPanelContext.Provider>;
}
