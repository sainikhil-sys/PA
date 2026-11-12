"use client";

import { useConfirm } from "./confirm";
import * as React from "react";
import { addUserRestriction, liftUserRestriction, revokeUserSessions, setUserSuspended } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { FieldError, Input, inputClass, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAdminCall } from "./users-call";

const FEATURES = [
  { value: "ai", label: "Assistant" },
  { value: "uploads", label: "Uploads" },
  { value: "automations", label: "Automations" },
  { value: "connect", label: "Connect" },
  { value: "community", label: "Community" },
] as const;
type Feature = (typeof FEATURES)[number]["value"];

export function SuspendButton({ userId, suspended }: { userId: string; suspended: boolean }) {
  const { pending, run } = useAdminCall();
  const confirm = useConfirm();
  return (
    <Button
      size="sm"
      variant={suspended ? "secondary" : "danger"}
      disabled={pending}
      onClick={async () => {
        if (!suspended && !(await confirm({ title: "Suspend this account?", message: "They're signed out everywhere and can't sign in until you restore it.", confirmLabel: "Suspend", danger: true }))) return;
        run(() => setUserSuspended({ userId, disabled: !suspended }), { done: suspended ? "Account restored" : "Account suspended" });
      }}
    >
      {suspended ? "Restore account" : "Suspend account"}
    </Button>
  );
}

export function RevokeSessionsButton({ userId, sessions }: { userId: string; sessions: number }) {
  const { pending, run } = useAdminCall();
  const confirm = useConfirm();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || sessions === 0}
      onClick={async () => {
        if (!(await confirm({ title: "Sign out everywhere?", message: `This signs the person out of ${sessions} session${sessions === 1 ? "" : "s"}. They can sign in again with a new code.`, confirmLabel: "Sign out" }))) return;
        run(() => revokeUserSessions({ userId }), { done: (d) => `Signed out of ${d.revoked} session${d.revoked === 1 ? "" : "s"}` });
      }}
    >
      Sign out everywhere
    </Button>
  );
}

export function LiftRestrictionButton({ userId, restrictionId, label }: { userId: string; restrictionId: string; label: string }) {
  const { pending, run } = useAdminCall();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Lift the ${label} restriction`}
      onClick={() => run(() => liftUserRestriction({ userId, restrictionId }), { done: (d) => `${d.feature} is allowed again` })}
    >
      Lift
    </Button>
  );
}

export function RestrictionForm({ userId }: { userId: string }) {
  const { pending, run } = useAdminCall();
  const [feature, setFeature] = React.useState<Feature>("ai");
  const [reason, setReason] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        // datetime-local is the admin's local time; send an absolute instant.
        const expiresAt = until ? new Date(until).toISOString() : null;
        run(() => addUserRestriction({ userId, feature, reason, expiresAt }), {
          done: (d) => `${d.feature} restricted`,
          onError: setError,
          onDone: () => {
            setReason("");
            setUntil("");
          },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[180px_1fr_220px]">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-f`}>Feature</Label>
          <select id={`${id}-f`} value={feature} onChange={(e) => setFeature(e.target.value as Feature)} className={cn(inputClass, "h-10 text-[14px]")}>
            {FEATURES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-r`}>Reason</Label>
          <Input id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Kept in the audit log" className="h-10 text-[14px]" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-u`}>Until (optional)</Label>
          <Input id={`${id}-u`} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="h-10 text-[14px]" />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending || reason.trim().length < 3}>
          {pending ? "Saving" : "Add restriction"}
        </Button>
      </div>
    </form>
  );
}
