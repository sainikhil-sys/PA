"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { saveBirthDate } from "@/app/actions/age";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { call } from "./api";

/**
 * What the feed needs before you can post or follow: a date of birth (asked once, never shown)
 * and a handle (shared with Chats). Each step only appears when it's missing.
 */
export function FeedSetup({ needsBirthDate, needsHandle, suggestion }: { needsBirthDate: boolean; needsHandle: boolean; suggestion: { handle: string; displayName: string } }) {
  const router = useRouter();
  const [birthDate, setBirthDate] = React.useState("");
  const [handle, setHandle] = React.useState(suggestion.handle);
  const [name, setName] = React.useState(suggestion.displayName);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      if (needsBirthDate) {
        const r = await saveBirthDate({ birthDate });
        if (!r.ok) return setError(r.error);
        if (r.data.underAge) {
          router.replace("/home");
          return;
        }
      }
      if (needsHandle) {
        const r = await call("/api/social/profile", { method: "PUT", body: { handle, displayName: name } });
        if (!r.ok) return setError(r.error);
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="card flex max-w-md flex-col gap-4 rounded-[14px] border border-border bg-background p-5">
      <div>
        <h2 className="text-[17px] font-medium">Set up your profile</h2>
        <p className="mt-1 text-[13px] text-muted">People find you by your handle. It&apos;s the same one you use in Chats on the app.</p>
      </div>
      {needsBirthDate ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dob">Date of birth</Label>
          <Input id="dob" type="date" required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} autoComplete="bday" />
          <p className="text-[12px] text-muted">You need to be 13 or older. Your date of birth is never shown to anyone.</p>
        </div>
      ) : null}
      {needsHandle ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="handle">Handle</Label>
            <Input id="handle" required value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} autoComplete="username" maxLength={24} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display">Name shown to others</Label>
            <Input id="display" required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
        </>
      ) : null}
      <FieldError>{error}</FieldError>
      <Button type="submit" variant="primary" disabled={pending}>
        Continue
      </Button>
    </form>
  );
}
