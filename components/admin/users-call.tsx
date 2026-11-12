"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { AdminActionResult } from "@/lib/admin/adapters";

/** Summaries that start with this are a refusal, not something to confirm (lib/admin/ops/deletion.ts refusal). */
const REFUSAL = "This can't go ahead: ";

type Call<R> = (token?: string) => Promise<AdminActionResult<R>>;

/**
 * Runs a console action through its server action. Destructive ones answer first with a plain summary
 * and a one-time token; the dialog shows the summary and the same call commits with the token.
 * Users, deletion requests and announcements share it.
 */
export function useAdminCall() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [ask, setAsk] = React.useState<{ summary: string; label: string; commit: () => void } | null>(null);

  const finish = React.useCallback(
    <R,>(r: AdminActionResult<R>, done: string | ((data: R) => string), onError?: (msg: string) => void, onDone?: (data: R) => void) => {
      if (!r.ok) {
        if (onError) onError(r.error);
        else toast.error(r.error);
        // An ended admin session sends the page to the unlock screen on refresh.
        if (r.code === "step_up_required") router.refresh();
        return;
      }
      toast.success(typeof done === "string" ? done : done(r.data));
      onDone?.(r.data);
      router.refresh();
    },
    [router],
  );

  const run = React.useCallback(
    <R,>(call: Call<R>, o: { done: string | ((data: R) => string); confirmLabel?: string; onError?: (msg: string) => void; onDone?: (data: R) => void }) =>
      start(async () => {
        const r = await call();
        if (!r.ok && r.code === "confirm_required" && r.confirm) {
          const { summary, token } = r.confirm;
          if (summary.startsWith(REFUSAL)) {
            const msg = summary.slice(REFUSAL.length);
            if (o.onError) o.onError(msg);
            else toast.error(msg);
            return;
          }
          setAsk({
            summary,
            label: o.confirmLabel ?? "Confirm",
            commit: () =>
              start(async () => {
                const r2 = await call(token);
                setAsk(null);
                finish(r2, o.done, o.onError, o.onDone);
              }),
          });
          return;
        }
        finish(r, o.done, o.onError, o.onDone);
      }),
    [finish],
  );

  const dialog = (
    <Dialog
      open={Boolean(ask)}
      onOpenChange={(open) => {
        if (!open && !pending) setAsk(null);
      }}
      title="Check before you continue"
      description="This takes effect as soon as you confirm."
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={() => setAsk(null)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => ask?.commit()}>
            {pending ? "Working" : (ask?.label ?? "Confirm")}
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-relaxed">{ask?.summary}</p>
    </Dialog>
  );

  return { pending, run, dialog };
}
