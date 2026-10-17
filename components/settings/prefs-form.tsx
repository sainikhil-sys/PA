"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { sendTestTelegram } from "@/app/actions/notifications";
import { savePreferences } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { inputClass } from "@/components/ui/input";
import { NEWS_TOPICS } from "@/lib/news/parse";
import { cn } from "@/lib/utils";
import { Row, Section } from "./section";

type Prefs = {
  notifyInApp: boolean;
  notifyEmailDigest: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  notifyTelegram: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  briefingTime: string;
  newsTopics: string[];
  fontScale: string;
  density: string;
  reduceMotion: boolean;
};

function useSave() {
  const router = useRouter();
  const [, start] = React.useTransition();
  return (patch: Partial<Prefs>) =>
    start(async () => {
      const res = await savePreferences(patch as never);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
}

export function NotificationsForm({ initial, telegramConfigured, telegramAllowed, digestAvailable }: { initial: Prefs; telegramConfigured: boolean; telegramAllowed: boolean; digestAvailable: boolean }) {
  const [p, setP] = React.useState(initial);
  const save = useSave();
  const set = (patch: Partial<Prefs>) => {
    setP({ ...p, ...patch });
    save(patch);
  };
  return (
    <div>
      <Section title="Channels">
        <Row label="In-app" hint="The bell in the top bar.">
          <Switch checked={p.notifyInApp} onCheckedChange={(v) => set({ notifyInApp: v })} aria-label="In-app notifications" />
        </Row>
        <Row label="Phone & browser" hint="Push notifications to devices you paired in Settings → Devices.">
          <Switch checked={p.notifyPush} onCheckedChange={(v) => set({ notifyPush: v })} aria-label="Push notifications" />
        </Row>
        <Row label="Email updates" hint={digestAvailable ? "Reminders, scheduled posts and automation alerts, sent to your sign-in address." : "Email isn't available right now."}>
          <Switch checked={p.notifyEmail} disabled={!digestAvailable} onCheckedChange={(v) => set({ notifyEmail: v })} aria-label="Email updates" />
        </Row>
        <Row label="Email digest" hint={digestAvailable ? "Your daily briefing, emailed to you each morning." : "Email isn't available right now."}>
          <Switch checked={p.notifyEmailDigest} disabled={!digestAvailable} onCheckedChange={(v) => set({ notifyEmailDigest: v })} aria-label="Email digest" />
        </Row>
        {telegramAllowed ? (
        <Row label="Telegram" hint={telegramConfigured ? "Urgent mail, reminders and failures to your own chat." : "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable."}>
          <div className="flex items-center gap-2 sm:justify-end">
            {telegramConfigured ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await sendTestTelegram({});
                  if (r.ok) toast.success("Test sent");
                  else toast.error(r.error);
                }}
              >
                Send test
              </Button>
            ) : null}
            <Switch checked={p.notifyTelegram} disabled={!telegramConfigured} onCheckedChange={(v) => set({ notifyTelegram: v })} aria-label="Telegram notifications" />
          </div>
        </Row>
        ) : null}
      </Section>
      <Section title="Quiet hours" description="Email and Telegram stay silent in this window. In-app notifications still collect.">
        <Row label="From – to">
          <div className="flex items-center gap-2 sm:justify-end">
            <input type="time" aria-label="Quiet hours start" defaultValue={p.quietHoursStart ?? ""} onBlur={(e) => set({ quietHoursStart: e.target.value || null })} className={cn(inputClass, "w-auto")} />
            <span className="text-muted">–</span>
            <input type="time" aria-label="Quiet hours end" defaultValue={p.quietHoursEnd ?? ""} onBlur={(e) => set({ quietHoursEnd: e.target.value || null })} className={cn(inputClass, "w-auto")} />
          </div>
        </Row>
      </Section>
      <Section title="Briefing & news">
        <Row label="Daily briefing time" hint="In your timezone.">
          <input type="time" aria-label="Briefing time" defaultValue={p.briefingTime} onBlur={(e) => e.target.value && set({ briefingTime: e.target.value })} className={cn(inputClass, "w-auto")} />
        </Row>
        <div>
          <p className="mb-3 text-sm">News topics</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NEWS_TOPICS.map((t) => (
              <li key={t}>
                <label className="flex min-h-11 items-center gap-2 rounded-[10px] border border-border px-3 text-sm capitalize">
                  <Checkbox
                    checked={p.newsTopics.includes(t)}
                    onCheckedChange={(v) => set({ newsTopics: v ? [...p.newsTopics, t] : p.newsTopics.filter((x) => x !== t) })}
                    aria-label={t}
                  />
                  {t}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </div>
  );
}

export function AppearanceForm({ initial }: { initial: Prefs }) {
  const [p, setP] = React.useState(initial);
  const save = useSave();
  const set = (patch: Partial<Prefs>) => {
    setP({ ...p, ...patch });
    save(patch);
  };
  return (
    <Section title="Appearance" description="Light mode for now. Every color is a token, so a dark theme can come later.">
      <Row label="Text size">
        <Segmented id="font" label="Text size" value={p.fontScale as "sm" | "md" | "lg"} onChange={(v) => set({ fontScale: v })} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Default" }, { value: "lg", label: "Large" }]} />
      </Row>
      <Row label="Density">
        <Segmented id="density" label="Density" value={p.density as "comfortable" | "compact"} onChange={(v) => set({ density: v })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
      </Row>
      <Row label="Reduce motion" hint="Turns off smooth scrolling, the news marquee and decorative animation. Your system setting is respected too.">
        <Switch checked={p.reduceMotion} onCheckedChange={(v) => set({ reduceMotion: v })} aria-label="Reduce motion" />
      </Row>
    </Section>
  );
}
