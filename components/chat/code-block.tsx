"use client";

import { Check, Copy } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { langLabel, MAX_HIGHLIGHT_CHARS, tokenize } from "@/lib/chat/highlight";
import "./code-block.css";

/**
 * A fenced code block with a language label, a copy button and quiet syntax
 * colours. Renders React text nodes only, never HTML.
 */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Re-tokenized on every streamed delta: one O(n) pass, bounded by MAX_HIGHLIGHT_CHARS.
  const tokens = React.useMemo(() => (code.length <= MAX_HIGHLIGHT_CHARS ? tokenize(code, lang) : null), [code, lang]);
  const label = langLabel(lang);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className="pa-code" role="group" aria-label={`${label ?? "Code"} block`}>
      <div className="flex h-9 items-center justify-between border-b border-border pl-3.5 pr-1 text-[12px] text-subtle">
        <span>{label ?? "Code"}</span>
        <button type="button" onClick={() => void copy()} className="pa-code-copy inline-flex h-8 items-center gap-1 rounded-md px-2 text-muted hover:bg-surface-hover hover:text-foreground">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre data-lenis-prevent>
        <code className={lang ? `language-${lang}` : undefined}>
          {tokens
            ? tokens.map((t, i) =>
                t.kind === "plain" ? (
                  <React.Fragment key={i}>{t.text}</React.Fragment>
                ) : (
                  <span key={i} className={`pa-tok-${t.kind}`}>
                    {t.text}
                  </span>
                ),
              )
            : code}
        </code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
