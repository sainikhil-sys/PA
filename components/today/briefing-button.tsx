"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { generateBriefingNow } from "@/app/actions/briefing";
import { Button } from "@/components/ui/button";

export function GenerateBriefingButton({ label, quiet }: { label: string; quiet?: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant={quiet ? "quiet" : "secondary"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await generateBriefingNow({});
          if (!res.ok) return void toast.error(res.error);
          router.refresh();
        })
      }
    >
      <motion.span animate={pending ? { rotate: 360 } : { rotate: 0 }} transition={pending ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0 }} className="inline-flex">
        <ArrowClockwise />
      </motion.span>
      {pending ? "Building…" : label}
    </Button>
  );
}
