export function Logo({ size = 28, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="var(--primary)" />
        <circle cx="16" cy="16" r="6.5" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.2" />
        <circle cx="16" cy="16" r="2" fill="var(--primary-foreground)" />
      </svg>
      {withWord ? <span className="text-[17px] font-medium tracking-[-0.02em]">Cowork</span> : <span className="sr-only">Cowork</span>}
    </span>
  );
}
