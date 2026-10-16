"use client";

import { Check, Copy, Graph, Plus, ShieldCheck, Trash } from "@phosphor-icons/react";
import { useLinkPanel } from "@/components/flow/link-panel-context";
import { automationDraft } from "@/lib/flow/draft";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { deleteAutomation, saveAutomation } from "@/app/actions/automations";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { ACTION_LABEL, TRIGGER_LABEL } from "@/lib/automations/templates";
import type { AutomationAction, AutomationCondition, AutomationTrigger } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type ActionType = AutomationAction["type"];
type TriggerType = AutomationTrigger["type"];

export type BuilderInitial = {
  id?: string;
  name: string;
  description: string;
  template?: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  permissions: string[];
  timeoutMs: number;
  enabled: boolean;
};

const NEW_ACTION: Record<ActionType, AutomationAction> = {
  create_task: { type: "create_task", title: "" },
  create_draft: { type: "create_draft" },
  generate_briefing: { type: "generate_briefing" },
  create_linkedin_draft: { type: "create_linkedin_draft", prompt: "" },
  add_note: { type: "add_note", title: "" },
  notify: { type: "notify", title: "" },
  call_agent: { type: "call_agent", prompt: "" },
  call_webhook: { type: "call_webhook", url: "https://" },
};

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: n * 0.04 }} aria-labelledby={`step-${n}`}>
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="tabular grid size-7 shrink-0 place-items-center rounded-full border border-foreground text-[12px] font-medium">{n}</span>
          <div>
            <h2 id={`step-${n}`} className="text-[15px] font-medium">
              {title}
            </h2>
            {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:pl-10">{children}</div>
      </Card>
    </motion.section>
  );
}

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter();
  const [s, setS] = React.useState(initial);
  const [scheduleText, setScheduleText] = React.useState(initial.trigger.type === "schedule" ? (initial.trigger.text ?? initial.trigger.cron) : "every weekday at 9am");
  const [pending, start] = React.useTransition();
  const [secret, setSecret] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { openPanel } = useLinkPanel();

  const setTrigger = (t: AutomationTrigger) => setS((x) => ({ ...x, trigger: t }));
  const setAction = (i: number, a: AutomationAction) => setS((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? a : y)) }));
  const usedTypes = [...new Set(s.actions.map((a) => a.type))];

  const save = () =>
    start(async () => {
      setError(null);
      const trigger = s.trigger.type === "schedule" ? { type: "schedule" as const, text: scheduleText, cron: /^[\d*\/,-]+(\s+[\d*\/,-]+){4}$/.test(scheduleText.trim()) ? scheduleText.trim() : undefined } : s.trigger;
      const res = await saveAutomation({ ...s, trigger: trigger as never, conditions: s.conditions as never, permissions: s.permissions.filter((p) => usedTypes.includes(p as ActionType)) as never });
      if (!res.ok) return setError(res.error);
      toast.success("Automation saved");
      if (res.data.webhookSecret) setSecret(res.data.webhookSecret);
      else router.push(`/automations/${res.data.id}`);
      if (!s.id) setS((x) => ({ ...x, id: res.data.id }));
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="a-name">Name</Label>
            <Input id="a-name" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Morning briefing" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="a-desc">Description</Label>
            <Input id="a-desc" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="Optional" />
          </div>
        </div>
      </Card>

      <Step n={1} title="Trigger" hint="When should this run?">
        <div className="flex flex-col gap-2">
          <Label htmlFor="a-trigger">Trigger</Label>
          <select
            id="a-trigger"
            value={s.trigger.type}
            onChange={(e) => {
              const t = e.target.value as TriggerType;
              setTrigger(t === "schedule" ? { type: "schedule", cron: "0 9 * * 1-5" } : t === "task_status" ? { type: "task_status", to: "done" } : t === "news_topic" ? { type: "news_topic", keywords: [] } : ({ type: t } as AutomationTrigger));
            }}
            className={inputClass}
          >
            {(Object.keys(TRIGGER_LABEL) as TriggerType[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {s.trigger.type === "schedule" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="a-sched">Schedule</Label>
            <Input id="a-sched" value={scheduleText} onChange={(e) => setScheduleText(e.target.value)} placeholder="every weekday at 9am" />
            <FieldHint>Plain words (“every monday 9am”, “every 15 minutes”) or a cron expression. Runs in your timezone.</FieldHint>
          </div>
        ) : null}
        {s.trigger.type === "email" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Input aria-label="From contains" placeholder="From contains" value={s.trigger.from ?? ""} onChange={(e) => setTrigger({ ...(s.trigger as Extract<AutomationTrigger, { type: "email" }>), from: e.target.value || undefined })} />
            <Input aria-label="Subject contains" placeholder="Subject contains" value={s.trigger.subjectContains ?? ""} onChange={(e) => setTrigger({ ...(s.trigger as Extract<AutomationTrigger, { type: "email" }>), subjectContains: e.target.value || undefined })} />
            <select aria-label="Category" className={inputClass} value={s.trigger.category ?? ""} onChange={(e) => setTrigger({ ...(s.trigger as Extract<AutomationTrigger, { type: "email" }>), category: e.target.value || undefined })}>
              <option value="">Any category</option>
              <option value="URGENT">Urgent</option>
              <option value="REPLY_NEEDED">Needs reply</option>
              <option value="FYI">FYI</option>
              <option value="NEWSLETTER">Newsletter</option>
            </select>
          </div>
        ) : null}
        {s.trigger.type === "calendar_event" ? <Input aria-label="Title contains" placeholder="Title contains (optional)" value={s.trigger.titleContains ?? ""} onChange={(e) => setTrigger({ type: "calendar_event", titleContains: e.target.value || undefined })} /> : null}
        {s.trigger.type === "task_status" ? (
          <select aria-label="When status becomes" className={inputClass} value={s.trigger.to} onChange={(e) => setTrigger({ type: "task_status", to: e.target.value })}>
            <option value="in_progress">In progress</option>
            <option value="needs_review">Needs review</option>
            <option value="done">Done</option>
          </select>
        ) : null}
        {s.trigger.type === "news_topic" ? (
          <Input aria-label="Keywords" placeholder="Keywords, comma separated" value={s.trigger.keywords.join(", ")} onChange={(e) => setTrigger({ type: "news_topic", keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })} />
        ) : null}
        {s.trigger.type === "webhook" ? <FieldHint>After saving you'll get a URL and a secret (shown once). Send POST requests with the header x-pa-webhook-secret.</FieldHint> : null}
      </Step>

      <Step n={2} title="Conditions" hint="Optional. All must match.">
        {s.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="Field" className={cn(inputClass, "w-auto")} value={c.field} onChange={(e) => setS({ ...s, conditions: s.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>
              {["subject", "from", "category", "summary", "title", "to", "source"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <select aria-label="Operator" className={cn(inputClass, "w-auto")} value={c.op} onChange={(e) => setS({ ...s, conditions: s.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as AutomationCondition["op"] } : x)) })}>
              <option value="contains">contains</option>
              <option value="not_contains">doesn't contain</option>
              <option value="equals">equals</option>
            </select>
            <Input aria-label="Value" className="w-auto flex-1" value={c.value} onChange={(e) => setS({ ...s, conditions: s.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
            <Button variant="quiet" size="icon-sm" aria-label="Remove condition" onClick={() => setS({ ...s, conditions: s.conditions.filter((_, j) => j !== i) })}>
              <Trash />
            </Button>
          </div>
        ))}
        <Button size="sm" className="w-fit" onClick={() => setS({ ...s, conditions: [...s.conditions, { field: "subject", op: "contains", value: "" }] })} disabled={s.conditions.length >= 5}>
          <Plus /> Add condition
        </Button>
      </Step>

      <Step n={3} title="Actions" hint="Run in order. Use {{title}}, {{subject}}, {{from}} or {{agent_output}} in text.">
        {s.actions.map((a, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-[12px] border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <select aria-label={`Action ${i + 1}`} className={cn(inputClass, "w-auto")} value={a.type} onChange={(e) => setAction(i, NEW_ACTION[e.target.value as ActionType])}>
                {(Object.keys(ACTION_LABEL) as ActionType[]).map((t) => (
                  <option key={t} value={t}>
                    {ACTION_LABEL[t]}
                  </option>
                ))}
              </select>
              <Button variant="quiet" size="icon-sm" aria-label="Remove action" onClick={() => setS({ ...s, actions: s.actions.filter((_, j) => j !== i) })}>
                <Trash />
              </Button>
            </div>
            {"title" in a ? <Input aria-label="Title" placeholder="Title" value={a.title} onChange={(e) => setAction(i, { ...a, title: e.target.value } as AutomationAction)} /> : null}
            {a.type === "create_task" ? <Textarea aria-label="Description" placeholder="Description (optional)" value={a.description ?? ""} onChange={(e) => setAction(i, { ...a, description: e.target.value })} className="min-h-16" /> : null}
            {a.type === "notify" ? <Textarea aria-label="Message" placeholder="Message (optional)" value={a.body ?? ""} onChange={(e) => setAction(i, { ...a, body: e.target.value })} className="min-h-16" /> : null}
            {a.type === "add_note" ? <Textarea aria-label="Content" placeholder="Content, e.g. {{agent_output}}" value={a.content ?? ""} onChange={(e) => setAction(i, { ...a, content: e.target.value })} className="min-h-16" /> : null}
            {a.type === "call_agent" ? <Textarea aria-label="Prompt" placeholder="What should the agent do?" value={a.prompt} onChange={(e) => setAction(i, { ...a, prompt: e.target.value })} className="min-h-16" /> : null}
            {a.type === "create_linkedin_draft" ? <Input aria-label="Topic" placeholder="Topic (defaults to {{title}})" value={a.prompt ?? ""} onChange={(e) => setAction(i, { ...a, prompt: e.target.value })} /> : null}
            {a.type === "create_draft" ? <Input aria-label="Instructions" placeholder="Reply instructions (optional). Needs an email trigger." value={a.instructions ?? ""} onChange={(e) => setAction(i, { ...a, instructions: e.target.value })} /> : null}
            {a.type === "call_webhook" ? (
              <>
                <Input aria-label="Webhook URL" value={a.url} onChange={(e) => setAction(i, { ...a, url: e.target.value })} />
                <FieldHint>Sends run metadata only (name, run id, time). Never email or document content.</FieldHint>
              </>
            ) : null}
          </div>
        ))}
        <Button size="sm" className="w-fit" disabled={s.actions.length >= 6} onClick={() => setS({ ...s, actions: [...s.actions, NEW_ACTION.notify] })}>
          <Plus /> Add action
        </Button>
      </Step>

      <Step n={4} title="Permissions & limits" hint="This automation may only do what's checked. Sending, posting and deleting are never possible.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {usedTypes.map((t) => (
            <li key={t}>
              <label className="flex min-h-11 items-center gap-3 rounded-[10px] border border-border px-3 text-sm">
                <Checkbox
                  checked={s.permissions.includes(t)}
                  onCheckedChange={(v) => setS({ ...s, permissions: v ? [...new Set([...s.permissions, t])] : s.permissions.filter((p) => p !== t) })}
                  aria-label={ACTION_LABEL[t]}
                />
                {ACTION_LABEL[t]}
              </label>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <ShieldCheck size={16} /> Never allowed: send email, post publicly, delete, spend.
        </p>
        <div className="flex max-w-xs flex-col gap-2">
          <Label htmlFor="a-timeout">Timeout (seconds)</Label>
          <Input id="a-timeout" type="number" min={5} max={240} value={Math.round(s.timeoutMs / 1000)} onChange={(e) => setS({ ...s, timeoutMs: Math.min(240, Math.max(5, Number(e.target.value) || 60)) * 1000 })} />
        </div>
      </Step>

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {s.id ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => openPanel({ draft: automationDraft(s.name, s.trigger, s.actions) })}>
          <Graph /> Preview in panel
        </Button>
        <Button variant="primary" size="lg" onClick={save} disabled={pending}>
          <Check /> {pending ? "Saving…" : "Save automation"}
        </Button>
        </div>
      </div>

      <Dialog
        open={secret !== null}
        onOpenChange={(o) => {
          if (!o) {
            setSecret(null);
            router.push(`/automations/${s.id}`);
          }
        }}
        title="Webhook ready"
        description="Copy the secret now. It won't be shown again."
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="break-all rounded-[10px] bg-surface p-3 font-mono">{typeof window !== "undefined" ? `${window.location.origin}/api/automations/webhook/${s.id}` : ""}</p>
          <p className="break-all rounded-[10px] bg-surface p-3 font-mono">x-pa-webhook-secret: {secret}</p>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(secret ?? "");
              toast.success("Secret copied");
            }}
          >
            <Copy /> Copy secret
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this automation?"
        description="Its run history goes too. This can't be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() =>
                start(async () => {
                  const res = await deleteAutomation({ id: s.id! });
                  if (!res.ok) return void toast.error(res.error);
                  router.push("/automations");
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}
