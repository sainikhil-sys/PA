"use client";

import { Image as ImageIcon, MusicNotes, Pause, Play, PaintBrush, ArrowCounterClockwise, YoutubeLogo, Timer } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { saveRoom } from "@/app/actions/room";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Sheet } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import type { RoomSettings } from "@/lib/db/schema";
import { spotifyEmbed, WALLPAPERS, wallpaperById, youtubeEmbed } from "@/lib/room";
import { cn } from "@/lib/utils";

/** Wallpaper behind the Today page. Dark wallpapers flip the page to a dark glass theme. */
export function RoomBackground({ room }: { room: RoomSettings }) {
  const w = wallpaperById(room.wallpaper);
  const custom = room.wallpaper === "custom" && room.customWallpaper;
  const dark = custom ? true : w.dark;
  React.useEffect(() => {
    const root = document.documentElement;
    const on = Boolean(custom) || w.id !== "none";
    if (on) {
      root.dataset.room = dark ? "dark" : "light";
    } else delete root.dataset.room;
    return () => {
      delete root.dataset.room;
    };
  }, [w.id, custom, dark]);
  if (!custom && w.id === "none") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 bg-cover bg-center" style={custom ? { backgroundImage: `url("${room.customWallpaper}")` } : { background: w.css }} />
      {room.dim ? <div className="absolute inset-0 bg-black" style={{ opacity: room.dim }} /> : null}
    </div>
  );
}

/** Clock + focus timer. Runs locally; a soft chime when a session ends. */
export function FocusCard({ minutes = 25, onSettings }: { minutes?: number; onSettings: () => void }) {
  const total = minutes * 60;
  const [left, setLeft] = React.useState(total);
  const [running, setRunning] = React.useState(false);
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => setLeft(total), [total]);
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setRunning(false);
          chime();
          toast.success("Focus session done. Take a short break.");
          return total;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, total]);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const pct = 1 - left / total;
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Timer size={18} />}
        title="Focus"
        action={
          <button type="button" onClick={onSettings} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Customize room">
            <PaintBrush size={16} />
          </button>
        }
      />
      <CardBody className="flex items-center gap-4">
        <div className="relative grid size-[88px] shrink-0 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="16" fill="none" stroke="var(--border)" strokeWidth="2.5" />
            <circle cx="18" cy="18" r="16" fill="none" stroke="var(--foreground)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - pct} className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
          </svg>
          <span className="tabular text-[20px] font-medium" aria-live="off">
            {mm}:{ss}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="tabular font-serif text-[28px] leading-none">{now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : " "}</p>
          <p className="truncate text-[12px] text-muted">{now ? now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) : " "}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setRunning((r) => !r)}>
              {running ? <Pause /> : <Play />} {running ? "Pause" : "Start"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setRunning(false), setLeft(total))} aria-label="Reset timer">
              <ArrowCounterClockwise />
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 1.25);
  } catch {}
}

/** Embedded player (Spotify or YouTube). Loads only after the user presses play, so the page stays fast. */
export function EmbedCard({ kind, url, onSettings }: { kind: "spotify" | "youtube"; url?: string; onSettings: () => void }) {
  const src = kind === "spotify" ? spotifyEmbed(url) : youtubeEmbed(url);
  const [loaded, setLoaded] = React.useState(false);
  const title = kind === "spotify" ? "Music" : "Watch";
  const icon = kind === "spotify" ? <MusicNotes size={18} /> : <YoutubeLogo size={18} />;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon={icon} title={title} action={src ? <Button size="sm" variant="ghost" onClick={onSettings}>Change</Button> : null} />
      <CardBody className="flex-1">
        {!src ? (
          <button type="button" onClick={onSettings} className="flex h-[152px] w-full flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-border-strong text-[13px] text-muted hover:border-foreground hover:text-foreground">
            {icon}
            {kind === "spotify" ? "Add a Spotify playlist" : "Add a YouTube video or playlist"}
          </button>
        ) : loaded ? (
          <iframe
            src={src}
            title={kind === "spotify" ? "Spotify player" : "YouTube player"}
            className={cn("w-full rounded-[12px] border-0", kind === "spotify" ? "h-[152px]" : "aspect-video")}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          />
        ) : (
          <button type="button" onClick={() => setLoaded(true)} className={cn("flex w-full items-center justify-center gap-2 rounded-[12px] bg-surface-2 text-sm font-medium hover:bg-surface-hover", kind === "spotify" ? "h-[152px]" : "aspect-video")}>
            <Play size={18} weight="fill" /> {kind === "spotify" ? "Load player" : "Load video"}
          </button>
        )}
      </CardBody>
    </Card>
  );
}

async function downscale(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.82, 0.7, 0.55]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < 900_000) return url;
  }
  throw new Error("That image is too detailed. Try a smaller one.");
}

