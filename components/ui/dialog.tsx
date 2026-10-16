"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Dialog and Sheet (side drawer) on Radix for a11y, animated with Motion.
 * Inner content scrolls natively (data-lenis-prevent).
 */

const EASE = [0.16, 1, 0.3, 1] as const;

type BaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  hideTitle?: boolean;
};

export function Dialog({ open, onOpenChange, title, description, children, footer, className, hideTitle }: BaseProps) {
  const reduce = useReducedMotion();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                data-lenis-prevent
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] max-w-lg overflow-y-auto rounded-[16px] border border-border bg-background p-6 shadow-pop focus:outline-none",
                  className,
                )}
                initial={reduce ? { opacity: 0, x: "-50%", y: "-50%" } : { opacity: 0, scale: 0.97, x: "-50%", y: "-48%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: "-49%" }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <div className={cn("mb-4 pr-8", hideTitle && "sr-only")}>
                  <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
                  {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : null}
                </div>
                {children}
                {footer ? <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
                <DialogPrimitive.Close className="absolute right-3 top-3 grid size-10 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Close">
                  <X size={18} />
                </DialogPrimitive.Close>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  side = "right",
  hideTitle,
  bodyClassName,
}: BaseProps & { side?: "right" | "bottom"; bodyClassName?: string }) {
  const reduce = useReducedMotion();
  const from = side === "right" ? { x: "100%" } : { y: "100%" };
  const to = side === "right" ? { x: 0 } : { y: 0 };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                className={cn(
                  "fixed z-50 flex flex-col bg-background shadow-pop focus:outline-none",
                  side === "right"
                    ? "inset-y-0 right-0 h-dvh w-full border-l border-border sm:max-w-[440px]"
                    : "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[20px] border-t border-border",
                  className,
                )}
                initial={reduce ? { opacity: 0 } : from}
                animate={reduce ? { opacity: 1 } : to}
                exit={reduce ? { opacity: 0 } : from}
                // Spring is reserved for drawers and drag.
                transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 38 }}
              >
                <div className={cn("flex items-start justify-between gap-3 border-b border-border px-6 py-5", hideTitle && "sr-only")}>
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
                    {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : null}
                  </div>
                  <DialogPrimitive.Close className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Close">
                    <X size={18} />
                  </DialogPrimitive.Close>
                </div>
                <div data-lenis-prevent className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", bodyClassName)}>
                  {children}
                </div>
                {footer ? <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">{footer}</div> : null}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
