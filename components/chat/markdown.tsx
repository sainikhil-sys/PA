"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { codeFromHast } from "@/lib/chat/highlight";
import type { Citation } from "@/lib/db/schema";
import { mapOutsideCode } from "@/lib/knowledge/rank";
import { CodeBlock } from "./code-block";

/**
 * Safe markdown: raw HTML is never rendered (react-markdown escapes it by
 * default), links open in a new tab with noopener, and [n] markers become
 * citation links that only point at retrieved sources.
 */
export function Markdown({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const withCites = mapOutsideCode(text, (p) => p.replace(/\[(\d{1,2})\]/g, (m, n: string) => (citations.some((c) => c.n === Number(n)) ? `[[${n}]](#cite-${n})` : m)));
  return (
    <div className="prose-pa">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) {
              const c = citations.find((x) => x.n === Number(href.slice(6)));
              const cls = "mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border bg-surface px-1 align-[2px] text-[11px] no-underline";
              // A source without a URL is a label, not a dead link.
              if (!c?.url) {
                return (
                  <span className={cls} title={c?.title} aria-label={`Source ${c?.n}: ${c?.title}`}>
                    {c?.n}
                  </span>
                );
              }
              return (
                <a href={c.url} target={c.url.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" className={`${cls} hover:border-foreground`} title={c.title} aria-label={`Source ${c.n}: ${c.title}`}>
                  {c.n}
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
          // Code text comes straight from the hast node, so it never goes through citation rewriting.
          pre: ({ node, children }) => {
            const block = codeFromHast(node);
            return block ? <CodeBlock code={block.code} lang={block.lang} /> : <pre data-lenis-prevent>{children}</pre>;
          },
          img: () => null,
        }}
      >
        {withCites}
      </ReactMarkdown>
    </div>
  );
}
