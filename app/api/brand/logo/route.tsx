import { ImageResponse } from "next/og";
import { MARK_ARC, MARK_DOT, MARK_STROKE } from "@/components/layout/mark";

/** Square PNG of the mark on white, e.g. for Google's OAuth consent screen (120px). ?size=120..1024 */
export function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("size") ?? 120);
  const size = Number.isFinite(raw) ? Math.min(1024, Math.max(32, Math.round(raw))) : 120;
  const inner = Math.round(size * 0.72);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <svg width={inner} height={inner} viewBox="0 0 32 32">
          <path d={MARK_ARC} fill="none" stroke="#0a0a0a" strokeWidth={MARK_STROKE} strokeLinecap="round" />
          <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill="#0a0a0a" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=86400", "content-disposition": `inline; filename="cowork-logo-${size}.png"` } },
  );
}
