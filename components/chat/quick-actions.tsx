"use client";

import { CaretDown, Code, ListBullets, PencilSimpleLine, Translate } from "@phosphor-icons/react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { TRANSFORM_LABEL, TRANSLATE_LANGUAGES, transformsFor, type AttachmentKind, type TransformKind, type TranslateLanguage } from "@/lib/chat/attachments";

const chip =
  "inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-45 sm:h-8 sm:text-[12px] [&_svg]:size-[14px]";

const ICON = { summarize: ListBullets, rewrite: PencilSimpleLine, explain: Code, translate: Translate } as const;

/** One-tap actions on an attachment or paste. They run without planning or tools, so nothing can be proposed. */
export function QuickActions({ kind, disabled, onRun }: { kind: AttachmentKind; disabled?: boolean; onRun: (k: TransformKind, language?: TranslateLanguage) => void }) {
  return (
    <div role="group" aria-label="Quick actions" className="flex flex-wrap items-center gap-2">
      {transformsFor(kind).map((t) => {
        const Icon = ICON[t];
        if (t === "translate") {
          return (
            <Menu key={t}>
              <MenuTrigger asChild>
                <button type="button" className={chip} disabled={disabled}>
                  <Icon /> {TRANSFORM_LABEL[t]} <CaretDown />
                </button>
              </MenuTrigger>
              <MenuContent align="start" side="top">
                <MenuLabel>Translate into</MenuLabel>
                {TRANSLATE_LANGUAGES.map((l) => (
                  <MenuItem key={l} onSelect={() => onRun("translate", l)}>
                    {l}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          );
        }
        return (
          <button key={t} type="button" className={chip} disabled={disabled} onClick={() => onRun(t)}>
            <Icon /> {TRANSFORM_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}
