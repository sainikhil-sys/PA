"use client";

import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { requestCodeAction, verifyCodeAction } from "@/app/actions/auth";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { OtpInput } from "./otp-input";

const RESEND_SECONDS = 30;
const STALE_KEY = "pa:login-retry";

export function LoginFlow({ next }: { next?: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [resendIn, setResendIn] = React.useState(0);

  // After a deploy, a page opened earlier can no longer reach the server (its form actions
  // changed). Reload once, keeping the email, instead of failing silently.
  const staleReload = () => {
    try {
      if (sessionStorage.getItem(STALE_KEY)) {
        sessionStorage.removeItem(STALE_KEY);
        setError("We couldn't reach Cowork. Check your connection and try again.");
        return;
      }
      sessionStorage.setItem(STALE_KEY, email);
    } catch {}
    setError("Cowork was just updated. Reloading…");
    window.location.reload();
  };

  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STALE_KEY);
      if (saved) {
        setEmail(saved);
        setNotice("Cowork was updated. Press Continue again to get your code.");
        setTimeout(() => sessionStorage.removeItem(STALE_KEY), 30_000);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = () =>
    startTransition(async () => {
      setError(null);
      const res = await requestCodeAction(email).catch(() => null);
      if (!res) return staleReload();
      if (!res.ok) return setError(res.message);
      setNotice(res.message);
      setStep("code");
      setCode("");
      setResendIn(RESEND_SECONDS);
    });

  const verify = (value: string) =>
    startTransition(async () => {
      setError(null);
      const res = await verifyCodeAction(email, value).catch(() => null);
      if (!res) return staleReload();
      if (!res.ok) {
        setError(res.message);
        setCode("");
        return;
      }
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(res.redirectTo === "/onboarding" ? "/onboarding" : (safeNext ?? "/"));
      router.refresh();
    });

  const slide = (dir: 1 | -1) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : { initial: { opacity: 0, x: 16 * dir }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 * dir } };

  return (
    <div className="w-full max-w-[400px] rounded-[20px] border border-border bg-background p-5 sm:p-10">
      <div className="mb-8 flex justify-center">
        <Logo size={36} withWord={false} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.form
            key="email"
            {...slide(1)}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
            className="flex flex-col gap-5"
            noValidate
          >
            <div className="text-center">
              <h1 className="font-serif text-[28px] leading-tight tracking-[-0.02em]">Welcome back</h1>
              <p className="mt-2 text-sm text-muted">Enter your email and we'll send you a sign-in code.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "email-error" : undefined}
              />
              <FieldError id="email-error">{error}</FieldError>
            </div>
            <Button type="submit" variant="primary" size="lg" disabled={pending || !email}>
              {pending ? "Sending…" : "Continue"}
            </Button>
          </motion.form>
        ) : (
          <motion.div key="code" {...slide(1)} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col gap-6">
            <div className="text-center">
              <span className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-border bg-surface text-muted">
                <EnvelopeSimple size={20} />
              </span>
              <h1 className="font-serif text-[28px] leading-tight tracking-[-0.02em]">Check your email</h1>
              <p className="mt-2 text-sm text-muted">
                {notice} Enter the 6-digit code sent to <span className="text-foreground">{email}</span>.
              </p>
            </div>
            <OtpInput value={code} onChange={setCode} onComplete={verify} disabled={pending} invalid={Boolean(error)} />
            <div aria-live="polite" className="min-h-5 text-center">
              {error ? <p className="text-[13px] text-danger">{error}</p> : pending ? <p className="text-[13px] text-muted">Checking…</p> : null}
            </div>
            <Button variant="primary" size="lg" disabled={pending || code.length !== 6} onClick={() => verify(code)}>
              Sign in
            </Button>
            <div className="flex items-center justify-between text-[13px]">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
                className="inline-flex h-11 items-center gap-1.5 text-muted hover:text-foreground"
              >
                <ArrowLeft size={16} /> Change email
              </button>
              <button type="button" onClick={sendCode} disabled={resendIn > 0 || pending} className="h-11 text-muted hover:text-foreground disabled:hover:text-muted">
                {resendIn > 0 ? <span className="tabular">Resend in {resendIn}s</span> : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
