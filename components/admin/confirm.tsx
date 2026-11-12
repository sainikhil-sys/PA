"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";

/**
 * In-page confirmation for console actions (never the browser's native confirm box, which blocks the
 * page and can't show a typed check). `typeToConfirm` makes the person type a value, such as an email,
 * before the button works: used for the riskiest actions.
 */
export type ConfirmOptions = { title: string; message: string; confirmLabel?: string; danger?: boolean; typeToConfirm?: string };

const Ctx = React.createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = React.useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [typed, setTyped] = React.useState("");
  const ask = React.useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setReq({ ...o, resolve });
      }),
    [],
  );
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const needs = req?.typeToConfirm?.trim();
  const matches = !needs || typed.trim().toLowerCase() === needs.toLowerCase();
  const id = React.useId();
  return (
    <Ctx.Provider value={ask}>
      {children}
      <Dialog
        open={Boolean(req)}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
        title={req?.title ?? ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={req?.danger ? "danger" : "primary"} disabled={!matches} onClick={() => close(true)}>
              {req?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <p className="whitespace-pre-line text-[15px] text-muted">{req?.message}</p>
        {needs ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor={id}>
              Type <span className="font-mono">{needs}</span> to confirm
            </Label>
            <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </div>
        ) : null}
      </Dialog>
    </Ctx.Provider>
  );
}

/** Ask before doing something. Resolves true only when the person confirms. */
export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  const ask = React.useContext(Ctx);
  if (!ask) throw new Error("useConfirm needs ConfirmProvider (the console layout provides it)");
  return ask;
}
