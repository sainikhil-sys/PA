/**
 * The Cowork mark: an open "C" with a dot resting in its opening.
 * Drawn on a 32-unit grid; the arc spans 270° (center 16,16, radius 10).
 */
export const MARK_ARC = "M23.07 8.93 A10 10 0 1 0 23.07 23.07";
export const MARK_DOT = { cx: 23.2, cy: 16, r: 2.6 };
export const MARK_STROKE = 4.6;

export function Mark({ size = 28, className, color = "var(--primary)" }: { size?: number; className?: string; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <path d={MARK_ARC} fill="none" stroke={color} strokeWidth={MARK_STROKE} strokeLinecap="round" />
      <circle {...MARK_DOT} fill={color} />
    </svg>
  );
}
