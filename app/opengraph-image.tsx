import { ImageResponse } from "next/og";
import { MARK_ARC, MARK_DOT, MARK_STROKE } from "@/components/layout/mark";
import { BRAND } from "@/lib/brand";

export const alt = `${BRAND.name}: AI work assistant`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card (link shares in Slack, X, LinkedIn, iMessage). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: "#ffffff", color: "#0a0a0a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width={112} height={112} viewBox="0 0 32 32">
            <path d={MARK_ARC} fill="none" stroke="#0a0a0a" strokeWidth={MARK_STROKE} strokeLinecap="round" />
            <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill="#0a0a0a" />
          </svg>
          <div style={{ fontSize: 104, fontWeight: 600, letterSpacing: -4 }}>{BRAND.name}</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 44, lineHeight: 1.25, color: "#3f3f46", maxWidth: 900 }}>Morning briefing, inbox triage and Gmail reply drafts, plus your tasks and notes.</div>
        <div style={{ marginTop: 28, fontSize: 28, color: "#71717a" }}>AI work assistant · replies wait as Gmail drafts you send</div>
      </div>
    ),
    size,
  );
}
