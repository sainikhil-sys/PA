"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/db/queries/settings";
import { spotifyEmbed, WALLPAPER_IDS, youtubeEmbed } from "@/lib/room";

export const saveRoom = ownerAction(
  z.object({
    wallpaper: z.enum(WALLPAPER_IDS).optional(),
    // Client-downsized JPEG/WebP (≤ ~700 KB). Only data:image URLs, so nothing is fetched from elsewhere.
    customWallpaper: z
      .string()
      .max(950_000, "That image is too large")
      .regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/, "Upload a JPEG, PNG or WebP image")
      .nullable()
      .optional(),
    spotifyUrl: z.string().max(400).optional(),
    youtubeUrl: z.string().max(400).optional(),
    focusMinutes: z.number().int().min(5).max(120).optional(),
    dim: z.number().min(0).max(0.8).optional(),
  }),
  async (input, user) => {
    if (input.spotifyUrl && !spotifyEmbed(input.spotifyUrl)) throw new Error("Paste a Spotify link to a playlist, album, track or podcast");
    if (input.youtubeUrl && !youtubeEmbed(input.youtubeUrl)) throw new Error("Paste a YouTube video or playlist link");
    const s = await getSettings(user.id);
    const room = { ...s.room };
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (v === null || v === "") delete (room as Record<string, unknown>)[k];
      else (room as Record<string, unknown>)[k] = v;
    }
    await db().update(schema.userSettings).set({ room }).where(eq(schema.userSettings.userId, user.id));
    revalidatePath("/");
  },
);
