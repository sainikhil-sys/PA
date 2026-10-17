"use client";

import { ArrowSquareOut, BatteryFull, BatteryLow, BatteryMedium, ChatCircleText, Check, CopySimple, DeviceMobile, Lightning, LinkBreak, MagnifyingGlass, Pause, Phone, PhoneIncoming, Play, Trash, WhatsappLogo, AppWindow } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { clearPhoneEvents, createPhonePairCode, markPhoneRead, setPhonePaused, unlinkPhone } from "@/app/actions/phone";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fetcher } from "@/lib/fetcher";
import { callBackLink, KIND_LABEL, type PhoneEventKind, whatsappLink } from "@/lib/phone";
import type { PhoneFeed } from "@/lib/phone-server";
import { cn, timeAgo } from "@/lib/utils";

type Feed = PhoneFeed;
type Event = Feed["events"][number];
type Device = Feed["devices"][number];

const FILTERS: { id: "all" | PhoneEventKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "call", label: "Calls" },
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "notification", label: "Apps" },
];

const online = (d: Device) => Boolean(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 3 * 60_000);

export function PhoneView({ initial, apkUrl }: { initial: Feed; apkUrl: string | null }) {
  const { data, mutate } = useSWR<Feed>("/api/phone/feed", fetcher, { fallbackData: initial, refreshInterval: 4000 });
  const feed = data ?? initial;
  const seen = React.useRef(new Set(initial.events.map((e) => e.id)));

  // Toast new calls and messages while the page is open.
  React.useEffect(() => {
    for (const e of feed.events) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (Date.now() - new Date(e.postedAt).getTime() < 60_000 && e.kind !== "notification") toast(`${KIND_LABEL[e.kind as PhoneEventKind]}: ${e.title || e.appName}`, { description: e.text.slice(0, 120) });
    }
  }, [feed.events]);

  React.useEffect(() => {
    if (feed.events.some((e) => !e.read)) void markPhoneRead({});
  }, [feed.events]);

  if (!feed.devices.length) return <PairWizard apkUrl={apkUrl} onLinked={() => void mutate()} />;
  return <LinkedView feed={feed} apkUrl={apkUrl} refresh={() => void mutate()} />;
}

/* ---------------------------------- Linked ---------------------------------- */

