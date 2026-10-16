"use client";

import * as React from "react";

/** GSAP count-up for stat numbers (lazy-loaded; static under reduced motion). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true";
    if (reduce || value === 0) {
      el.textContent = String(value);
      return;
    }
    let tween: { kill: () => void } | undefined;
    let cancelled = false;
    import("gsap").then(({ gsap }) => {
      if (cancelled) return;
      const state = { n: 0 };
      tween = gsap.to(state, { n: value, duration: 0.8, ease: "power2.out", onUpdate: () => (el.textContent = String(Math.round(state.n))) });
    });
    return () => {
      cancelled = true;
      tween?.kill();
    };
  }, [value]);
  return (
    <span ref={ref} className={`tabular ${className ?? ""}`} aria-label={String(value)}>
      {value}
    </span>
  );
}
