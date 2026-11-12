"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { retryDeadJob, setUserDisabled, testServerAi } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { useConfirm } from "./confirm";

export function DisableToggle({ userId, disabled, self }: { userId: string; disabled: boolean; self: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = React.useTransition();
  if (self) return <span className="text-[12px] text-subtle">You</span>;
  return (
    <Button
      size="sm"
      variant={disabled ? "secondary" : "ghost"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!disabled && !(await confirm({ title: "Disable this account?", message: "They're signed out everywhere and can't sign in until you enable it.", confirmLabel: "Disable", danger: true }))) return;
          const r = await setUserDisabled({ userId, disabled: !disabled });
          if (!r.ok) return void toast.error(r.error);
          toast.success(disabled ? "Account enabled" : "Account disabled");
          router.refresh();
        })
      }
    >
      {disabled ? "Enable" : "Disable"}
    </Button>
  );
}

export function RetryJob({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryDeadJob({ id });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Queued again");
          router.refresh();
        })
      }
    >
      <ArrowClockwise /> Retry
    </Button>
  );
}

export function TestAi({ name }: { name: string }) {
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult("Testing…");
            const r = await testServerAi({ name });
            if (!r.ok) return void setResult(r.error);
            setResult(r.data.ok ? `Works · ${r.data.latencyMs} ms` : `Failed: ${r.data.error}`);
          })
        }
      >
        Test
      </Button>
      {result ? <span className="text-[12px] text-muted">{result}</span> : null}
    </span>
  );
}
