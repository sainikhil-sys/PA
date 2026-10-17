"use client";

import { ArrowClockwise, Check, Lock, MagnifyingGlass, Plus, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { connectWithToken, disconnectIntegration, requestIntegration, syncIntegrationNow } from "@/app/actions/integrations";
import { sendTestTelegram } from "@/app/actions/notifications";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { FieldHint, Input, Label, inputClass } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { CATEGORIES, type CatalogEntry, type IntegrationCategory } from "@/lib/integrations/catalog";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./brand-logo";

export type ConnState = { status: "connected" | "error" | "syncing" | "disconnected" | "none"; label?: string | null; error?: string | null };

const EASE = [0.16, 1, 0.3, 1] as const;

export function IntegrationGrid({ catalog, states, telegramConfigured, oauthReady }: { catalog: CatalogEntry[]; states: Record<string, ConnState>; telegramConfigured: boolean; oauthReady: Record<string, boolean> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [category, setCategory] = React.useState<"All" | IntegrationCategory>("All");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<CatalogEntry | null>(null);
  const [justConnected, setJustConnected] = React.useState<string | null>(params.get("connected"));
  const [requestOpen, setRequestOpen] = React.useState(false);

  React.useEffect(() => {
    const err = params.get("error");
    if (err) toast.error(err.endsWith("_not_configured") ? `${err.replace("_not_configured", "")} isn't configured on the server yet. Add its app credentials to the environment.` : "That connection didn't complete. Please try again.");
    if (params.get("connected")) toast.success("Connected");
    const t = setTimeout(() => setJustConnected(null), 2400);
    return () => clearTimeout(t);
  }, [params]);

  const stateOf = (c: CatalogEntry): ConnState => (c.provider === "telegram" ? { status: telegramConfigured ? "connected" : "none", label: telegramConfigured ? "Configured" : null } : c.provider ? (states[c.provider] ?? { status: "none" }) : { status: "none" });
  const filtered = catalog.filter((c) => (category === "All" || c.category === category) && c.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented id="int-cat" label="Category" value={category} onChange={setCategory} options={[{ value: "All" as const, label: "All" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]} />
        </div>
        <div className="relative w-full lg:w-72">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations" aria-label="Search integrations" className={cn(inputClass, "h-10 pl-9 text-sm")} />
        </div>
      </div>

      <motion.ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.035 } } }}>
        <AnimatePresence mode="popLayout">
          {filtered.map((c) => (
            <motion.li key={c.id} layout variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE } } }} exit={{ opacity: 0, scale: 0.98 }}>
              <IntegrationCard entry={c} state={stateOf(c)} celebrate={justConnected !== null && c.provider === justConnected} onOpen={() => setOpen(c)} />
            </motion.li>
          ))}
          <motion.li key="request" layout variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
            <button type="button" onClick={() => setRequestOpen(true)} className="flex h-full min-h-[168px] w-full flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-border-strong p-5 text-center text-sm text-muted transition-colors hover:border-foreground hover:text-foreground">
              <Plus size={20} />
              Request an integration
            </button>
          </motion.li>
        </AnimatePresence>
      </motion.ul>

      <ConnectPanel entry={open} state={open ? stateOf(open) : { status: "none" }} onClose={() => setOpen(null)} onChanged={() => router.refresh()} telegramConfigured={telegramConfigured} oauthReady={oauthReady} />
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </div>
  );
}

