import Image from "next/image";
import manifest from "@/public/brands/manifest.json";
import { cn } from "@/lib/utils";

const NAMES: Record<string, string> = { slack: "Slack", linkedin: "LinkedIn", canva: "Canva" };
/** Black single-colour marks: inverted on dark backgrounds so they stay visible. */
const MONO = new Set(["notion", "github", "x", "threads", "vercel", "apple"]);

/**
 * Brand mark in its ORIGINAL colors (from Simple Icons, stored locally).
 * Consistent box, never stretched or tinted. Brands without an available mark
 * fall back to a neutral monogram rather than an imitation logo.
 */
export function BrandLogo({ id, size = 24, className, box = false }: { id: string; size?: number; className?: string; box?: boolean }) {
  const entry = (manifest as Record<string, { title: string }>)[id];
  const inner = entry ? (
    <Image src={`/brands/${id}.svg`} alt={`${entry.title} logo`} width={size} height={size} unoptimized className="object-contain" style={{ width: size, height: size }} />
  ) : (
    <span role="img" aria-label={`${NAMES[id] ?? id} logo`} className="grid place-items-center rounded-[6px] bg-surface-2 text-[11px] font-medium text-muted" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}>
      {(NAMES[id] ?? id).slice(0, 1).toUpperCase()}
    </span>
  );
  const mono = MONO.has(id) && "brand-mono";
  if (!box) return <span className={cn("inline-grid shrink-0 place-items-center", mono, className)}>{inner}</span>;
  return <span className={cn("inline-grid shrink-0 place-items-center rounded-[12px] border border-border bg-background", mono, className)} style={{ width: size + 20, height: size + 20 }}>{inner}</span>;
}
