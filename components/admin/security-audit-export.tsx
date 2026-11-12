"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Owner only: saves the filtered audit log as CSV. The server checks the role and records the export. */
export function ExportAuditButton({ filters }: { filters: Record<string, string> }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const res = await fetch("/api/admin/audit/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(filters) });
            const body = (await res.json().catch(() => null)) as { data?: { filename: string; csv: string; rows: number; truncated: boolean }; error?: string } | null;
            if (!res.ok || !body?.data) return void toast.error(body?.error ?? "The export didn't work. Try again.");
            const url = URL.createObjectURL(new Blob([body.data.csv], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = body.data.filename;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(body.data.truncated ? `Exported the newest ${body.data.rows.toLocaleString("en-US")} entries. Narrow the dates to get the rest.` : `Exported ${body.data.rows.toLocaleString("en-US")} entries`);
          } catch {
            toast.error("The export didn't work. Check your connection and try again.");
          }
        })
      }
    >
      <DownloadSimple /> {pending ? "Exporting" : "Export CSV"}
    </Button>
  );
}
