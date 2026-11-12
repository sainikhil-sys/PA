"use client";

import * as React from "react";
import { completeDeletionRequest, recordDeletionRequest, rejectDeletionRequest, verifyDeletionRequest } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, inputClass, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAdminCall } from "./users-call";

export function RecordDeletionForm() {
  const { pending, run } = useAdminCall();
  const [email, setEmail] = React.useState("");
  const [source, setSource] = React.useState<"email" | "support">("email");
  const [received, setReceived] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <form
      className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        run(() => recordDeletionRequest({ email, source, receivedAt: received ? new Date(`${received}T12:00:00`).toISOString() : undefined, note: note || undefined }), {
          done: (d) => (d.accountFound ? "Request recorded" : "Request recorded. No account uses that address."),
          onError: setError,
          onDone: () => {
            setEmail("");
            setReceived("");
            setNote("");
          },
        });
      }}
    >
      <h2 className="text-[15px] font-medium">Record a request</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_180px]">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-e`}>Email it came from</Label>
          <Input id={`${id}-e`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} className="h-10 text-[14px]" autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-s`}>Received by</Label>
          <select id={`${id}-s`} value={source} onChange={(e) => setSource(e.target.value as "email" | "support")} className={cn(inputClass, "h-10 text-[14px]")}>
            <option value="email">Email</option>
            <option value="support">Support contact</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-d`}>Received on</Label>
          <Input id={`${id}-d`} type="date" value={received} onChange={(e) => setReceived(e.target.value)} className="h-10 text-[14px]" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-n`}>Note (optional)</Label>
        <Input id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="h-10 text-[14px]" />
      </div>
      <FieldHint>Only a hash of the address is stored. It&apos;s due 30 days after it was received, as the Delete account page promises.</FieldHint>
      <FieldError>{error}</FieldError>
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending || !email.includes("@")}>
          {pending ? "Saving" : "Record request"}
        </Button>
      </div>
    </form>
  );
}

/** Verify, reject (with a note) and, for the owner, delete the account. */
export function DeletionActions({ id, status, canComplete, hasAccount }: { id: string; status: "received" | "verified"; canComplete: boolean; hasAccount: boolean }) {
  const { pending, run, dialog } = useAdminCall();
  const [mode, setMode] = React.useState<null | "reject" | "complete">(null);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const close = () => {
    setMode(null);
    setText("");
    setError(null);
  };
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "received" && hasAccount ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => verifyDeletionRequest({ id }), { done: "Marked as verified" })}>
          Verify
        </Button>
      ) : null}
      {status === "verified" && canComplete ? (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => setMode("complete")}>
          Delete account
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("reject")}>
        Reject
      </Button>
      <Dialog
        open={mode !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={mode === "complete" ? "Delete this account" : "Reject this request"}
        description={mode === "complete" ? "Type the account's email address. You'll see what will be deleted before anything happens." : "Say why, for example the request didn't come from the sign-in address."}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={mode === "complete" ? "danger" : "primary"}
              disabled={pending || text.trim().length < 3}
              onClick={() => {
                setError(null);
                if (mode === "complete") {
                  const confirmEmail = text;
                  setMode(null);
                  run((token) => completeDeletionRequest({ id, confirmEmail }, token), { done: "Account deleted. The request is kept as proof.", confirmLabel: "Delete account", onDone: close });
                } else {
                  run(() => rejectDeletionRequest({ id, note: text }), { done: "Request rejected", onError: setError, onDone: close });
                }
              }}
            >
              {mode === "complete" ? "Continue" : "Reject request"}
            </Button>
          </>
        }
      >
        {mode === "complete" ? (
          <Input value={text} onChange={(e) => setText(e.target.value)} type="email" autoComplete="off" aria-label="Account email" maxLength={320} />
        ) : (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} aria-label="Why it was rejected" />
        )}
        <div className="mt-2">
          <FieldError>{error}</FieldError>
        </div>
      </Dialog>
      {dialog}
    </div>
  );
}