function IntegrationCard({ entry, state, celebrate, onOpen }: { entry: CatalogEntry; state: ConnState; celebrate: boolean; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const statusText = state.status === "connected" ? "Connected" : state.status === "error" ? "Needs attention" : state.status === "syncing" ? "Syncing" : "Not connected";
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={reduce ? undefined : { y: -2 }}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      animate={state.status === "error" && !reduce ? { x: [0, -4, 4, -2, 2, 0] } : undefined}
      transition={{ duration: 0.4 }}
      className="group flex h-full min-h-[168px] w-full flex-col gap-4 rounded-[16px] border border-border bg-background p-5 text-left transition-[border-color] duration-200 hover:border-foreground/60"
      aria-label={`${entry.name}: ${statusText}`}
    >
      <div className="flex items-start justify-between">
        <div className="relative">
          <motion.div
            className="relative"
            animate={celebrate && !reduce ? { scale: [1, 1.12, 1] } : undefined}
            whileHover={reduce ? undefined : { rotate: -4, y: -1 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <span className={cn("block", state.status === "disconnected" && "opacity-60 grayscale")}>
              <BrandLogo id={entry.logo} size={28} box />
            </span>
          </motion.div>
          {state.status === "syncing" ? <SyncRing /> : null}
          {celebrate ? <CheckBurst /> : null}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          {state.status === "error" ? <WarningCircle size={14} className="text-danger" /> : <StatusDot state={state.status === "connected" ? "ok" : "idle"} pulse={state.status === "connected"} />}
          {statusText}
        </span>
      </div>
      <div>
        <p className="text-sm font-medium">{entry.name}</p>
        <p className="mt-1 text-[13px] text-muted">{entry.description}</p>
      </div>
      {state.status === "connected" && state.label ? <p className="mt-auto truncate text-[12px] text-subtle">{state.label}</p> : null}
    </motion.button>
  );
}

function SyncRing() {
  return (
    <motion.svg className="pointer-events-none absolute -inset-1.5" viewBox="0 0 60 60" animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} aria-hidden>
      <circle cx="30" cy="30" r="28" fill="none" stroke="var(--border)" strokeWidth="2" />
      <path d="M30 2 A28 28 0 0 1 58 30" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" />
    </motion.svg>
  );
}

function CheckBurst() {
  return (
    <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-primary" aria-hidden>
      <svg viewBox="0 0 16 16" className="size-3">
        <motion.path d="M3.5 8.5l3 3 6-7" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.1, ease: EASE }} />
      </svg>
    </motion.span>
  );
}

const SYNCABLE = new Set(["asana", "linear", "hubspot", "stripe", "zoom", "youtube", "figma", "canva"]);

