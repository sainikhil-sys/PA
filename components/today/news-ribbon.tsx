"use client";

import { ArrowSquareOut, Lightbulb, Newspaper, Pause, Play, Sparkle } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { createIdeaFromNews } from "@/app/actions/content";
import { useShell } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { fetcher } from "@/lib/fetcher";
import { cn, timeAgo } from "@/lib/utils";

export type NewsCardData = { id: string; title: string; summary: string; sourceName: string; category: string; url: string; publishedAt: string; image?: string | null };

/**
 * World news ribbon. GSAP drives a seamless marquee (two rows moving in opposite
 * directions on large screens). Pauses on hover/focus, drag to scrub, keyboard
 * focusable. With reduced motion it is a static, natively scrollable list.
 */
export function NewsRibbon({ items: initial }: { items: NewsCardData[] }) {
  // Live: poll quickly while empty (first fetch running), then every 5 minutes.
  const { data } = useSWR<{ items: NewsCardData[] }>("/api/news", fetcher, { fallbackData: { items: initial }, refreshInterval: (d) => (d?.items.length ? 5 * 60_000 : 15_000) });
  const items = data?.items ?? initial;
  const prefersReduced = useReducedMotion();
  const [selected, setSelected] = React.useState<NewsCardData | null>(null);
  const [paused, setPaused] = React.useState(false);

  if (!items.length) {
    return (
      <section aria-label="World news" className="rounded-[16px] border border-border bg-surface">
        <EmptyState compact icon={Newspaper} title="News is on its way" description="Headlines appear after the next refresh. Pick your topics in Settings." />
      </section>
    );
  }


  return (
    <section aria-label="World news" aria-roledescription="news ribbon" className="relative -mx-3 sm:mx-0">
      <div className="mb-1.5 flex items-center justify-between px-3 sm:px-0">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted">World news</h2>
        {!prefersReduced ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground"
            aria-pressed={paused}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
      </div>
      {prefersReduced ? (
        <ul className="no-scrollbar flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:px-0" data-lenis-prevent>
          {items.map((it) => (
            <li key={it.id} className="snap-start">
              <NewsCard item={it} onOpen={setSelected} />
            </li>
          ))}
        </ul>
      ) : (
        // One slim row: the ribbon is a glance, not a feed.
        <div className="[mask-image:linear-gradient(90deg,transparent,black_3%,black_97%,transparent)]">
          <MarqueeRow items={items} direction={-1} onOpen={setSelected} paused={paused || selected !== null} />
        </div>
      )}
      <NewsDrawer item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function MarqueeRow({ items, direction, onOpen, paused }: { items: NewsCardData[]; direction: 1 | -1; onOpen: (i: NewsCardData) => void; paused: boolean }) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const tweenRef = React.useRef<{ pause: () => void; play: () => void; progress: (p?: number) => number; timeScale: (n: number) => void } | null>(null);
  const hoverRef = React.useRef(false);
  const pausedRef = React.useRef(paused);
  const drag = React.useRef<{ x: number; p: number; moved: boolean } | null>(null);

  React.useEffect(() => {
    let killed = false;
    let kill = () => {};
    (async () => {
      const { gsap } = await import("gsap");
      if (killed || !trackRef.current) return;
      const el = trackRef.current;
      const pxPerSec = 40;
      const distance = el.scrollWidth / 2;
      const tween = gsap.fromTo(
        el,
        { xPercent: direction === -1 ? 0 : -50 },
        { xPercent: direction === -1 ? -50 : 0, duration: Math.max(20, distance / pxPerSec), ease: "none", repeat: -1 },
      );
      tweenRef.current = tween as never;
      if (pausedRef.current) tween.pause();
      kill = () => tween.kill();
    })();
    return () => {
      killed = true;
      kill();
    };
  }, [direction, items.length]);

  React.useEffect(() => {
    pausedRef.current = paused;
    if (paused) tweenRef.current?.pause();
    else if (!hoverRef.current) tweenRef.current?.play();
  }, [paused]);

  const hold = (on: boolean) => {
    hoverRef.current = on;
    if (on) tweenRef.current?.pause();
    else if (!pausedRef.current) tweenRef.current?.play();
  };

  return (
    <div
      className="overflow-hidden"
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => {
        drag.current = null;
        hold(false);
      }}
      onFocusCapture={() => hold(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) hold(false);
      }}
      onPointerDown={(e) => {
        if (!tweenRef.current) return;
        drag.current = { x: e.clientX, p: tweenRef.current.progress(), moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const t = tweenRef.current;
        if (!d || !t || !trackRef.current) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 4) d.moved = true;
        const width = trackRef.current.scrollWidth / 2;
        const delta = (dx / width) * (direction === -1 ? -1 : 1);
        t.progress((((d.p + delta) % 1) + 1) % 1);
      }}
      onPointerUp={() => {
        setTimeout(() => (drag.current = null), 0);
      }}
      onClickCapture={(e) => {
        // A drag shouldn't open a card.
        if (drag.current?.moved) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      style={{ touchAction: "pan-y" }}
    >
      <div ref={trackRef} className="flex w-max will-change-transform">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex gap-2 pr-2" aria-hidden={copy === 1 || undefined}>
            {items.map((it) => (
              <li key={`${copy}-${it.id}`}>
                <NewsCard item={it} onOpen={onOpen} hiddenCopy={copy === 1} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

function NewsCard({ item, onOpen, hiddenCopy }: { item: NewsCardData; onOpen: (i: NewsCardData) => void; hiddenCopy?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={hiddenCopy ? -1 : 0}
      onClick={() => onOpen(item)}
      className="group flex h-[72px] w-[288px] items-center gap-3 rounded-[12px] border border-border bg-background/90 p-2 pl-3 text-left transition-[border-color] duration-150 hover:border-border-strong sm:w-[320px]"
    >
      <NewsThumb item={item} className="size-14 rounded-[9px]" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[13px] font-medium leading-[17px]">{item.title}</span>
        <span className="flex items-center gap-1.5 truncate text-[11px] text-muted">
          <span className="truncate">{item.sourceName}</span>
          <span aria-hidden>·</span>
          <span className="tabular shrink-0">{timeAgo(item.publishedAt)}</span>
        </span>
      </span>
    </button>
  );
}

/** Lead image (proxied). Nothing at all when the story has none or it fails to load. */
function NewsThumb({ item, className }: { item: NewsCardData; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (!item.image || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.image} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn("shrink-0 bg-surface-2 object-cover", className)} />
  );
}

function NewsDrawer({ item, onClose }: { item: NewsCardData | null; onClose: () => void }) {
  const { openChat } = useShell();
  const [pending, start] = React.useTransition();
  return (
    <Sheet
      open={item !== null}
      onOpenChange={(o) => !o && onClose()}
      title={item?.title ?? ""}
      description={item ? `${item.sourceName} · ${timeAgo(item.publishedAt)}` : undefined}
      footer={
        item ? (
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await createIdeaFromNews({ newsId: item.id });
                  if (res.ok) toast.success("Added to your idea bank");
                  else toast.error(res.error);
                })
              }
            >
              <Lightbulb /> Turn into LinkedIn idea
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                openChat(`Tell me more about this news and why it matters to me: "${item.title}" (${item.sourceName})`);
              }}
            >
              <Sparkle /> Ask agent about this
            </Button>
          </>
        ) : null
      }
    >
      {item ? (
        <div className="flex flex-col gap-5">
          {item.image ? <NewsThumb item={item} className="aspect-[16/9] w-full rounded-[14px]" /> : null}
          <span className="w-fit rounded-full border border-border px-2.5 py-0.5 text-[12px] capitalize">{item.category}</span>
          <p className="text-[15px] leading-relaxed">{item.summary || "No summary was provided by the source."}</p>
          <p className="text-[13px] text-muted">Cowork shows a short excerpt from the source's feed. Read the full story on the publisher's site.</p>
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className={cn("inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4")}>
            Read on {item.sourceName} <ArrowSquareOut size={16} />
          </a>
        </div>
      ) : null}
    </Sheet>
  );
}
