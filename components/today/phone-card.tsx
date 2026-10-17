"use client";

import { AppWindow, ArrowRight, BatteryFull, BatteryLow, BatteryMedium, ChatCircleText, DeviceMobile, Lightning, Phone, PhoneIncoming, WhatsappLogo } from "@phosphor-icons/react";
import Link from "next/link";
import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fetcher } from "@/lib/fetcher";
import { KIND_LABEL, type PhoneEventKind, whatsappLink } from "@/lib/phone";
import type { PhoneFeed } from "@/lib/phone-server";
import { cn, timeAgo } from "@/lib/utils";

const ICON: Record<PhoneEventKind, React.ReactNode> = {
  call: <Phone size={15} weight="fill" />,
  sms: <ChatCircleText size={15} weight="fill" />,
  whatsapp: <WhatsappLogo size={15} weight="fill" />,
  notification: <AppWindow size={15} />,
};

/** Today: the linked phone at a glance — status, an incoming call, and the latest calls and messages. */
export function PhoneCard({ initial }: { initial: PhoneFeed }) {
  const { data } = useSWR<PhoneFeed>("/api/phone/feed", fetcher, { fallbackData: initial, refreshInterval: 6000 });
  const feed = data ?? initial;
  const device = feed.devices[0];

  if (!device) {
    return (
      <Card className="h-full">
        <CardHeader icon={<DeviceMobile size={18} />} title="Phone" />
        <CardBody className="flex flex-col items-start gap-2">
          <p className="text-[13px] text-muted">See your Android phone&apos;s calls, SMS and WhatsApp here.</p>
          <Link href="/phone" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[13px] font-medium text-primary-foreground">
            Link your phone <ArrowRight size={14} />
          </Link>
        </CardBody>
      </Card>
    );
  }

  const live = Boolean(device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 3 * 60_000);
  const Battery = device.battery == null ? BatteryMedium : device.battery > 60 ? BatteryFull : device.battery > 20 ? BatteryMedium : BatteryLow;
  // People first: calls, SMS and WhatsApp before other app notifications.
  const people = feed.events.filter((e) => e.kind !== "notification");
  const recent = (people.length >= 3 ? people : feed.events).slice(0, 4);
  const ringing = feed.events.find((e) => e.kind === "call" && Date.now() - new Date(e.postedAt).getTime() < 45_000);
  const unread = feed.events.filter((e) => !e.read && e.kind !== "notification").length;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        icon={<DeviceMobile size={18} />}
        title="Phone"
        description={
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", device.paused ? "bg-warning" : live ? "bg-success" : "bg-border-strong")} aria-hidden />
            {device.name}
            {device.battery != null ? (
              <span className="inline-flex items-center gap-0.5">
                · <Battery size={13} /> {device.battery}%{device.charging ? <Lightning size={10} weight="fill" /> : null}
              </span>
            ) : null}
          </span>
        }
        action={
          <Link href="/phone" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
            {unread ? `${unread} new` : "All"} <ArrowRight size={14} />
          </Link>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-1.5">
        {ringing ? (
          <div role="status" className="flex items-center gap-2.5 rounded-[12px] bg-foreground px-3 py-2 text-background">
            <PhoneIncoming size={18} weight="fill" className="shrink-0 animate-pulse" />
            <span className="min-w-0 truncate text-[13px] font-medium">Call: {ringing.title || "Unknown caller"}</span>
          </div>
        ) : null}
        {recent.length ? (
          <ul className="-mx-1 flex flex-col">
            {recent.map((e) => {
              const kind = e.kind as PhoneEventKind;
              return (
                <li key={e.id}>
                  <a
                    href={kind === "whatsapp" ? whatsappLink(e.title) : "/phone"}
                    {...(kind === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="flex items-center gap-2.5 rounded-[10px] px-1 py-1.5 hover:bg-surface-hover"
                  >
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", kind === "whatsapp" ? "bg-[#25D366] text-white" : kind === "call" ? "bg-foreground text-background" : "bg-surface-2")} aria-label={KIND_LABEL[kind]}>
                      {ICON[kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{e.title || e.appName}</span>
                        <span className="tabular shrink-0 text-[11px] text-subtle">{timeAgo(e.postedAt)}</span>
                      </span>
                      <span className="block truncate text-[12px] text-muted">{e.text || KIND_LABEL[kind]}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{live ? "No calls or messages yet." : "Waiting for your phone. Open Cowork Phone Link on it."}</p>
        )}
      </CardBody>
    </Card>
  );
}
