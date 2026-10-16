"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "@/lib/db/schema";

/**
 * Safe markdown: raw HTML is never rendered (react-markdown escapes it by
 * default), links open in a new tab with noopener, and [n] markers become
 * citation links that only point at retrieved sources.
 */
export function Markdown({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const withCites = text.replace(/\[(\d{1,2})\]/g, (m, n: string) => (citations.some((c) => c.n === Number(n)) ? `[[${n}]](#cite-${n})` : m));
  return (
    <div className="prose-pa">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) {
              const c = citations.find((x) => x.n === Number(href.slice(6)));
              return (
                <a
                  href={c?.url ?? "#"}
                  target={c?.url?.startsWith("http") ? "_blank" : undefined}
                  rel="noopener noreferrer nofollow"
                  className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border bg-surface px-1 align-[2px] text-[11px] no-underline hover:border-foreground"
                  title={c?.title}
                  aria-label={`Source ${c?.n}: ${c?.title}`}
                >
                  {c?.n}
                </a>
              );
            }
            const safe = href && /^(https?:|mailto:|\/)/.test(href) ? href : undefined;
            return (
              <a href={safe} target={safe?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
          pre: ({ children }) => <pre data-lenis-prevent>{children}</pre>,
          img: () => null,
        }}
      >
        {withCites}
      </ReactMarkdown>
    </div>
  );
}
