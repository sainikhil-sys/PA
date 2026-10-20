"use client";

import { motion, useReducedMotionConfig } from "motion/react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<OrbState, string> = { idle: "Idle", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

/**
 * Calm animated orb (Motion + SVG). Animates only transform and opacity.
 * idle: slow breathing · listening: expanding rings · thinking: orbiting arc · speaking: waveform
 */
export function AgentOrb({ state, size = 160, level = 0 }: { state: OrbState; size?: number; level?: number }) {
  const reduce = useReducedMotionConfig();
  const loop = (duration: number) => (reduce ? { duration: 0 } : { duration, repeat: Infinity, ease: "easeInOut" as const });

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Agent ${LABEL[state].toLowerCase()}`}>
      {state === "listening"
        ? [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full border border-foreground/30"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={reduce ? { scale: 1, opacity: 0.3 } : { scale: [0.6, 1.15], opacity: [0.5, 0] }}
              transition={reduce ? { duration: 0 } : { duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
            />
          ))
        : null}
      <motion.div
        className="absolute rounded-full bg-primary"
        style={{ width: size * 0.62, height: size * 0.62 }}
        animate={
          state === "idle"
            ? { scale: reduce ? 1 : [1, 1.04, 1] }
            : state === "listening"
              ? { scale: 1 + Math.min(level, 1) * 0.12 }
              : state === "thinking"
                ? { scale: reduce ? 0.96 : [0.96, 1, 0.96] }
                : { scale: 1 }
        }
        transition={state === "listening" ? { duration: 0.12 } : loop(state === "idle" ? 4 : 1.6)}
      />
      {state === "thinking" ? (
        <motion.svg className="absolute" width={size * 0.86} height={size * 0.86} viewBox="0 0 100 100" animate={reduce ? {} : { rotate: 360 }} transition={reduce ? {} : { duration: 1.6, repeat: Infinity, ease: "linear" }} aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--border)" strokeWidth="2" />
          <path d="M50 4 A46 46 0 0 1 96 50" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" />
        </motion.svg>
      ) : null}
      {state === "speaking" ? (
        <div className="relative flex items-center gap-[3px]" aria-hidden style={{ height: size * 0.3 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <motion.span
              key={i}
              className="w-[3px] origin-center rounded-full bg-primary-foreground"
              style={{ height: size * 0.28 }}
              animate={reduce ? { scaleY: 0.5 } : { scaleY: [0.25, 1, 0.4, 0.8, 0.25] }}
              transition={reduce ? { duration: 0 } : { duration: 1.1, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
            />
          ))}
        </div>
      ) : (
        <span className="relative size-[18%] rounded-full bg-primary-foreground/90" aria-hidden />
      )}
    </div>
  );
}
