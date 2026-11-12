"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { measureInfra } from "@/app/actions/admin-infra";
import { Button } from "@/components/ui/button";
import type { ProbeResult } from "@/lib/admin/probes";
import { ProbeGrid } from "./infra-probes";

/** The probes measured by the page, with a button that measures them again. */
export function InfraLive({ initial }: { initial: ProbeResult[] }) {
  const [probes, setProbes] = React.useState(initial);
  const [pending, start] = React.useTransition();
  return (
    <section className="flex flex-col gap-2" aria-label="Live checks">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium">Live checks</h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await measureInfra({});
              if (!r.ok) return void toast.error(r.error);
              setProbes(r.data.probes);
            })
          }
        >
          <ArrowClockwise /> {pending ? "Measuring" : "Measure again"}
        </Button>
      </div>
      <ProbeGrid probes={probes} />
      <p className="text-[11.5px] text-subtle">Measured on request. History isn't stored yet, so a problem that has passed won't show here.</p>
    </section>
  );
}
