"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { changeAdminRole, grantAdminRole, resetAdminMfa, revokeAdminRole, revokeAdminSession, revokeMyAdminSession } from "@/app/actions/admin-security";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, inputClass, Label } from "@/components/ui/input";
import type { AdminActionResult } from "@/lib/admin/adapters";
import { cn } from "@/lib/utils";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "support", label: "Support" },
  { value: "moderator", label: "Moderator" },
  { value: "analyst", label: "Analyst" },
] as const;
type Role = (typeof ROLES)[number]["value"];

/**
 * Runs a console action. Destructive ones answer first with a plain summary and a one-time token:
 * the person confirms the summary, then the same call commits with the token.
 */
function useAdminCall() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const run = React.useCallback(
    (call: (token?: string) => Promise<AdminActionResult<unknown>>, done: string, onError?: (msg: string) => void) =>
      start(async () => {
        let r = await call();
        if (!r.ok && r.code === "confirm_required" && r.confirm) {
          if (!window.confirm(r.confirm.summary)) return;
          r = await call(r.confirm.token);
        }
        if (!r.ok) {
          if (onError) onError(r.error);
          else toast.error(r.error);
          return;
        }
        toast.success(done);
        router.refresh();
      }),
    [router],
  );
  return { pending, run };
}

export function GrantRoleForm() {
  const { pending, run } = useAdminCall();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("analyst");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <form
      className="card flex flex-col gap-3 rounded-md border border-border bg-background p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        run((token) => grantAdminRole({ email, role, note: note || undefined }, token), "Role given", setError);
      }}
    >
      <p className="text-[14px] font-medium">Give someone a role</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-email`}>Email of their Cowork account</Label>
          <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required maxLength={320} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-role`}>Role</Label>
          <select id={`${id}-role`} className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-note`}>Note (optional)</Label>
        <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why they need access" />
      </div>
      <FieldHint>They need a Cowork account already. You confirm the change before it is saved, and it needs an unlock from the last 10 minutes.</FieldHint>
      <FieldError id={`${id}-error`}>{error}</FieldError>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending || !email.trim()}>
          {pending ? "Saving" : "Give role"}
        </Button>
      </div>
    </form>
  );
}

/** Change or remove a role, and reset two-step verification. Owner only; never shown for the owner row or yourself. */
export function RoleRowActions({ userId, role, hasMfa }: { userId: string; role: Role; hasMfa: boolean }) {
  const { pending, run } = useAdminCall();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label="Change role"
        className={cn(inputClass, "h-9 w-auto py-0 text-[13px]")}
        value={role}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Role;
          run((token) => changeAdminRole({ userId, role: next }, token), "Role changed");
        }}
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => run((token) => revokeAdminRole({ userId }, token), "Role removed")}>
        Remove role
      </Button>
      {hasMfa ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run((token) => resetAdminMfa({ userId }, token), "Two-step verification reset")}>
          Reset two-step
        </Button>
      ) : null}
    </div>
  );
}

/** Ends an admin session. `own`: one of yours (any role); otherwise the owner ends someone else's. */
export function RevokeSessionButton({ id, own, current }: { id: string; own: boolean; current: boolean }) {
  const { pending, run } = useAdminCall();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (current && !window.confirm("This is the session you're using now. Ending it locks the console here.")) return;
        run(() => (own ? revokeMyAdminSession({ id }) : revokeAdminSession({ id })), "Admin session ended");
      }}
    >
      End
    </Button>
  );
}