function ConnectPanel({ entry, state, onClose, onChanged, telegramConfigured, oauthReady }: { entry: CatalogEntry | null; state: ConnState; onClose: () => void; onChanged: () => void; telegramConfigured: boolean; oauthReady: Record<string, boolean> }) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => setValues({}), [entry]);
  if (!entry) return <Sheet open={false} onOpenChange={() => {}} title="">{null}</Sheet>;
  const connected = state.status === "connected";
  const fields = entry.fields ?? [{ name: "token", label: "Access token", secret: true }];
  const complete = fields.every((f) => (values[f.name] ?? "").trim().length >= (f.secret ? 10 : 1));
  const ready = entry.connect !== "oauth" || Boolean(oauthReady[entry.provider ?? ""]);

  const syncNow = (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await syncIntegrationNow({ provider: entry.provider! });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Synced · ${res.data.items} items`);
          onChanged();
        })
      }
    >
      <ArrowClockwise /> {pending ? "Syncing…" : "Sync now"}
    </Button>
  );

  return (
    <>
      <Sheet
        open={entry !== null}
        onOpenChange={(o) => !o && onClose()}
        title={entry.name}
        description={entry.description}
        footer={
          entry.connect === "google" ? (
            connected ? (
              <>
                <Button variant="danger" onClick={() => setConfirm(true)}>
                  Disconnect
                </Button>
                <Button asChild>
                  <a href={`/api/integrations/google/start?returnTo=/integrations`}>
                    <ArrowClockwise /> Reconnect
                  </a>
                </Button>
              </>
            ) : (
              <Button asChild variant="primary">
                <a href={`/api/integrations/google/start?returnTo=/integrations`}>Connect with Google</a>
              </Button>
            )
          ) : entry.connect === "oauth" ? (
            connected ? (
              <>
                <Button variant="danger" onClick={() => setConfirm(true)}>
                  Disconnect
                </Button>
                {SYNCABLE.has(entry.provider!) ? syncNow : null}
              </>
            ) : ready ? (
              <Button asChild variant="primary">
                <a href={`/api/integrations/${entry.provider}/start`}>Connect with {entry.name}</a>
              </Button>
            ) : (
              <Button variant="primary" disabled>
                App credentials needed
              </Button>
            )
          ) : entry.connect === "token" ? (
            connected ? (
              <>
                <Button variant="danger" onClick={() => setConfirm(true)}>
                  Disconnect
                </Button>
                {SYNCABLE.has(entry.provider!) ? syncNow : null}
              </>
            ) : (
              <Button
                variant="primary"
                disabled={pending || !complete}
                onClick={() =>
                  start(async () => {
                    const res = await connectWithToken({ provider: entry.provider as "notion", fields: values });
                    if (!res.ok) return void toast.error(res.error);
                    toast.success(`Connected to ${res.data.label}. First sync started.`);
                    onChanged();
                    onClose();
                  })
                }
              >
                {pending ? "Checking…" : "Connect"}
              </Button>
            )
          ) : telegramConfigured ? (
            <Button
              onClick={() =>
                start(async () => {
                  const res = await sendTestTelegram({});
                  if (!res.ok) toast.error(res.error);
                  else toast.success("Test message sent");
                })
              }
            >
              Send test message
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <BrandLogo id={entry.logo} size={32} box />
            <div className="text-[13px]">
              <p className="font-medium">{connected ? `Connected${state.label ? ` as ${state.label}` : ""}` : "Not connected"}</p>
              {state.error ? <p className="text-danger">{state.error}</p> : null}
            </div>
          </div>
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={18} /> What PA can do
            </h3>
            <ul className="flex flex-col gap-2">
              {entry.permissions.map((p) => (
                <li key={p} className="flex gap-2 text-[13px]">
                  <Check size={16} className="mt-0.5 shrink-0" /> {p}
                </li>
              ))}
              <li className="flex gap-2 text-[13px] text-muted">
                <Lock size={16} className="mt-0.5 shrink-0" /> {entry.provider === "linkedin" ? "Never posts by itself. Every post needs your Publish click on an approved draft." : "Never sends, posts or deletes on your behalf."}
              </li>
            </ul>
          </section>
          {entry.scopes.length ? (
            <section>
              <h3 className="mb-2 text-sm font-medium">Scopes requested</h3>
              <ul className="flex flex-wrap gap-1.5">
                {entry.scopes.map((s) => (
                  <li key={s} className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px]">
                    {s}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Read-only by default. Credentials are encrypted at rest (AES-256-GCM).</p>
            </section>
          ) : null}
          {entry.connect === "token" && !connected ? (
            <div className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-2">
                  <Label htmlFor={`int-${f.name}`}>{f.label}</Label>
                  <Input id={`int-${f.name}`} type={f.secret ? "password" : "text"} autoComplete="off" value={values[f.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                </div>
              ))}
              <FieldHint>{entry.tokenHelp}</FieldHint>
            </div>
          ) : null}
          {entry.connect === "oauth" && !connected ? <FieldHint>{ready ? `You'll be sent to ${entry.name} to approve access, then back here.` : entry.tokenHelp}</FieldHint> : null}
          {entry.connect === "none" ? <p className="text-[13px] text-muted">{entry.tokenHelp}</p> : null}
        </div>
      </Sheet>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${entry.provider === "google" ? "Google" : entry.name}?`}
        description="PA forgets the stored tokens. Synced knowledge stays until you delete it on the Knowledge page."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await disconnectIntegration({ provider: entry.provider! });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Disconnected");
                  setConfirm(false);
                  onChanged();
                  onClose();
                })
              }
            >
              Disconnect
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

function RequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request an integration"
      description="It's saved to your tasks so you can follow up."
      footer={
        <Button
          variant="primary"
          disabled={pending || name.trim().length < 2}
          onClick={() =>
            start(async () => {
              const res = await requestIntegration({ name });
              if (!res.ok) return void toast.error(res.error);
              toast.success("Request saved");
              setName("");
              onOpenChange(false);
            })
          }
        >
          Save request
        </Button>
      }
    >
      <Input aria-label="Integration name" placeholder="e.g. Microsoft Outlook" value={name} onChange={(e) => setName(e.target.value)} />
    </Dialog>
  );
}