function LinkedView({ feed, apkUrl, refresh }: { feed: Feed; apkUrl: string | null; refresh: () => void }) {
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: feed.events.length };
    for (const e of feed.events) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [feed.events]);
  const shown = feed.events.filter((e) => (filter === "all" || e.kind === filter) && (`${e.title} ${e.text} ${e.appName}`.toLowerCase().includes(q.trim().toLowerCase())));
  const ringing = feed.events.find((e) => e.kind === "call" && Date.now() - new Date(e.postedAt).getTime() < 45_000);

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      {/* Phone status: compact bar on mobile, sticky side card on desktop */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-20">
        {feed.devices.map((d) => (
          <DeviceCard key={d.id} d={d} refresh={refresh} />
        ))}
        <div className="hidden lg:block">
          {addOpen ? <PairWizard apkUrl={apkUrl} compact onLinked={() => (setAddOpen(false), refresh())} /> : (
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
              <DeviceMobile /> Link another phone
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {ringing ? (
          <div role="status" className="card flex items-center gap-3 rounded-[16px] border border-foreground bg-background px-4 py-3">
            <span className="grid size-10 shrink-0 animate-pulse place-items-center rounded-full bg-foreground text-background">
              <PhoneIncoming size={20} weight="fill" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted">Call on your phone</p>
              <p className="truncate text-[15px] font-medium">{ringing.title || "Unknown caller"}</p>
            </div>
            {callBackLink(ringing.title) ? (
              <Button size="sm" variant="secondary" asChild>
                <a href={callBackLink(ringing.title)!}>Call back</a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Filters: horizontal chips (scroll on phones) + search */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn("flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px]", filter === f.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-border-strong")}
              >
                {f.label}
                <span className={cn("tabular text-[11px]", filter === f.id ? "text-background/70" : "text-muted")}>{counts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto sm:w-60">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search phone activity" className="h-9 w-full rounded-full border border-border bg-background pl-8 pr-3 text-[13px] outline-none focus:border-foreground" />
          </div>
        </div>

        <Card>
          <CardHeader
            title="Activity"
            description="From the last 3 days. Older items are deleted automatically."
            action={
              feed.events.length ? (
                <ClearButton refresh={refresh} />
              ) : null
            }
          />
          <CardBody className="px-2 sm:px-3">
            {shown.length ? (
              <ul className="flex flex-col">
                {shown.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <ChatCircleText size={28} className="text-muted" />
                <p className="text-sm font-medium">{feed.events.length ? "Nothing matches" : "Waiting for activity"}</p>
                <p className="max-w-sm text-[13px] text-muted">{feed.events.length ? "Try another filter or search." : "Calls, SMS, WhatsApp and app notifications on your phone show up here within seconds."}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ClearButton({ refresh }: { refresh: () => void }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        window.confirm("Delete all phone activity from Cowork? It stays on your phone.") &&
        start(async () => {
          const r = await clearPhoneEvents({});
          if (!r.ok) return void toast.error(r.error);
          refresh();
        })
      }
    >
      <Trash /> Clear
    </Button>
  );
}

const KIND_ICON: Record<PhoneEventKind, React.ReactNode> = {
  call: <Phone size={18} weight="fill" />,
  sms: <ChatCircleText size={18} weight="fill" />,
  whatsapp: <WhatsappLogo size={18} weight="fill" />,
  notification: <AppWindow size={18} />,
};

function EventRow({ e }: { e: Event }) {
  const kind = e.kind as PhoneEventKind;
  const tel = callBackLink(e.title);
  return (
    <li className={cn("flex items-start gap-3 rounded-[12px] px-2 py-2.5", !e.read && "bg-surface")}>
      <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", kind === "whatsapp" ? "bg-[#25D366] text-white" : kind === "call" ? "bg-foreground text-background" : "bg-surface-2 text-foreground")} aria-hidden>
        {KIND_ICON[kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{e.title || e.appName}</p>
          <time className="tabular shrink-0 text-[11.5px] text-muted" dateTime={e.postedAt}>
            {timeAgo(e.postedAt)}
          </time>
        </div>
        <p className="truncate text-[11.5px] text-subtle">{kind === "notification" ? e.appName : KIND_LABEL[kind]}</p>
        {e.text ? <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-muted">{e.text}</p> : null}
        {kind === "whatsapp" || (kind === "call" && tel) || (kind === "sms" && tel) ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {kind === "whatsapp" ? (
              <a href={whatsappLink(e.title)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] hover:border-foreground/60">
                <WhatsappLogo size={14} /> Open in WhatsApp <ArrowSquareOut size={12} />
              </a>
            ) : null}
            {tel && kind === "call" ? (
              <a href={tel} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] hover:border-foreground/60">
                <Phone size={14} /> Call back
              </a>
            ) : null}
            {tel && kind === "sms" ? (
              <a href={`sms:${tel.slice(4)}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] hover:border-foreground/60">
                <ChatCircleText size={14} /> Reply by SMS
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function DeviceCard({ d, refresh }: { d: Device; refresh: () => void }) {
  const [pending, start] = React.useTransition();
  const live = online(d);
  const Battery = d.battery == null ? BatteryMedium : d.battery > 60 ? BatteryFull : d.battery > 20 ? BatteryMedium : BatteryLow;
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Something went wrong");
      if (ok) toast.success(ok);
      refresh();
    });
  return (
    <div className="card flex items-center gap-3 rounded-[16px] border border-border bg-background p-3 lg:flex-col lg:items-stretch lg:p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-[14px] bg-surface-2">
          <DeviceMobile size={22} />
          <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-background", d.paused ? "bg-warning" : live ? "bg-success" : "bg-border-strong")} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{d.name}</p>
          <p className="flex items-center gap-1.5 truncate text-[12px] text-muted">
            {d.paused ? "Paused" : live ? "Connected" : d.lastSeenAt ? `Last seen ${timeAgo(d.lastSeenAt)}` : "Waiting for the app"}
            {d.battery != null ? (
              <span className="inline-flex items-center gap-0.5">
                · <Battery size={14} /> {d.battery}%{d.charging ? <Lightning size={11} weight="fill" /> : null}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1 lg:mt-1">
        <Button size="sm" variant="ghost" disabled={pending} aria-label={d.paused ? "Resume" : "Pause"} onClick={() => act(() => setPhonePaused({ id: d.id, paused: !d.paused }), d.paused ? "Resumed" : "Paused")}>
          {d.paused ? <Play /> : <Pause />}
          <span className="hidden lg:inline">{d.paused ? "Resume" : "Pause"}</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label="Unlink phone"
          onClick={() => window.confirm(`Unlink ${d.name}? Its activity is deleted from Cowork.`) && act(() => unlinkPhone({ id: d.id }), "Phone unlinked")}
        >
          <LinkBreak />
          <span className="hidden lg:inline">Unlink</span>
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- Pairing --------------------------------- */

const STEPS = ["Install the app", "Enter the code", "Allow notification access", "Linked"];

function PairWizard({ apkUrl, onLinked, compact }: { apkUrl: string | null; onLinked: () => void; compact?: boolean }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [code, setCode] = React.useState<{ code: string; expiresAt: string } | null>(null);
  const [pending, start] = React.useTransition();
  const [copied, setCopied] = React.useState(false);

  const getCode = () =>
    start(async () => {
      const r = await createPhonePairCode({});
      if (!r.ok) return void toast.error(r.error);
      setCode(r.data);
      setStep(1);
    });

  // While a code is showing, watch for the phone to appear.
  React.useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      const r = await fetch("/api/phone/feed", { cache: "no-store" }).then((x) => (x.ok ? (x.json() as Promise<Feed>) : null)).catch(() => null);
      const fresh = r?.devices.find((d) => Date.now() - new Date(d.createdAt).getTime() < 15 * 60_000);
      if (fresh) {
        clearInterval(t);
        setStep(fresh.lastSeenAt && fresh.battery != null ? 3 : 2);
        toast.success(`${fresh.name} is linked`);
        setTimeout(() => {
          onLinked();
          router.refresh();
        }, 1500);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [code, onLinked, router]);

  return (
    <Card className={cn(!compact && "mx-auto w-full max-w-2xl")}>
      <CardHeader icon={<DeviceMobile size={18} />} title="Link your Android phone" description="See calls, SMS, WhatsApp and app notifications from your phone here, live." />
      <CardBody className="flex flex-col gap-4">
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-col gap-1">
              <span className={cn("h-1 rounded-full", i <= step ? "bg-foreground" : "bg-surface-2")} />
              <span className={cn("hidden text-[11.5px] sm:block", i === step ? "font-medium text-foreground" : "text-muted")}>{s}</span>
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-muted sm:hidden">
          Step {step + 1} of 4 · {STEPS[step]}
        </p>

        {step === 0 ? (
          <div className="flex flex-col gap-3 text-[14px]">
            <p>Install <strong>Cowork Phone Link</strong> on your Android phone. It forwards your phone&apos;s notifications to Cowork and nothing else.</p>
            {apkUrl ? (
              <Button asChild className="w-fit">
                <a href={apkUrl}>Download the app (APK)</a>
              </Button>
            ) : (
              <p className="rounded-[12px] bg-surface p-3 text-[13px] text-muted">The app download isn&apos;t published yet. Ask the Cowork admin for the APK file.</p>
            )}
            <p className="text-[12px] text-muted">Android may ask you to allow installing apps from your browser. iPhone isn&apos;t supported: Apple doesn&apos;t let apps read other apps&apos; notifications.</p>
            <Button variant="secondary" className="w-fit" disabled={pending} onClick={getCode}>
              I&apos;ve installed it — show my code
            </Button>
          </div>
        ) : null}

        {step >= 1 && code ? (
          <div className="flex flex-col items-start gap-3 text-[14px]">
            {step === 1 ? <p>Open Cowork Phone Link on your phone and enter this code:</p> : null}
            <div className="flex items-center gap-2">
              <span className="tabular rounded-[14px] border border-border px-4 py-2.5 font-mono text-[28px] font-semibold tracking-[0.3em] sm:text-[34px]">{code.code}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Copy code"
                onClick={() => {
                  void navigator.clipboard?.writeText(code.code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <CopySimple />}
              </Button>
            </div>
            <p className="text-[12px] text-muted">Valid for 10 minutes, works once. This page updates by itself when your phone links.</p>
          </div>
        ) : null}

        {step >= 2 ? (
          <div className="rounded-[12px] bg-surface p-3 text-[13px]">
            <p className="font-medium">Allow notification access</p>
            <p className="mt-1 text-muted">The app opens Android&apos;s “Notification access” screen. Turn on Cowork Phone Link, then come back. If you use WhatsApp, open it once so its notifications start flowing.</p>
          </div>
        ) : null}

        {step === 3 ? (
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Check size={18} /> Linked. New calls and messages will appear here.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
