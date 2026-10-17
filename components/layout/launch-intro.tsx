"use client";

import * as React from "react";
import { BRAND } from "@/lib/brand";
import { MARK_ARC, MARK_DOT, MARK_STROKE } from "./mark";

export const INTRO_KEY = "pa:intro-played";

/**
 * Runs before first paint (inline, CSP nonce): marks <html data-intro="1"> only
 * when the intro should play — first open in this browser session, motion allowed.
 * CSS keeps the overlay hidden otherwise, so there is never a flash.
 */
export const INTRO_BOOT_SCRIPT = `try{var d=document.documentElement;if(!sessionStorage.getItem("${INTRO_KEY}")&&!matchMedia("(prefers-reduced-motion: reduce)").matches&&d.dataset.reduceMotion!=="true"){d.dataset.intro="1"}}catch(e){}`;

/**
 * Launch animation (GSAP timeline, ~1.4s): the C draws itself, the dot drops in, the wordmark
 * letters rise, a hairline sweeps beneath, then the overlay lifts away.
 * Transform/opacity only; never blocks input (pointer-events: none).
 */
export function LaunchIntro() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.intro !== "1" || !ref.current || document.visibilityState === "hidden") {
      // Background tabs throttle animation frames; never make the page wait for an intro nobody sees.
      delete root.dataset.intro;
      setDone(true);
      return;
    }
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {}
    let killed = false;
    let tl: { kill: () => void } | undefined;
    import("gsap").then(({ gsap }) => {
      if (killed || !ref.current) return;
      const q = gsap.utils.selector(ref.current);
      const t = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => {
          delete root.dataset.intro;
          setDone(true);
        },
      });
      // The C draws itself, then the dot drops into its opening.
      t.set(q(".pa-intro-mark"), { opacity: 1 })
        .fromTo(q(".pa-intro-arc"), { strokeDasharray: 1, strokeDashoffset: 1, rotate: -90, transformOrigin: "50% 50%" }, { strokeDashoffset: 0, rotate: 0, duration: 0.55, ease: "power2.inOut" })
        .fromTo(q(".pa-intro-dot"), { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.32, ease: "back.out(2.4)" }, "-=0.12")
        .fromTo(q(".pa-intro-letter"), { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.42, stagger: 0.07 }, "-=0.2")
        .fromTo(q(".pa-intro-line"), { scaleX: 0 }, { scaleX: 1, duration: 0.38, ease: "power2.inOut" }, "-=0.18")
        .to(q(".pa-intro-stack"), { y: -10, opacity: 0, duration: 0.3, ease: "power2.in" }, "+=0.12")
        .to(ref.current, { opacity: 0, duration: 0.28, ease: "power1.out" }, "-=0.12");
      tl = t;
    });
    // Hard cap: whatever happens (slow device, throttled frames, failed import), the page is usable within 2.5s.
    const cap = setTimeout(() => {
      delete root.dataset.intro;
      setDone(true);
    }, 2500);
    return () => {
      killed = true;
      clearTimeout(cap);
      tl?.kill();
    };
  }, []);

  if (done) return null;
  return (
    <div ref={ref} className="pa-intro" role="presentation" aria-label={BRAND.name}>
      <div className="pa-intro-stack">
        <svg className="pa-intro-mark" width="64" height="64" viewBox="0 0 32 32">
          <path className="pa-intro-arc" d={MARK_ARC} pathLength={1} fill="none" stroke="var(--primary)" strokeWidth={MARK_STROKE} strokeLinecap="round" />
          <circle className="pa-intro-dot" {...MARK_DOT} fill="var(--primary)" />
        </svg>
        <div className="pa-intro-word">
          {BRAND.wordmark.split("").map((c, i) => (
            <span key={i} className="pa-intro-letter">
              {c}
            </span>
          ))}
        </div>
        <span className="pa-intro-line" />
      </div>
    </div>
  );
}
