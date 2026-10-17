"use client";

import { ArrowSquareOut, Key, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { removeAiKey, saveAiKey } from "@/app/actions/ai-key";
import { Button } from "@/components/ui/button";
import { Input, Label, inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Section } from "./section";

export type AiPresetInfo = { id: string; label: string; baseURL: string; fastModel: string; smartModel: string; keyUrl: string };
export type OwnAiKey = { preset: string; label: string; keyHint: string; fastModel: string; smartModel: string; addedAt: string } | null;

/** Bring your own AI key. The key is write-only: after saving, only its last 4 characters are ever shown. */
export function AiKeySection({ presets, current }: { presets: AiPresetInfo[]; current: OwnAiKey }) {
  const router = useRouter();
  const [preset, setPreset] = React.useState(presets[0]!.id);
  const p = presets.find((x) => x.id === preset)!;
  const [apiKey, setApiKey] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [fast, setFast] = React.useState(p.fastModel);
  const [smart, setSmart] = React.useState(p.smartModel);
  const [pending, start] = React.useTransition();

  const pick = (id: string) => {
    const n = presets.find((x) => x.id === id)!;
    setPreset(id);
    setFast(n.fastModel);
    setSmart(n.smartModel);
  };

  return (
    <Section title="AI key" description="Cowork works out of the box. Add your own key to use your preferred model and your own quota. Keys are encrypted and never shown again.">
      {current ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-border p-4 sm:flex-row sm:items-center">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
            <Key size={18} />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">
              {current.label} <span className="font-normal text-muted">· key {current.keyHint}</span>
            </p>
            <p className="truncate text-muted">
              Fast: <span className="font-mono">{current.fastModel}</span> · Smart: <span className="font-mono">{current.smartModel}</span>
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeAiKey({});
                if (!r.ok) return void toast.error(r.error);
                toast.success("Key removed. Cowork's built-in AI is used again.");
                router.refresh();
              })
            }
          >
            <Trash /> Remove
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Using Cowork&apos;s built-in AI.</p>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveAiKey({ preset: preset as never, apiKey, baseURL: preset === "custom" ? baseURL : undefined, fastModel: fast, smartModel: smart });
            if (!r.ok) return void toast.error(r.error);
            setApiKey("");
            toast.success("Key works and is saved.");
            router.refresh();
          });
        }}
      >
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="ai-preset">Provider</Label>
          <select id="ai-preset" value={preset} onChange={(e) => pick(e.target.value)} className={cn(inputClass, "h-10")}>
            {presets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        {preset === "custom" ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ai-base">API address</Label>
            <Input id="ai-base" placeholder="https://api.example.com/v1" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} required />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ai-key">API key</Label>
            {p.keyUrl ? (
              <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-muted underline-offset-2 hover:underline">
                Get a key <ArrowSquareOut size={12} />
              </a>
            ) : null}
          </div>
          <Input id="ai-key" type="password" autoComplete="off" spellCheck={false} placeholder={current ? "Paste a new key to replace it" : "Paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-fast">Fast model</Label>
          <Input id="ai-fast" value={fast} onChange={(e) => setFast(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-smart">Smart model</Label>
          <Input id="ai-smart" value={smart} onChange={(e) => setSmart(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending || apiKey.length < 8}>
            {pending ? "Testing key…" : current ? "Test and replace" : "Test and save"}
          </Button>
        </div>
      </form>
    </Section>
  );
}
