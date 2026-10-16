// Copies brand marks from Simple Icons (CC0) into /public/brands as standalone SVGs
// in each brand's ORIGINAL color. Brands that Simple Icons doesn't carry
// (e.g. Slack, LinkedIn, Canva) get a neutral monogram tile in the UI instead —
// we never redraw or recolor someone else's logo.
import { mkdirSync, writeFileSync } from "node:fs";
import * as si from "simple-icons";

const SLUGS = [
  "gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "googletasks", "googlemeet",
  "notion", "github", "gitlab", "asana", "linear", "hubspot", "stripe", "telegram", "zoom", "youtube",
  "figma", "discord", "dropbox", "trello", "jira", "confluence", "medium", "substack", "x", "whatsapp",
  "rss", "todoist", "clickup", "airtable", "calendly", "claude", "obsidian", "miro", "evernote", "zapier",
];

const out = new URL("../public/brands/", import.meta.url);
mkdirSync(out, { recursive: true });
const icons = Object.fromEntries(Object.values(si).filter((i) => i?.slug).map((i) => [i.slug, i]));
const manifest = {};
for (const slug of SLUGS) {
  const icon = icons[slug];
  if (!icon) continue;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img"><title>${icon.title}</title><path fill="#${icon.hex}" d="${icon.path}"/></svg>\n`;
  writeFileSync(new URL(`${slug}.svg`, out), svg);
  manifest[slug] = { title: icon.title, hex: `#${icon.hex}`, source: "simple-icons (CC0)", guidelines: icon.guidelines ?? null };
}
writeFileSync(new URL("manifest.json", out), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${Object.keys(manifest).length} brand marks.`);
