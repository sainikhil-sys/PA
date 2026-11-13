"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { call } from "@/components/feed/api";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

const select = "h-10 rounded-[10px] border border-border bg-background px-2 text-[14px]";
const tags = (s: string) =>
  s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export const OPEN_TO_LABELS: Record<string, string> = {
  cofounder: "Co-founding",
  collaborate: "Collaborating on projects",
  mentor_others: "Mentoring others",
  find_mentor: "Finding a mentor",
};

/** Your professional profile: what others see when they find you in the startup network. */
export function ProProfileForm({ initial }: { initial: { headline: string; about: string; skills: string[]; interests: string[]; openTo: string[]; location: string; visibility: string } | null }) {
  const router = useRouter();
  const [headline, setHeadline] = React.useState(initial?.headline ?? "");
  const [about, setAbout] = React.useState(initial?.about ?? "");
  const [skills, setSkills] = React.useState((initial?.skills ?? []).join(", "));
  const [interests, setInterests] = React.useState((initial?.interests ?? []).join(", "));
  const [openTo, setOpenTo] = React.useState<string[]>(initial?.openTo ?? []);
  const [location, setLocation] = React.useState(initial?.location ?? "");
  const [visibility, setVisibility] = React.useState(initial?.visibility ?? "everyone");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await call("/api/pro-profile", { method: "PUT", body: { headline, about, skills: tags(skills), interests: tags(interests), openTo, location, visibility } });
      if (!r.ok) return setError(r.error);
      toast.success("Profile saved");
      router.refresh();
    });
  };
  return (
    <form onSubmit={save} className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pro-headline">Headline</Label>
        <Input id="pro-headline" maxLength={120} placeholder="Backend engineer, building tools for teachers" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pro-about">About</Label>
        <Textarea id="pro-about" rows={4} maxLength={2000} value={about} onChange={(e) => setAbout(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pro-skills">Skills (separated by commas)</Label>
        <Input id="pro-skills" placeholder="react, postgres, product design" value={skills} onChange={(e) => setSkills(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pro-interests">Interests (separated by commas)</Label>
        <Input id="pro-interests" placeholder="education, climate" value={interests} onChange={(e) => setInterests(e.target.value)} />
      </div>
      <fieldset className="flex flex-col gap-1.5 text-[14px]">
        <legend className="mb-1 text-[13px] font-medium">Open to</legend>
        {Object.entries(OPEN_TO_LABELS).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={openTo.includes(k)} onChange={(e) => setOpenTo((all) => (e.target.checked ? [...all, k] : all.filter((x) => x !== k)))} /> {l}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pro-location">City or country (optional)</Label>
          <Input id="pro-location" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <label className="flex flex-col gap-1.5 text-[13px]">
          Who can see it
          <select className={select} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="everyone">Everyone on Cowork</option>
            <option value="followers">People who follow you</option>
            <option value="hidden">Only you</option>
          </select>
        </label>
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" variant="primary" className="self-end" disabled={pending}>
        Save profile
      </Button>
    </form>
  );
}

/** Publish a startup or idea. A private team Space is created with it. */
export function NewStartup() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [oneLiner, setOneLiner] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [stage, setStage] = React.useState("idea");
  const [industry, setIndustry] = React.useState("");
  const [lookingFor, setLookingFor] = React.useState("");
  const [skillsNeeded, setSkillsNeeded] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  if (!open)
    return (
      <Button variant="primary" className="self-start" onClick={() => setOpen(true)}>
        Share a startup or idea
      </Button>
    );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await call<{ startup: { slug: string } }>("/api/startups", { body: { name, oneLiner, description, stage, industry, lookingFor: tags(lookingFor), skillsNeeded: tags(skillsNeeded) } });
      if (!r.ok) return setError(r.error);
      router.push(`/startups/${r.data.startup.slug}`);
    });
  };
  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-name">Name</Label>
        <Input id="st-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-line">In one line</Label>
        <Input id="st-line" required minLength={10} maxLength={160} value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-desc">More detail (optional)</Label>
        <Textarea id="st-desc" rows={4} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px]">
          Stage
          <select className={select} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="idea">Idea</option>
            <option value="prototype">Prototype</option>
            <option value="launched">Launched</option>
            <option value="revenue">Earning revenue</option>
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="st-industry">Industry</Label>
          <Input id="st-industry" maxLength={60} value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-looking">Looking for (separated by commas)</Label>
        <Input id="st-looking" placeholder="technical co-founder, designer" value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="st-skills">Skills needed (separated by commas)</Label>
        <Input id="st-skills" placeholder="react native, sales" value={skillsNeeded} onChange={(e) => setSkillsNeeded(e.target.value)} />
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          Publish
        </Button>
      </div>
    </form>
  );
}

/** Ask to join a startup, or withdraw the request. */
export function InterestButton({ startupId, pending: hasPending }: { startupId: string; pending: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState("collaborate");
  const [message, setMessage] = React.useState("");
  const [busy, start] = React.useTransition();
  const send = () =>
    start(async () => {
      const r = await call(`/api/startups/${startupId}/interest`, { body: { kind, message } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Sent. The founders will reply.");
      setOpen(false);
      router.refresh();
    });
  const withdraw = () =>
    start(async () => {
      const r = await call(`/api/startups/${startupId}/interest`, { method: "DELETE" });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  if (hasPending)
    return (
      <Button size="sm" variant="secondary" disabled={busy} onClick={withdraw}>
        Withdraw request
      </Button>
    );
  if (!open)
    return (
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Ask to join
      </Button>
    );
  return (
    <div className="flex w-full flex-col gap-2">
      <select className={select} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="As">
        <option value="cofounder">As a co-founder</option>
        <option value="collaborate">As a collaborator</option>
        <option value="mentor">As a mentor</option>
      </select>
      <Textarea rows={3} maxLength={1000} placeholder="Say what you'd bring" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message to the founders" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}

/** Founders: accept or decline a request to join. */
export function AnswerInterest({ interestId }: { interestId: string }) {
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      const r = await call(`/api/startup-interests/${interestId}`, { body: { accept } });
      if (!r.ok) return void toast.error(r.error);
      toast.success(accept ? "Added to the team and its Space" : "Declined");
      router.refresh();
    });
  return (
    <span className="flex gap-1.5">
      <Button size="sm" variant="primary" disabled={busy} onClick={() => answer(true)}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => answer(false)}>
        Decline
      </Button>
    </span>
  );
}
