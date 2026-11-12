"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { confirmAdminSetup, lockConsole, requestAdminSetupCode, startAdminSetup, unlockConsole } from "@/app/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/input";

function CodeForm({ label, hint, submit, onDone, autoComplete = "one-time-code", allowRecovery = false }: { label: string; hint?: string; submit: (code: string) => Promise<{ ok: boolean; error?: string }>; onDone: () => void; autoComplete?: string; allowRecovery?: boolean }) {
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const id = React.useId();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await submit(code);
          if (!r.ok) return setError(r.error ?? "That didn't work. Try again.");
          setCode("");
          onDone();
        });
      }}
    >
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode={allowRecovery ? "text" : "numeric"}
        autoComplete={autoComplete}
        autoFocus
        maxLength={20}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="max-w-[220px] font-mono tracking-[0.2em]"
      />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
      <div>
        <Button type="submit" variant="primary" disabled={pending || code.trim().length < 6}>
          {pending ? "Checking" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

/** First visit: confirm by email, scan the QR code, save recovery codes, confirm with a code. */
function Setup() {
  const router = useRouter();
  const [stage, setStage] = React.useState<"start" | "email" | "scan">("start");
  const [setup, setSetup] = React.useState<{ secret: string; qr: string; recoveryCodes: string[] } | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, start] = React.useTransition();

  if (stage === "start") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-muted">Admin work needs a second step on top of your sign-in. Set up an authenticator app (for example Google Authenticator or 1Password) once. After that, you enter a 6-digit code from it to unlock the console.</p>
        <p className="text-[15px] text-muted">First we email a code to your address to confirm it's you.</p>
        <div>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await requestAdminSetupCode();
                if (!r.ok) return void toast.error(r.error);
                setStage("email");
              })
            }
          >
            Email me a code
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "email" || !setup) {
    return (
      <CodeForm
        label="Code from the email"
        hint="It expires in 10 minutes."
        submit={async (code) => {
          const r = await startAdminSetup({ code });
          if (r.ok) setSetup({ secret: r.secret, qr: r.qr, recoveryCodes: r.recoveryCodes });
          return r;
        }}
        onDone={() => setStage("scan")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-medium">1. Add Cowork Admin to your authenticator app</h2>
        <div className="flex flex-wrap items-start gap-4">
          {/* Generated on our server from the secret above; not a remote image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-[10px] border border-border bg-white p-2" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[13px] text-muted">Can't scan? Enter this key instead:</p>
            <code className="select-all break-all font-mono text-[14px] tracking-[0.08em]">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-medium">2. Save your recovery codes</h2>
        <p className="text-[13px] text-muted">Each one unlocks the console once if you lose your phone. They are shown only now. Keep them somewhere safe, like a password manager.</p>
        <ul className="grid max-w-[360px] grid-cols-2 gap-x-6 gap-y-1 rounded-[10px] border border-border p-3 font-mono text-[14px]">
          {setup.recoveryCodes.map((c) => (
            <li key={c} className="select-all">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              void navigator.clipboard.writeText(setup.recoveryCodes.join("\n")).then(
                () => toast.success("Recovery codes copied"),
                () => toast.error("Couldn't copy. Select them and copy by hand."),
              )
            }
          >
            Copy codes
          </Button>
        </div>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />
          I saved my recovery codes
        </label>
      </section>
      {saved ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-medium">3. Confirm</h2>
          <CodeForm label="6-digit code from the app" submit={(code) => confirmAdminSetup({ code })} onDone={() => router.refresh()} />
        </section>
      ) : null}
    </div>
  );
}

export function StepUp({ enrolled, lockedUntil }: { enrolled: boolean; lockedUntil: string | null }) {
  const router = useRouter();
  return (
    <div className="card mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-[14px] border border-border bg-background p-5">
      <h2 className="text-[18px] font-medium">{enrolled ? "Unlock the console" : "Set up two-step verification"}</h2>
      {lockedUntil ? (
        <p role="alert" className="text-[14px] text-danger">
          Admin access is locked after too many wrong codes. Try again after {new Date(lockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
        </p>
      ) : enrolled ? (
        <CodeForm
          label="6-digit code from your authenticator app"
          hint="Lost your phone? Enter one of your recovery codes instead."
          allowRecovery
          submit={(code) => unlockConsole({ code })}
          onDone={() => router.refresh()}
        />
      ) : (
        <Setup />
      )}
    </div>
  );
}

export function LockButton() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="quiet"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await lockConsole();
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      Lock
    </Button>
  );
}
