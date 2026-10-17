// Read-only diagnostic: which Spotify endpoints work for each connected account (status codes only).
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db");
const { oauthAccessToken } = await import("../lib/integrations/oauth");

const rows = await db().select({ userId: schema.integrations.userId, label: schema.integrations.accountLabel, config: schema.integrations.config }).from(schema.integrations).where(eq(schema.integrations.provider, "spotify"));
for (const r of rows) {
  const { token } = await oauthAccessToken(r.userId, "spotify");
  const out: string[] = [];
  for (const p of ["/me", "/me/playlists?limit=5", "/me/player", "/me/player/recently-played?limit=1", "/me/top/tracks?limit=1"]) {
    const res = await fetch(`https://api.spotify.com/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
    let extra = "";
    if (p === "/me" && res.ok) extra = ` product=${((await res.json()) as { product?: string }).product}`;
    else if (p.startsWith("/me/playlists") && res.ok) extra = ` items=${((await res.json()) as { items?: unknown[] }).items?.length}`;
    else if (!res.ok) extra = ` ${(await res.text()).slice(0, 120).replace(/\s+/g, " ")}`;
    out.push(`${p.split("?")[0]} ${res.status}${extra}`);
  }
  console.log(`account ${r.label}: ${JSON.stringify(r.config)}\n  ${out.join("\n  ")}`);
}
process.exit(0);
