"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { call } from "@/components/feed/api";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

const CATEGORIES = [
  ["interest", "Interests"],
  ["university", "University"],
  ["professional", "Professional"],
  ["technology", "Technology"],
  ["gaming", "Gaming"],
  ["entertainment", "Entertainment"],
  ["local", "Local"],
  ["other", "Other"],
] as const;

const select = "h-10 rounded-[10px] border border-border bg-background px-2 text-[14px]";

/** Start a Space. Under 18, only private Spaces can be created (the server enforces it too). */
export function CreateSpace({ teen }: { teen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("interest");
  const [visibility, setVisibility] = React.useState(teen ? "private" : "public");
  const [joinPolicy, setJoinPolicy] = React.useState(teen ? "invite" : "open");
  const [audience, setAudience] = React.useState("all");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  if (!open)
    return (
      <Button variant="primary" className="self-start" onClick={() => setOpen(true)}>
        Create a Space
      </Button>
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await call<{ space: { slug: string } }>("/api/spaces", { body: { name, description, category, visibility, joinPolicy, audience } });
      if (!r.ok) return setError(r.error);
      router.push(`/s/${r.data.space.slug}`);
    });
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <h2 className="text-[15px] font-medium">New Space</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sname">Name</Label>
        <Input id="sname" required minLength={3} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sdesc">What it's about</Label>
        <Textarea id="sdesc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px]">
          Category
          <select className={select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px]">
          Who can read it
          <select className={select} value={visibility} onChange={(e) => setVisibility(e.target.value)} disabled={teen}>
            <option value="public">Anyone on Cowork</option>
            <option value="private">Members only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px]">
          How people join
          <select className={select} value={joinPolicy} onChange={(e) => setJoinPolicy(e.target.value)}>
            {visibility === "public" ? <option value="open">Anyone can join</option> : null}
            <option value="request">They ask, a moderator accepts</option>
            <option value="invite">Invite link only</option>
          </select>
        </label>
        {teen ? null : (
          <label className="flex flex-col gap-1.5 text-[13px]">
            Age
            <select className={select} value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="all">13 and over</option>
              <option value="adults">18 and over</option>
            </select>
          </label>
        )}
      </div>
      {teen ? <p className="text-[12px] text-muted">Under 18, the Spaces you create are private. Invite people with a link.</p> : null}
      <FieldError>{error}</FieldError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || name.trim().length < 3}>
          Create
        </Button>
      </div>
    </form>
  );
}
