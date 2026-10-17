import { describe, expect, it } from "vitest";
import { isSafeBaseUrl } from "@/lib/ai/presets";
import { feedImage } from "@/lib/news/parse";
import { spotifyEmbed, wallpaperById, youtubeEmbed } from "@/lib/room";

describe("room embeds", () => {
  it("converts Spotify share links", () => {
    expect(spotifyEmbed("https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn?si=abc")).toBe("https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn?utm_source=generator&theme=0");
    expect(spotifyEmbed("https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy")).toContain("/embed/album/4aawyAB9vmqN3uQ7FjRGTy");
    expect(spotifyEmbed("https://evil.example/playlist/37i9dQZF1DWWQRwui0ExPn")).toBeNull();
    expect(spotifyEmbed("http://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn")).toBeNull();
    expect(spotifyEmbed("not a url")).toBeNull();
  });

  it("converts YouTube links to privacy-enhanced embeds", () => {
    expect(youtubeEmbed("https://www.youtube.com/watch?v=jfKfPfyJRdk")).toBe("https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?rel=0");
    expect(youtubeEmbed("https://youtu.be/jfKfPfyJRdk")).toContain("/embed/jfKfPfyJRdk");
    expect(youtubeEmbed("https://www.youtube.com/shorts/jfKfPfyJRdk")).toContain("/embed/jfKfPfyJRdk");
    expect(youtubeEmbed("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG")).toBe("https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&rel=0");
    expect(youtubeEmbed("https://www.youtube.com/watch?v=bad")).toBeNull();
    expect(youtubeEmbed("https://vimeo.com/123")).toBeNull();
  });

  it("falls back to the plain wallpaper", () => {
    expect(wallpaperById("nope").id).toBe("none");
    expect(wallpaperById("dusk").dark).toBe(true);
  });
});

describe("own AI key endpoint", () => {
  it("only allows public https hosts", () => {
    expect(isSafeBaseUrl("https://api.openai.com/v1")).toBe(true);
    expect(isSafeBaseUrl("http://api.openai.com/v1")).toBe(false);
    expect(isSafeBaseUrl("https://localhost:8080/v1")).toBe(false);
    expect(isSafeBaseUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isSafeBaseUrl("https://10.0.0.5/v1")).toBe(false);
    expect(isSafeBaseUrl("https://[::1]/v1")).toBe(false);
    expect(isSafeBaseUrl("https://user:pw@api.example.com")).toBe(false);
    expect(isSafeBaseUrl("https://metadata.internal/v1")).toBe(false);
  });
});

describe("news images", () => {
  it("finds media, enclosures and inline images (https only)", () => {
    expect(feedImage({ "media:thumbnail": { "@_url": "https://img.example/a.jpg" } })).toBe("https://img.example/a.jpg");
    expect(feedImage({ enclosure: { "@_url": "https://img.example/b.png", "@_type": "image/png" } })).toBe("https://img.example/b.png");
    expect(feedImage({ description: '<p><img src="https://img.example/c.jpg?w=1&amp;h=2"></p>' })).toBe("https://img.example/c.jpg?w=1&h=2");
    expect(feedImage({ "media:content": { "@_url": "http://img.example/d.jpg" } })).toBeUndefined();
    expect(feedImage({ title: "no image" })).toBeUndefined();
  });
});
