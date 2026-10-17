"use client";

import { ArrowClockwise, PaperPlaneTilt, Sparkle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { draftBroadcast, retryDeadJob, sendBroadcast, setUserDisabled, testServerAi } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";

export function DisableToggle({ userId, disabled, self }: { userId: string; disabled: boolean; self: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  if (self) return <span className="text-[12px] text-subtle">You</span>;
  return (
    <Button
      size="sm"
      variant={disabled ? "secondary" : "ghost"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!disabled && !window.confirm("Disable this account? They're signed out everywhere and can't sign in until you enable it.")) return;
          const r = await setUserDisabled({ userId, disabled: !disabled });
          if (!r.ok) return void toast.error(r.error);
          toast.success(disabled ? "Account enabled" : "Account disabled");
          router.refresh();
        })
      }
    >
      {disabled ? "Enable" : "Disable"}
    </Button>
  );
}

type Channel = "in_app" | "push" | "email";
const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: "in_app", label: "In-app", hint: "Bell in the top bar" },
  { id: "push", label: "Phones", hint: "Paired devices, if push is on" },
  { id: "email", label: "Email", hint: "If email updates are on" },
];

/** Compose with AI → edit → preview → confirm. Nothing is sent until the confirm click. */
export function BroadcastComposer({ audience }: { audience: number }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [note, setNote] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [href, setHref] = React.useState("");
  const [channels, setChannels] = React.useState<Channel[]>(["in_app", "push", "email"]);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bc-note">Write with AI</Label>
          <Textarea id="bc-note" rows={3} placeholder="e.g. we launched Spotify and YouTube in the Today room, plus phone notifications" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            className="w-fit"
            disabled={pending || note.trim().length < 5}
            onClick={() =>
              start(async () => {
                const r = await draftBroadcast({ prompt: note });
                if (!r.ok) return void toast.error(r.error);
                setTitle(r.data.title);
                setBody(r.data.body);
              })
            }
          >
            <Sparkle /> {pending ? "Writing…" : "Draft it"}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bc-title">Title</Label>
          <Input id="bc-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bc-body">Message</Label>
          <Textarea id="bc-body" rows={4} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bc-href">Opens (optional)</Label>
          <Input id="bc-href" placeholder="/settings/devices" value={href} onChange={(e) => setHref(e.target.value)} />
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="mb-1.5 text-sm">Send to</legend>
          {CHANNELS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={channels.includes(c.id)} onCheckedChange={(v) => setChannels(v ? [...channels, c.id] : channels.filter((x) => x !== c.id))} aria-label={c.label} />
              {c.label} <span className="text-subtle">· {c.hint}</span>
            </label>
          ))}
        </fieldset>
        <Button className="w-fit" disabled={pending || title.trim().length < 3 || body.trim().length < 3 || !channels.length} onClick={() => setConfirmOpen(true)}>
          <PaperPlaneTilt /> Review and send
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-muted">Preview</p>
        <div className="card rounded-[14px] border border-border bg-background p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Announcement</p>
          <p className="mt-1 text-[17px] font-medium">{title || "Your title"}</p>
          <p className="mt-1 whitespace-pre-wrap text-[14px] text-muted">{body || "Your message appears here, as a notification, a phone alert and an email."}</p>
        </div>
        <div className="flex items-start gap-3 rounded-[14px] border border-border bg-surface p-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-foreground text-[13px] font-semibold text-background">C</span>
          <div className="min-w-0 text-[13px]">
            <p className="font-medium">{title || "Your title"}</p>
            <p className="line-clamp-2 text-muted">{body || "Phone notification preview"}</p>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Send this announcement?"
        description={`It goes to ${audience.toLocaleString()} account${audience === 1 ? "" : "s"} via ${channels.map((c) => CHANNELS.find((x) => x.id === c)!.label).join(", ")}. This can't be unsent.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await sendBroadcast({ title, body, href, channels, confirm: true });
                  if (!r.ok) return void toast.error(r.error);
                  setConfirmOpen(false);
                  setTitle("");
                  setBody("");
                  setNote("");
                  toast.success("Sending now. Progress shows below.");
                  router.refresh();
                })
              }
            >
              <PaperPlaneTilt /> Send to everyone
            </Button>
          </>
        }
      >
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">{body}</p>
      </Dialog>
    </div>
  );
}

export function RetryJob({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryDeadJob({ id });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Queued again");
          router.refresh();
        })
      }
    >
      <ArrowClockwise /> Retry
    </Button>
  );
}

export function TestAi({ name }: { name: string }) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult("Testing…");
            const r = await testServerAi({ name });
            if (!r.ok) return void setResult(r.error);
            setResult(r.data.ok ? `Works · ${r.data.latencyMs} ms` : `Failed: ${r.data.error}`);
          })
        }
      >
        Test
      </Button>
      {result ? <span className="text-[12px] text-muted">{result}</span> : null}
    </span>
  );
}
