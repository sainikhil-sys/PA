"use client";

import * as React from "react";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FALLBACK = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

export function TimezoneSelect({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const zones = React.useMemo(() => {
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
      const list = all?.length ? all : FALLBACK;
      return list.includes(value) ? list : [value, ...list];
    } catch {
      return FALLBACK;
    }
  }, [value]);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, "appearance-none bg-[length:16px] pr-9")}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
