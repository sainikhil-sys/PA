"use client";

import { ArrowRight, Check, DotsThree, Flag, Plus, Robot, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { assignToAgent, connectAgent, disconnectAgent, planTask, saveSprint, setSprintStatus } from "@/app/actions/agents";
import { approveTaskAction, createTaskAction } from "@/app/actions/tasks";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

type Connector = { id: string; name: string; logo: string; defaultModel: string; keyUrl: string; connected: boolean; model: string | null; keyHint: string | null };
type Sprint = { id: string; name: string; goal: string; startDate: string; endDate: string; status: string };
type Task = { id: string; title: string; status: "todo" | "in_progress" | "needs_review" | "done"; points: number | null; agentProvider: string | null; assignee: string; dueDate: string | null; resultMarkdown: string | null; sprintId: string | null };

const COLUMNS: { id: Task["status"]; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "needs_review", label: "Needs review" },
  { id: "done", label: "Done" },
];
const POINTS = [1, 2, 3, 5, 8, 13];

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Something went wrong");
      if (ok) toast.success(ok);
      router.refresh();
    });
  return { pending, run };
}

export function AgentsBoard({ connectors, sprints, currentId, tasks, backlog }: { connectors: Connector[]; sprints: Sprint[]; currentId: string | null; tasks: Task[]; backlog: Task[] }) {
  const current = sprints.find((s) => s.id === currentId) ?? null;
  const connected = connectors.filter((c) => c.connected);
  const total = tasks.reduce((a, t) => a + (t.points ?? 0), 0);
  const done = tasks.filter((t) => t.status === "done").reduce((a, t) => a + (t.points ?? 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {connectors.map((c) => (
          <ConnectorCard key={c.id} c={c} />
        ))}
      </div>
      <SprintBar sprints={sprints} current={current} total={total} done={done} />
      {current ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <section key={col.id} aria-label={col.label} className="flex min-w-0 flex-col gap-2 rounded-[16px] bg-surface p-2">
              <h2 className="flex items-center justify-between px-1.5 pt-1 text-[13px] font-medium">
                {col.label}
                <span className="tabular text-[12px] text-muted">{tasks.filter((t) => t.status === col.id).length}</span>
              </h2>
              {tasks
                .filter((t) => t.status === col.id)
                .map((t) => (
                  <TaskCard key={t.id} t={t} agents={connected} sprints={sprints} />
                ))}
              {col.id === "todo" ? <QuickAdd sprintId={current.id} /> : null}
            </section>
          ))}
        </div>
      ) : null}
      <Card>
        <CardHeader title="Backlog" description="Tasks not in a sprint. Pull them into the current sprint when you plan." />
        <CardBody className="flex flex-col gap-1.5">
          {backlog.length ? backlog.map((t) => <TaskCard key={t.id} t={t} agents={connected} sprints={sprints} compact currentSprintId={current?.id ?? null} />) : <p className="text-[13px] text-muted">Backlog is empty.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function ConnectorCard({ c }: { c: Connector }) {
  const { pending, run } = useAct();
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [model, setModel] = React.useState(c.model ?? c.defaultModel);
  return (
    <div className="card flex items-center gap-3 rounded-[14px] border border-border bg-background px-3.5 py-3">
      <BrandLogo id={c.logo} size={24} box />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{c.name}</p>
        <p className="truncate text-[12px] text-muted">{c.connected ? `${c.model} · key ${c.keyHint}` : "Not connected"}</p>
      </div>
      <Button size="sm" variant={c.connected ? "ghost" : "secondary"} onClick={() => setOpen(true)}>
        {c.connected ? "Manage" : "Connect"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${c.connected ? "Manage" : "Connect"} ${c.name}`}
        description={`Uses your own ${c.name} API key. Tasks you hand over are sent to ${c.name} with their title, details and comments.`}
        footer={
          <>
            {c.connected ? (
              <Button variant="ghost" disabled={pending} onClick={() => run(() => disconnectAgent({ provider: c.id as never }), `${c.name} disconnected`)}>
                Disconnect
              </Button>
            ) : null}
            <Button disabled={pending || key.length < 8} onClick={() => run(async () => {
              const r = await connectAgent({ provider: c.id as never, apiKey: key, model });
              if (r.ok) { setOpen(false); setKey(""); }
              return r;
            }, `${c.name} connected`)}>
              {pending ? "Testing…" : c.connected ? "Replace key" : "Test and connect"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`k-${c.id}`}>API key</Label>
              <a href={c.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-muted underline-offset-2 hover:underline">
                Get a key
              </a>
            </div>
            <Input id={`k-${c.id}`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={c.connected ? "Paste a new key" : "Paste your key"} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`m-${c.id}`}>Model</Label>
            <Input id={`m-${c.id}`} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          {c.id === "claude" ? (
            <p className="text-[12px] text-muted">
              You can also let Claude pick up tasks itself from claude.ai. See{" "}
              <Link href="/settings/claude" className="underline">
                Connect Claude
              </Link>
              .
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

function SprintBar({ sprints, current, total, done }: { sprints: Sprint[]; current: Sprint | null; total: number; done: number }) {
  const router = useRouter();
  const { pending, run } = useAct();
  const [open, setOpen] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = React.useState({ name: `Sprint ${sprints.length + 1}`, goal: "", startDate: today, endDate: twoWeeks });
  const daysLeft = current ? Math.max(0, Math.ceil((new Date(`${current.endDate}T23:59:59`).getTime() - Date.now()) / 86_400_000)) : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="card flex flex-col gap-3 rounded-[16px] border border-border bg-background p-3.5 sm:flex-row sm:items-center">
      <Flag size={18} className="hidden shrink-0 sm:block" />
      <div className="min-w-0 flex-1">
        {current ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Sprint" value={current.id} onChange={(e) => router.push(`/agents?sprint=${e.target.value}`)} className={cn(inputClass, "h-9 w-auto py-0 font-medium")}>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.status === "active" ? "· active" : s.status === "closed" ? "· closed" : ""}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-muted">
                {current.startDate} → {current.endDate}
                {current.status === "active" ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}
              </span>
            </div>
            {current.goal ? <p className="mt-1 truncate text-[13px] text-muted">Goal: {current.goal}</p> : null}
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <span className="tabular text-[12px] text-muted">
                {done}/{total} pts
              </span>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted">No sprint yet. Create one to plan your next two weeks.</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {current && current.status !== "active" && current.status !== "closed" ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => setSprintStatus({ id: current.id, status: "active" }), "Sprint started")}>
            Start sprint
          </Button>
        ) : null}
        {current?.status === "active" ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => window.confirm("Close this sprint? Unfinished tasks go back to the backlog.") && run(() => setSprintStatus({ id: current.id, status: "closed" }), "Sprint closed")}>
            Close sprint
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Plus /> New sprint
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New sprint"
        footer={
          <Button disabled={pending || !form.name.trim()} onClick={() => run(async () => {
            const r = await saveSprint(form);
            if (r.ok) { setOpen(false); router.push(`/agents?sprint=${r.data.id}`); }
            return r;
          }, "Sprint created")}>
            Create sprint
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="sp-name">Name</Label>
            <Input id="sp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="sp-goal">Goal</Label>
            <Textarea id="sp-goal" rows={2} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="What does done look like?" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-start">Starts</Label>
            <Input id="sp-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-end">Ends</Label>
            <Input id="sp-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function TaskCard({ t, agents, sprints, compact, currentSprintId }: { t: Task; agents: Connector[]; sprints: Sprint[]; compact?: boolean; currentSprintId?: string | null }) {
  const { pending, run } = useAct();
  const agentName = t.agentProvider ? { chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude" }[t.agentProvider] : null;
  const working = t.status === "in_progress" && agentName;
  return (
    <div className={cn("card flex items-start gap-2 rounded-[12px] border border-border bg-background px-3 py-2.5", compact && "py-2")}>
      <div className="min-w-0 flex-1">
        <Link href={`/tasks?task=${t.id}`} className="line-clamp-2 text-[13.5px] leading-snug hover:underline">
          {t.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
          {t.points != null ? <span className="tabular rounded-full border border-border px-1.5">{t.points} pt</span> : null}
          {agentName ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full border border-border px-1.5", working && "animate-pulse")}>
              <Robot size={11} /> {working ? `${agentName} working…` : agentName}
            </span>
          ) : null}
          {t.dueDate ? <span>due {t.dueDate}</span> : null}
          {compact ? <span className="capitalize">{t.status.replace("_", " ")}</span> : null}
        </div>
        {t.status === "needs_review" && t.resultMarkdown ? <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap rounded-[8px] bg-surface px-2 py-1.5 text-[12px] text-muted">{t.resultMarkdown.replace(/\*\*/g, "")}</p> : null}
        {t.status === "needs_review" ? (
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" disabled={pending} onClick={() => run(() => approveTaskAction({ id: t.id }), "Approved")}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/tasks?task=${t.id}`}>Open</Link>
            </Button>
          </div>
        ) : null}
      </div>
      {compact && currentSprintId ? (
        <Button size="sm" variant="ghost" disabled={pending} aria-label="Add to current sprint" onClick={() => run(() => planTask({ taskId: t.id, sprintId: currentSprintId }), "Added to sprint")}>
          <ArrowRight />
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label={`Actions for ${t.title}`}>
            <DotsThree size={18} weight="bold" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {t.status === "todo" || t.status === "in_progress" ? (
            <>
              <MenuLabel>Hand to an agent</MenuLabel>
              {agents.length ? (
                agents.map((a) => (
                  <MenuItem key={a.id} onSelect={() => run(() => assignToAgent({ taskId: t.id, provider: a.id as never }), `${a.name} is on it`)}>
                    <Sparkle /> {a.name}
                  </MenuItem>
                ))
              ) : (
                <MenuItem disabled>Connect an agent above first</MenuItem>
              )}
              <MenuSeparator />
            </>
          ) : null}
          <MenuLabel>Story points</MenuLabel>
          <div className="flex flex-wrap gap-1 px-2 pb-1.5">
            {POINTS.map((p) => (
              <button key={p} type="button" onClick={() => run(() => planTask({ taskId: t.id, points: p }))} className={cn("tabular grid size-7 place-items-center rounded-[8px] border text-[12px]", t.points === p ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/60")}>
                {p}
              </button>
            ))}
          </div>
          <MenuSeparator />
          <MenuLabel>Sprint</MenuLabel>
          {sprints
            .filter((s) => s.status !== "closed" && s.id !== t.sprintId)
            .map((s) => (
              <MenuItem key={s.id} onSelect={() => run(() => planTask({ taskId: t.id, sprintId: s.id }), `Moved to ${s.name}`)}>
                Move to {s.name}
              </MenuItem>
            ))}
          {t.sprintId ? <MenuItem onSelect={() => run(() => planTask({ taskId: t.id, sprintId: null }), "Moved to backlog")}>Move to backlog</MenuItem> : null}
        </MenuContent>
      </Menu>
    </div>
  );
}

function QuickAdd({ sprintId }: { sprintId: string }) {
  const { pending, run } = useAct();
  const [title, setTitle] = React.useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        run(async () => {
          const r = await createTaskAction({ title: title.trim() });
          if (!r.ok) return r;
          setTitle("");
          return planTask({ taskId: r.data.id, sprintId });
        });
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} placeholder="+ Add a task" aria-label="Add a task to this sprint" className="h-9 w-full rounded-[10px] border border-dashed border-border-strong bg-transparent px-2.5 text-[13px] outline-none placeholder:text-muted focus:border-foreground" />
    </form>
  );
}
