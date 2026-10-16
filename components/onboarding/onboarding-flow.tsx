"use client";

import { Check } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { completeOnboarding, saveAgentSettings, saveProfile } from "@/app/actions/settings";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PERSONALITIES } from "@/lib/agent/personality";
import { TimezoneSelect } from "@/components/settings/timezone-select";

type Personality = (typeof PERSONALITIES)[number]["id"];

export function OnboardingFlow({
  initial,
  googleConnected,
  resumeAtConnect,
}: {
  initial: { name: string; timezone: string; personality: Personality; agentName: string };
  googleConnected: boolean;
  resumeAtConnect: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(resumeAtConnect ? 1 : 0);
  const [name, setName] = React.useState(initial.name);
  const [timezone, setTimezone] = React.useState(initial.timezone);
  const [personality, setPersonality] = React.useState<Personality>(initial.personality);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    if (initial.timezone === "UTC") {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (guess) setTimezone(guess);
    }
  }, [initial.timezone]);

  const finish = () =>
    start(async () => {
      const res = await completeOnboarding({});
      if (!res.ok) return void toast.error(res.error);
      router.replace("/");
      router.refresh();
    });

  const steps = ["About you", "Connect", "Your agent"];

  return (
    <div className="w-full max-w-[520px]">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <ol className="flex items-center gap-2" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-current={i === step ? "step" : undefined}
                className={cn("grid size-6 place-items-center rounded-full border text-[11px] tabular", i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-foreground" : "border-border text-subtle")}
              >
                {i < step ? <Check size={12} weight="bold" /> : i + 1}
              </span>
              <span className="sr-only">{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-[20px] border border-border bg-background p-8 sm:p-10">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            {step === 0 ? (
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    setError(null);
                    const res = await saveProfile({ name, timezone });
                    if (!res.ok) return setError(res.error);
                    setStep(1);
                  });
                }}
              >
                <div>
                  <h1 className="font-serif text-[28px] leading-tight tracking-[-0.02em]">Let's set things up</h1>
                  <p className="mt-2 text-sm text-muted">Three quick steps. You can change everything later.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">What should we call you?</Label>
                  <Input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={Boolean(error) || undefined} />
                  <FieldError>{error}</FieldError>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tz">Timezone</Label>
                  <TimezoneSelect id="tz" value={timezone} onChange={setTimezone} />
                </div>
                <Button type="submit" variant="primary" size="lg" disabled={pending || !name.trim()}>
                  Continue
                </Button>
              </form>
            ) : step === 1 ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h1 className="font-serif text-[28px] leading-tight tracking-[-0.02em]">Connect your day</h1>
                  <p className="mt-2 text-sm text-muted">Gmail, Calendar and Drive power your briefing. PA reads and creates drafts. It never sends or deletes.</p>
                </div>
                <div className="flex items-center gap-4 rounded-[14px] border border-border p-4">
                  <div className="flex -space-x-1">
                    <BrandLogo id="gmail" size={28} />
                    <BrandLogo id="googlecalendar" size={28} />
                    <BrandLogo id="googledrive" size={28} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Google</p>
                    <p className="text-[13px] text-muted">{googleConnected ? "Connected" : "Read-only, plus drafts"}</p>
                  </div>
                  {googleConnected ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px]">
                      <Check size={16} /> Done
                    </span>
                  ) : (
                    <Button asChild size="sm">
                      <a href="/api/integrations/google/start?returnTo=/onboarding">Connect</a>
                    </Button>
                  )}
                </div>
                <p className="text-[13px] text-muted">More integrations (Notion, Slack, GitHub…) live on the Integrations page.</p>
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    Skip for now
                  </Button>
                  <Button variant="primary" onClick={() => setStep(2)}>
                    Continue
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <div>
                  <h1 className="font-serif text-[28px] leading-tight tracking-[-0.02em]">How should {initial.agentName} sound?</h1>
                  <p className="mt-2 text-sm text-muted">Pick a personality for your agent.</p>
                </div>
                <div role="radiogroup" aria-label="Personality" className="grid grid-cols-2 gap-2">
                  {PERSONALITIES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={personality === p.id}
                      onClick={() => setPersonality(p.id)}
                      className={cn("rounded-[14px] border p-4 text-left transition-colors", personality === p.id ? "border-foreground" : "border-border hover:border-border-strong")}
                    >
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="mt-1 block text-[13px] text-muted">{p.sample}</span>
                    </button>
                  ))}
                </div>
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={finish} disabled={pending}>
                    Skip
                  </Button>
                  <Button
                    variant="primary"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await saveAgentSettings({ personality });
                        finish();
                      })
                    }
                  >
                    Finish setup
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
