"use client";

import { Lock } from "@phosphor-icons/react";
import * as React from "react";
import { decideConsent } from "@/app/actions/oauth";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";

export function ConsentCard({ params, clientName, redirectHost, scopes }: { params: Record<string, string>; clientName: string; redirectHost: string; scopes: { id: string; label: string }[] }) {
  const [picked, setPicked] = React.useState(scopes.map((s) => s.id));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      setError(null);
      const res = await decideConsent({ params, approve, scopes: picked });
      if (!res.ok) return setError(res.error);
      window.location.assign(res.redirect);
    });
  return (
    <div className="w-full max-w-[440px] rounded-[20px] border border-border bg-background p-8">
      <div className="flex items-center justify-center gap-3">
        <BrandLogo id="claude" size={28} box />
        <span className="text-muted" aria-hidden>
          →
        </span>
        <Logo size={48} withWord={false} />
      </div>
      <h1 className="mt-6 text-center font-serif text-[24px] leading-tight">Allow {clientName} to use Cowork?</h1>
      <p className="mt-2 text-center text-[13px] text-muted">It will return to {redirectHost}.</p>
      <fieldset className="mt-6 flex flex-col gap-1">
        <legend className="mb-2 text-[13px] font-medium">Permissions</legend>
        {scopes.map((s) => (
          <label key={s.id} className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox checked={picked.includes(s.id)} onCheckedChange={(v) => setPicked(v ? [...picked, s.id] : picked.filter((x) => x !== s.id))} aria-label={s.label} />
            {s.label}
          </label>
        ))}
      </fieldset>
      <p className="mt-4 flex items-center gap-2 text-[12px] text-muted">
        <Lock size={14} /> It can never send email, post, or delete anything. You can revoke access anytime.
      </p>
      <FieldError>{error}</FieldError>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => decide(false)} disabled={pending}>
          Deny
        </Button>
        <Button variant="primary" onClick={() => decide(true)} disabled={pending || !picked.length}>
          Allow
        </Button>
      </div>
    </div>
  );
}
