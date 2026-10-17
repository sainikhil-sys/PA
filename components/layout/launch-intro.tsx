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
 * Launch animation (GSAP timeline, ~2s): the C draws itself and the dot drops in,
 * then the mark slides left as the wordmark appears beside it, and the overlay lifts.
 * Transform/opacity (plus a light blur) only; never blocks input (pointer-events: none).
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
      const mark = ref.current.querySelector<SVGSVGElement>(".pa-intro-mark")!;
      const arc = ref.current.querySelector<SVGPathElement>(".pa-intro-arc")!;
      const word = ref.current.querySelector<HTMLElement>(".pa-intro-word")!;
      // Real path length in user units; the gap is longer than the dash so the round cap
      // never shows as a stray dot before the stroke starts drawing.
      const len = arc.getTotalLength();
      const gap = parseFloat(getComputedStyle(ref.current.querySelector(".pa-intro-stack")!).columnGap) || 14;
      // The mark starts centred on screen, then slides left as the wordmark appears beside it.
      const centre = (word.offsetWidth + gap) / 2;

      t.set(mark, { x: centre })
        .set(arc, { opacity: 1, strokeDasharray: `${len} ${len + 20}`, strokeDashoffset: len + 10 })
        .fromTo(mark, { rotate: -140, scale: 0.9 }, { rotate: 0, scale: 1, duration: 0.7, ease: "power3.out" }, 0)
        .to(arc, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, 0)
        .fromTo(q(".pa-intro-dot"), { opacity: 1, scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.34, ease: "back.out(2.6)" }, 0.5)
        .to(mark, { x: 0, duration: 0.5, ease: "power3.inOut" }, 0.86)
        // Letters start only once the mark has cleared the word, so the two never overlap.
        .fromTo(q(".pa-intro-letter"), { opacity: 0, x: -10, filter: "blur(3px)" }, { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.4, stagger: 0.045, ease: "power2.out" }, 1.3)
        .to(q(".pa-intro-stack"), { opacity: 0, scale: 0.97, duration: 0.3, ease: "power2.in" }, "+=0.38")
        .to(ref.current, { opacity: 0, duration: 0.26, ease: "power1.out" }, "-=0.1");
      tl = t;
      // Dev only: lets the timeline be scrubbed from the console when tuning the intro.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __introTl?: unknown }).__introTl = t;
    });
    // Hard cap: whatever happens (slow device, throttled frames, failed import), the page is usable within 3.4s.
    const cap = setTimeout(() => {
      if (process.env.NODE_ENV !== "production" && sessionStorage.getItem("pa:intro-hold")) return;
      delete root.dataset.intro;
      setDone(true);
    }, 3400);
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
        <svg className="pa-intro-mark" viewBox="0 0 32 32">
          <path className="pa-intro-arc" d={MARK_ARC} fill="none" stroke="var(--primary)" strokeWidth={MARK_STROKE} strokeLinecap="round" />
          <circle className="pa-intro-dot" {...MARK_DOT} fill="var(--primary)" />
        </svg>
        <div className="pa-intro-word">
          {BRAND.wordmark.split("").map((c, i) => (
            <span key={i} className="pa-intro-letter">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
