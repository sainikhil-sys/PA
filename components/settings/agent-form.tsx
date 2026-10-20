"use client";

import { Check, Lock, Plugs, Trash, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { addMemory, deleteMemory, saveAgentSettings, savePreferences, updateMemory } from "@/app/actions/settings";
import { ChatView } from "@/components/chat/chat-view";
import { AgentOrb } from "@/components/voice/agent-orb";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { NEVER_DO, PERSONALITIES } from "@/lib/agent/personality";
import type { AgentSettings } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { AiKeySection, type AiPresetInfo, type OwnAiKey } from "./ai-key-section";
import { Row, Section } from "./section";

type MemoryRow = { id: string; content: string; kind: string };

const CAPS: { key: keyof AgentSettings["capabilities"]; label: string; hint: string }[] = [
  { key: "readEmail", label: "Read email", hint: "Summaries and metadata from Gmail" },
  { key: "createDrafts", label: "Create drafts", hint: "Gmail reply drafts, after you approve" },
  { key: "manageTasks", label: "Manage tasks", hint: "Propose and create tasks" },
  { key: "runAutomations", label: "Run automations", hint: "Start an automation after you approve" },
  { key: "searchKnowledge", label: "Search knowledge", hint: "Answer from your documents" },
];

export function AgentForm({ initial, aiPresets, ownKey, memories, quiet, serverTts }: { initial: AgentSettings; aiPresets: AiPresetInfo[]; ownKey: OwnAiKey; memories: MemoryRow[]; quiet: { start: string | null; end: string | null }; serverTts: boolean }) {
  const router = useRouter();
  const [a, setA] = React.useState(initial);
  const [, start] = React.useTransition();
  const [voices, setVoices] = React.useState<string[]>([]);
  const [q, setQ] = React.useState(quiet);
  const [newMem, setNewMem] = React.useState("");
  const [previewKey, setPreviewKey] = React.useState(0);

  React.useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices().map((v) => v.name) ?? []);
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);

  const save = (patch: Partial<AgentSettings>) => {
    const next = { ...a, ...patch };
    setA(next);
    start(async () => {
      const res = await saveAgentSettings(patch as Parameters<typeof saveAgentSettings>[0]);
      if (!res.ok) toast.error(res.error);
      else setPreviewKey((k) => k + 1);
    });
  };

  return (
    <div>
      <Section title="Identity" description="How your agent introduces itself.">
        <div className="flex items-center gap-4">
          <AgentOrb state="idle" size={56} />
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="ag-name">Name</Label>
            <Input id="ag-name" defaultValue={a.name} onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && save({ name: e.target.value.trim() })} />
          </div>
        </div>
        <div role="radiogroup" aria-label="Personality" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PERSONALITIES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={a.personality === p.id} onClick={() => save({ personality: p.id })} className={cn("rounded-[14px] border p-3 text-left transition-colors", a.personality === p.id ? "border-foreground" : "border-border hover:border-border-strong")}>
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="mt-1 block text-[12px] text-muted">{p.sample}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ag-custom">Custom instructions</Label>
          <Textarea id="ag-custom" defaultValue={a.customInstructions} placeholder="e.g. Use British spelling. Never schedule meetings before 10am." onBlur={(e) => e.target.value !== a.customInstructions && save({ customInstructions: e.target.value })} />
        </div>
        <Row label="Response length" htmlFor="ag-len">
          <Segmented id="ag-len" label="Response length" value={a.responseLength} onChange={(v) => save({ responseLength: v })} options={[{ value: "short", label: "Short" }, { value: "medium", label: "Medium" }, { value: "detailed", label: "Detailed" }]} />
        </Row>
        <Row label="Preferred language" htmlFor="ag-lang">
          <select id="ag-lang" value={a.language} onChange={(e) => save({ language: e.target.value })} className={inputClass}>
            {[["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["hi", "हिन्दी"], ["pt", "Português"]].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Proactivity" hint="How often the agent offers suggestions." htmlFor="ag-pro">
          <Segmented id="ag-pro" label="Proactivity" value={a.proactivity} onChange={(v) => save({ proactivity: v })} options={[{ value: "ask", label: "Only when asked" }, { value: "nudge", label: "Gentle" }, { value: "proactive", label: "Proactive" }]} />
        </Row>
      </Section>

      <Section title="Voice" description="How your agent sounds when it talks back.">
        <Row label="Voice" htmlFor="ag-voice">
          <select id="ag-voice" value={a.voice} onChange={(e) => save({ voice: e.target.value })} className={inputClass}>
            <option value="">System default</option>
            {serverTts ? (
              <optgroup label="Server (open-source TTS)">
                {["af_heart", "af_bella", "am_michael", "bf_emma"].map((v) => (
                  <option key={v} value={`server:${v}`}>
                    {v}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="This browser">
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </optgroup>
          </select>
        </Row>
        <Row label="Speech speed" htmlFor="ag-rate">
          <div className="flex items-center gap-3">
            <input id="ag-rate" type="range" min={0.5} max={2} step={0.1} value={a.speechRate} onChange={(e) => setA({ ...a, speechRate: Number(e.target.value) })} onPointerUp={() => save({ speechRate: a.speechRate })} onKeyUp={() => save({ speechRate: a.speechRate })} className="w-full accent-[var(--foreground)]" />
            <span className="tabular w-10 text-sm">{a.speechRate.toFixed(1)}×</span>
          </div>
        </Row>
      </Section>

      <Section title="Capabilities" description="What the agent may do. Every action still waits for your approval.">
        {CAPS.map((c) => (
          <Row key={c.key} label={c.label} hint={c.hint}>
            <Switch checked={a.capabilities[c.key]} onCheckedChange={(v) => save({ capabilities: { ...a.capabilities, [c.key]: v } })} aria-label={c.label} />
          </Row>
        ))}
        <div className="rounded-[14px] border border-dashed border-border-strong p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Lock size={16} /> What it can never do
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {NEVER_DO.map((n) => (
              <li key={n} className="flex items-center gap-2 text-[13px] text-muted">
                <X size={14} /> {n}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Quiet hours" description="Push and email alerts pause in this window. In-app notifications still collect.">
        <Row label="Start and end">
          <div className="flex items-center gap-2 sm:justify-end">
            <input type="time" aria-label="Quiet hours start" value={q.start ?? ""} onChange={(e) => setQ({ ...q, start: e.target.value || null })} className={cn(inputClass, "w-auto")} />
            <span className="text-muted">–</span>
            <input type="time" aria-label="Quiet hours end" value={q.end ?? ""} onChange={(e) => setQ({ ...q, end: e.target.value || null })} className={cn(inputClass, "w-auto")} />
            <Button
              size="sm"
              onClick={() =>
                start(async () => {
                  const res = await savePreferences({ quietHoursStart: q.start, quietHoursEnd: q.end });
                  if (!res.ok) toast.error(res.error);
                  else toast.success("Saved");
                })
              }
            >
              Save
            </Button>
          </div>
        </Row>
      </Section>

      <AiKeySection presets={aiPresets} current={ownKey} />

      <Section title="Claude" description="Use your Cowork tasks, notes and briefing from Claude.">
        <Button asChild variant="secondary" className="w-fit">
          <Link href="/settings/claude">
            <Plugs /> Connect Claude
          </Link>
        </Button>
      </Section>

      <Section title="Memory" description="What your agent remembers about you. Edit or delete anything.">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await addMemory({ content: newMem, kind: "preference" });
              if (!res.ok) return void toast.error(res.error);
              setNewMem("");
              router.refresh();
            });
          }}
        >
          <Input value={newMem} onChange={(e) => setNewMem(e.target.value)} placeholder="e.g. I prefer meetings after 10am" aria-label="New memory" />
          <Button type="submit" disabled={newMem.trim().length < 2}>
            Add
          </Button>
        </form>
        {memories.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing remembered yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[14px] border border-border">
            {memories.map((m) => (
              <MemoryItem key={m.id} m={m} onChange={() => router.refresh()} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Preview" description="Try it. Changes above apply immediately.">
        <div className="h-[460px] overflow-hidden rounded-[16px] border border-border">
          <ChatView key={previewKey} compact suggestions={["Introduce yourself in one line", "What can't you do?"]} agentName={a.name} />
        </div>
      </Section>
    </div>
  );
}

function MemoryItem({ m, onChange }: { m: MemoryRow; onChange: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(m.content);
  return (
    <li className="flex min-h-12 items-center gap-2 px-3 py-1.5">
      {editing ? (
        <>
          <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-9 text-sm" aria-label="Edit memory" autoFocus />
          <Button
            size="icon-sm"
            aria-label="Save"
            onClick={async () => {
              const res = await updateMemory({ id: m.id, content: value });
              if (!res.ok) return void toast.error(res.error);
              setEditing(false);
              onChange();
            }}
          >
            <Check />
          </Button>
        </>
      ) : (
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setEditing(true)}>
          {m.content}
        </button>
      )}
      <Button
        size="icon-sm"
        variant="quiet"
        aria-label="Forget this"
        onClick={async () => {
          await deleteMemory({ id: m.id });
          onChange();
        }}
      >
        <Trash />
      </Button>
    </li>
  );
}