/** Room settings: wallpaper (preset or upload), dimming, music, video, focus length. */
export function RoomSheet({ open, onOpenChange, room }: { open: boolean; onOpenChange: (o: boolean) => void; room: RoomSettings }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [spotify, setSpotify] = React.useState(room.spotifyUrl ?? "");
  const [youtube, setYoutube] = React.useState(room.youtubeUrl ?? "");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const save = (patch: Parameters<typeof saveRoom>[0], msg?: string) =>
    start(async () => {
      const r = await saveRoom(patch);
      if (!r.ok) return void toast.error(r.error);
      if (msg) toast.success(msg);
      router.refresh();
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Customize your room" description="Wallpaper, music and video for your Today page.">
      <div className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-sm font-medium">Wallpaper</p>
          <div className="grid grid-cols-4 gap-2">
            {WALLPAPERS.map((w) => (
              <button
                key={w.id}
                type="button"
                disabled={pending}
                onClick={() => save({ wallpaper: w.id })}
                className={cn("flex flex-col gap-1 text-left text-[11px]", room.wallpaper === w.id || (!room.wallpaper && w.id === "none") ? "font-medium text-foreground" : "text-muted")}
                aria-pressed={room.wallpaper === w.id}
              >
                <span className={cn("aspect-[4/3] w-full rounded-[10px] border", room.wallpaper === w.id ? "border-foreground ring-2 ring-foreground/15" : "border-border")} style={{ background: w.css === "none" ? "var(--surface)" : w.css }} />
                {w.name}
              </button>
            ))}
            <button type="button" disabled={pending} onClick={() => fileRef.current?.click()} className={cn("flex flex-col gap-1 text-left text-[11px]", room.wallpaper === "custom" ? "font-medium" : "text-muted")}>
              <span
                className={cn("grid aspect-[4/3] w-full place-items-center rounded-[10px] border bg-cover bg-center", room.wallpaper === "custom" ? "border-foreground" : "border-dashed border-border-strong")}
                style={room.customWallpaper ? { backgroundImage: `url("${room.customWallpaper}")` } : undefined}
              >
                {room.customWallpaper ? null : <ImageIcon size={18} />}
              </span>
              Your photo
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const url = await downscale(f);
                save({ wallpaper: "custom", customWallpaper: url }, "Wallpaper set");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't use that image");
              }
            }}
          />
          <label className="mt-3 flex items-center gap-3 text-[13px]">
            <span className="w-20 text-muted">Dim</span>
            <input type="range" min={0} max={0.6} step={0.05} defaultValue={room.dim ?? 0} onChange={(e) => save({ dim: Number(e.target.value) })} className="flex-1 accent-[var(--foreground)]" aria-label="Dim wallpaper" />
          </label>
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ spotifyUrl: spotify, youtubeUrl: youtube }, "Saved");
          }}
        >
          <Label htmlFor="room-spotify">Spotify link</Label>
          <Input id="room-spotify" placeholder="https://open.spotify.com/playlist/…" value={spotify} onChange={(e) => setSpotify(e.target.value)} />
          <Label htmlFor="room-youtube" className="mt-2">
            YouTube link
          </Label>
          <Input id="room-youtube" placeholder="https://www.youtube.com/watch?v=…" value={youtube} onChange={(e) => setYoutube(e.target.value)} />
          <p className="text-[12px] text-muted">Tip: lo-fi playlists and focus videos work well. Players load only when you press play.</p>
          <Button type="submit" className="mt-2 w-fit" disabled={pending}>
            Save links
          </Button>
        </form>

        <label className="flex items-center gap-3 text-[13px]">
          <span className="text-muted">Focus session</span>
          <select defaultValue={room.focusMinutes ?? 25} onChange={(e) => save({ focusMinutes: Number(e.target.value) })} className="h-9 rounded-[10px] border border-border bg-background px-2">
            {[15, 25, 45, 50, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      </div>
    </Sheet>
  );
}

/** Top row of the Today room: focus clock, music, video. */
export function RoomRow({ room }: { room: RoomSettings }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <RoomBackground room={room} />
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-12">
        <div className="md:col-span-2 lg:col-span-4">
          <FocusCard minutes={room.focusMinutes} onSettings={() => setOpen(true)} />
        </div>
        <div className="lg:col-span-4">
          <EmbedCard kind="spotify" url={room.spotifyUrl} onSettings={() => setOpen(true)} />
        </div>
        <div className="lg:col-span-4">
          <EmbedCard kind="youtube" url={room.youtubeUrl} onSettings={() => setOpen(true)} />
        </div>
      </div>
      <RoomSheet open={open} onOpenChange={setOpen} room={room} />
    </>
  );
}
