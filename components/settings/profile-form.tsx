"use client";

import { Camera } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { saveAvatar, saveProfile } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { Section } from "./section";
import { TimezoneSelect } from "./timezone-select";

type Profile = { name: string; email: string; role: string; bio: string; avatarUrl: string | null; timezone: string; language: string; dateFormat: string; timeFormat: string };

/** Downscale a picked photo to a 256px JPEG data URL (small, no blob storage needed). */
async function toAvatarDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [p, setP] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await saveProfile({ name: p.name, role: p.role, bio: p.bio, timezone: p.timezone, language: p.language, dateFormat: p.dateFormat as never, timeFormat: p.timeFormat as never });
          if (!res.ok) return setError(res.error);
          toast.success("Profile saved");
          router.refresh();
        });
      }}
    >
      <Section title="Profile" description="Your name, photo and bio. Your role and bio also shape your LinkedIn voice.">
        <div className="flex items-center gap-4">
          <Avatar src={p.avatarUrl} name={p.name} email={p.email} size={64} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 8 * 1024 * 1024) return void toast.error("Pick an image under 8 MB.");
              const url = await toAvatarDataUrl(f);
              const res = await saveAvatar({ dataUrl: url });
              if (!res.ok) return void toast.error(res.error);
              setP({ ...p, avatarUrl: url });
              toast.success("Photo updated");
              router.refresh();
            }}
          />
          <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
            <Camera /> Change photo
          </Button>
          {p.avatarUrl ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                await saveAvatar({ dataUrl: null });
                setP({ ...p, avatarUrl: null });
                router.refresh();
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} autoComplete="name" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-role">Role</Label>
            <Input id="p-role" value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} placeholder="Founder at Acme" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="p-bio">Bio</Label>
          <Textarea id="p-bio" value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} placeholder="What you do, who you write for, topics you care about." />
        </div>
      </Section>
      <Section title="Region" description="Used for your briefing, schedules and how dates appear.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-tz">Timezone</Label>
            <TimezoneSelect id="p-tz" value={p.timezone} onChange={(v) => setP({ ...p, timezone: v })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-lang">Language</Label>
            <select id="p-lang" value={p.language} onChange={(e) => setP({ ...p, language: e.target.value })} className={inputClass}>
              {[["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["hi", "हिन्दी"], ["pt", "Português"]].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-date">Date format</Label>
            <select id="p-date" value={p.dateFormat} onChange={(e) => setP({ ...p, dateFormat: e.target.value })} className={inputClass}>
              {["MMM d, yyyy", "d MMM yyyy", "yyyy-MM-dd", "MM/dd/yyyy"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="p-time">Time format</Label>
            <select id="p-time" value={p.timeFormat} onChange={(e) => setP({ ...p, timeFormat: e.target.value })} className={inputClass}>
              <option value="24h">24-hour</option>
              <option value="12h">12-hour</option>
            </select>
          </div>
        </div>
        <FieldError>{error}</FieldError>
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Section>
    </form>
  );
}
