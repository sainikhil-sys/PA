/** Today "room": wallpaper presets and safe embed URLs for music and video. Pure, client-safe. */

export type Wallpaper = { id: string; name: string; css: string; dark: boolean };

/** Generated wallpapers (no external images). Dark ones switch cards to a dark glass. */
export const WALLPAPERS: Wallpaper[] = [
  { id: "none", name: "Plain", css: "none", dark: false },
  { id: "dawn", name: "Dawn", css: "radial-gradient(120% 90% at 10% 0%, #ffd9c2 0%, transparent 55%), radial-gradient(90% 80% at 100% 10%, #c9d8ff 0%, transparent 60%), linear-gradient(180deg, #fff6ef 0%, #eef1ff 100%)", dark: false },
  { id: "sage", name: "Sage", css: "radial-gradient(80% 70% at 85% 15%, #d6e8d2 0%, transparent 60%), radial-gradient(70% 60% at 0% 100%, #e8e2cf 0%, transparent 60%), linear-gradient(160deg, #f4f6ef 0%, #e7eee3 100%)", dark: false },
  { id: "paper", name: "Paper", css: "radial-gradient(#0000000d 1px, transparent 1px) 0 0 / 18px 18px, linear-gradient(180deg, #faf8f3 0%, #f2efe7 100%)", dark: false },
  { id: "ocean", name: "Ocean", css: "radial-gradient(100% 80% at 0% 0%, #1e3a5f 0%, transparent 60%), radial-gradient(80% 70% at 100% 100%, #0f5257 0%, transparent 60%), linear-gradient(160deg, #0b1626 0%, #0e2433 100%)", dark: true },
  { id: "dusk", name: "Dusk", css: "radial-gradient(90% 70% at 80% 10%, #6b3a73 0%, transparent 60%), radial-gradient(90% 80% at 0% 100%, #b4553f 0%, transparent 55%), linear-gradient(170deg, #1b1430 0%, #2a1a2e 100%)", dark: true },
  { id: "midnight", name: "Midnight desk", css: "radial-gradient(60% 50% at 75% 20%, #2b3a67 0%, transparent 70%), radial-gradient(1.5px 1.5px at 20% 30%, #ffffff99 50%, transparent 51%), radial-gradient(1px 1px at 60% 12%, #ffffff80 50%, transparent 51%), radial-gradient(1px 1px at 85% 40%, #ffffff66 50%, transparent 51%), linear-gradient(180deg, #0a0d1a 0%, #141a2e 100%)", dark: true },
];

export function wallpaperById(id: string | undefined): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]!;
}

/** Spotify share link → embed URL. Accepts open.spotify.com links (with or without /intl-xx/). */
export function spotifyEmbed(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
    const m = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,32})/.exec(u.pathname);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0` : null;
  } catch {
    return null;
  }
}

/** YouTube link → privacy-enhanced embed URL (youtube-nocookie). Videos, shorts, youtu.be and playlists. */
export function youtubeEmbed(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    const id = /^[A-Za-z0-9_-]{11}$/;
    const list = u.searchParams.get("list");
    let video: string | null = null;
    if (host === "youtu.be") video = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") video = u.searchParams.get("v");
      else video = /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
    } else return null;
    if (video && id.test(video)) return `https://www.youtube-nocookie.com/embed/${video}?rel=0${list && /^[A-Za-z0-9_-]{10,64}$/.test(list) ? `&list=${list}` : ""}`;
    if (list && /^[A-Za-z0-9_-]{10,64}$/.test(list)) return `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&rel=0`;
    return null;
  } catch {
    return null;
  }
}
