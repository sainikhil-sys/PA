import { BRAND } from "@/lib/brand";
import { Mark } from "./mark";

export function Logo({ size = 28, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={size} />
      {withWord ? <span className="text-[17px] font-medium tracking-[-0.02em]">{BRAND.name}</span> : <span className="sr-only">{BRAND.name}</span>}
    </span>
  );
}
