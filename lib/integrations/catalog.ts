/**
 * Integration catalog shown on the Integrations page.
 * Every entry connects for real: Google OAuth, provider OAuth (needs an app
 * registered with that provider), or read-only tokens validated before saving.
 */
export type IntegrationCategory = "Communication" | "Productivity" | "Knowledge" | "Content" | "Business";

export type CatalogEntry = {
  id: string;
  name: string;
  logo: string; // file in /public/brands, or a monogram fallback if missing
  category: IntegrationCategory;
  description: string;
  connect: "google" | "token" | "oauth" | "none";
  /** Provider row that stores the connection (several Google products share one). */
  provider?: string;
  permissions: string[];
  scopes: string[];
  tokenHelp?: string;
  /** Credential fields for token connections (default: a single secret token). */
  fields?: { name: string; label: string; secret?: boolean }[];
};

const GOOGLE_PERMS = ["Read your email (never sends)", "Create Gmail drafts for your review", "Read your calendar", "Read files you choose in Drive"];
const GOOGLE_SCOPES = ["gmail.readonly", "gmail.compose", "calendar.readonly", "drive.readonly"];

export const CATALOG: CatalogEntry[] = [
  { id: "gmail", name: "Gmail", logo: "gmail", category: "Communication", description: "Triage, summaries and reply drafts.", connect: "google", provider: "google", permissions: GOOGLE_PERMS, scopes: GOOGLE_SCOPES },
  { id: "googlecalendar", name: "Google Calendar", logo: "googlecalendar", category: "Productivity", description: "Your schedule and meeting prep.", connect: "google", provider: "google", permissions: GOOGLE_PERMS, scopes: GOOGLE_SCOPES },
  { id: "googledrive", name: "Google Drive", logo: "googledrive", category: "Knowledge", description: "Index folders you choose.", connect: "google", provider: "google", permissions: GOOGLE_PERMS, scopes: GOOGLE_SCOPES },
  { id: "googledocs", name: "Google Docs", logo: "googledocs", category: "Knowledge", description: "Docs inside your chosen Drive folders.", connect: "google", provider: "google", permissions: GOOGLE_PERMS, scopes: GOOGLE_SCOPES },
  { id: "googlesheets", name: "Google Sheets", logo: "googlesheets", category: "Knowledge", description: "Sheets inside your chosen Drive folders.", connect: "google", provider: "google", permissions: GOOGLE_PERMS, scopes: GOOGLE_SCOPES },
  {
    id: "notion",
    name: "Notion",
    logo: "notion",
    category: "Knowledge",
    description: "Index pages shared with your integration.",
    connect: "token",
    provider: "notion",
    permissions: ["Read pages you share with the integration", "Never edits or deletes"],
    scopes: ["read content"],
    tokenHelp: "Create an internal integration at notion.so/my-integrations with only “Read content”, then share the pages you want indexed with it.",
  },
  {
    id: "slack",
    name: "Slack",
    logo: "slack",
    category: "Communication",
    description: "Read channels you choose for knowledge.",
    connect: "token",
    provider: "slack",
    permissions: ["Read messages in channels you choose", "Never posts"],
    scopes: ["channels:history", "channels:read"],
    tokenHelp: "Create a Slack app with the read-only bot scopes channels:read and channels:history, install it, and invite it to the channels you want indexed.",
  },
  {
    id: "github",
    name: "GitHub",
    logo: "github",
    category: "Knowledge",
    description: "Index READMEs and docs from repos you choose.",
    connect: "token",
    provider: "github",
    permissions: ["Read repository contents you choose", "Never pushes or comments"],
    scopes: ["contents:read"],
    tokenHelp: "Create a fine-grained personal access token with read-only “Contents” access to the repositories you want indexed.",
  },
  {
    id: "telegram",
    name: "Telegram",
    logo: "telegram",
    category: "Communication",
    description: "Reminders and notifications to your chat.",
    connect: "none",
    provider: "telegram",
    permissions: ["Send notifications to your own chat"],
    scopes: ["bot"],
    tokenHelp: "Configured with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    logo: "linkedin",
    category: "Content",
    description: "Publish posts you approved. Never posts on its own.",
    connect: "oauth",
    provider: "linkedin",
    permissions: ["Read your basic profile (name, photo)", "Publish a post ONLY when you click Publish on an approved draft"],
    scopes: ["openid", "profile", "w_member_social"],
    tokenHelp: "Needs a LinkedIn app with “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect”. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET; redirect URL: <APP_URL>/api/integrations/linkedin/callback.",
  },
  {
    id: "asana",
    name: "Asana",
    logo: "asana",
    category: "Productivity",
    description: "Import your open Asana tasks into Cowork.",
    connect: "token",
    provider: "asana",
    permissions: ["Read tasks assigned to you", "Never edits, completes or deletes Asana tasks"],
    scopes: ["personal access token (read)"],
    fields: [{ name: "token", label: "Personal access token", secret: true }],
    tokenHelp: "Asana → Settings → Apps → Developer apps → Personal access tokens → Create.",
  },
  {
    id: "linear",
    name: "Linear",
    logo: "linear",
    category: "Productivity",
    description: "Import issues assigned to you into Cowork.",
    connect: "token",
    provider: "linear",
    permissions: ["Read issues assigned to you", "Never edits or closes Linear issues"],
    scopes: ["read"],
    fields: [{ name: "token", label: "Personal API key", secret: true }],
    tokenHelp: "Linear → Settings → Account → Security & access → Personal API keys → New key, with Read access only.",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    logo: "hubspot",
    category: "Business",
    description: "Contact context for meetings and replies.",
    connect: "token",
    provider: "hubspot",
    permissions: ["Read contacts (name, company, title, email)", "Never edits or deletes CRM records"],
    scopes: ["crm.objects.contacts.read"],
    fields: [{ name: "token", label: "Private app access token", secret: true }],
    tokenHelp: "HubSpot → Settings → Integrations → Private apps → Create, with only crm.objects.contacts.read.",
  },
  {
    id: "stripe",
    name: "Stripe",
    logo: "stripe",
    category: "Business",
    description: "Revenue summary for your briefing and questions.",
    connect: "token",
    provider: "stripe",
    permissions: ["Read balance and recent charges (amounts, counts)", "Never creates charges, refunds or payouts"],
    scopes: ["restricted key: Balance read, Charges read"],
    fields: [{ name: "token", label: "Restricted API key (rk_…)", secret: true }],
    tokenHelp: "Stripe → Developers → API keys → Create restricted key with READ on Balance and Charges only. Secret keys (sk_) are refused.",
  },
  {
    id: "zoom",
    name: "Zoom",
    logo: "zoom",
    category: "Communication",
    description: "Upcoming meetings and recent recordings.",
    connect: "token",
    provider: "zoom",
    permissions: ["Read your scheduled meetings", "Read your cloud recording list (titles, links)", "Never creates or deletes meetings"],
    scopes: ["meeting:read:list_meetings:admin", "cloud_recording:read:list_user_recordings:admin"],
    fields: [
      { name: "accountId", label: "Account ID" },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
    tokenHelp: "Zoom App Marketplace → Develop → Build app → Server-to-Server OAuth. Under Scopes add meeting:read:list_meetings:admin and cloud_recording:read:list_user_recordings:admin, then Activation → Activate your app. Copy Account ID, Client ID and Client secret from App Credentials.",
  },
  {
    id: "youtube",
    name: "YouTube",
    logo: "youtube",
    category: "Content",
    description: "Your channel stats and latest videos.",
    connect: "token",
    provider: "youtube",
    permissions: ["Read public channel statistics and video list"],
    scopes: ["YouTube Data API v3 (public data)"],
    fields: [
      { name: "token", label: "API key", secret: true },
      { name: "channelId", label: "Channel ID (UC…)" },
    ],
    tokenHelp: "Google Cloud → enable “YouTube Data API v3” → Credentials → API key (restrict it to that API). Channel ID is in YouTube Studio → Settings → Channel → Advanced.",
  },
  {
    id: "spotify",
    name: "Spotify",
    logo: "spotify",
    category: "Content",
    description: "What's playing, your playlists, and playback controls in your room.",
    connect: "oauth",
    provider: "spotify",
    permissions: ["See what's playing and your playlists", "Play, pause and skip (Spotify Premium)", "Never changes your library or playlists"],
    scopes: ["user-read-currently-playing", "user-read-playback-state", "user-modify-playback-state", "playlist-read-private", "user-read-recently-played"],
    tokenHelp: "Needs a Spotify app (developer.spotify.com). Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET; redirect URI: <APP_URL>/api/integrations/spotify/callback.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    logo: "whatsapp",
    category: "Communication",
    description: "Your WhatsApp messages through the phone link, with quick replies.",
    connect: "none",
    permissions: ["Shows WhatsApp notifications from your linked Android phone", "Opens the chat in WhatsApp to reply", "Never sends messages for you"],
    scopes: [],
    tokenHelp: "WhatsApp works through Phone: link your Android phone in Cowork → Phone, and WhatsApp messages appear there and here.",
  },
  {
    id: "canva",
    name: "Canva",
    logo: "canva",
    category: "Content",
    description: "Index your designs so the agent can find them.",
    connect: "oauth",
    provider: "canva",
    permissions: ["Read your design list (titles, links, thumbnails)", "Never edits or deletes designs"],
    scopes: ["design:meta:read", "profile:read"],
    tokenHelp: "Needs a Canva Connect integration. Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET; redirect URL: <APP_URL>/api/integrations/canva/callback.",
  },
  {
    id: "figma",
    name: "Figma",
    logo: "figma",
    category: "Content",
    description: "Index projects and files from your team.",
    connect: "token",
    provider: "figma",
    permissions: ["Read project and file names, links and edit dates", "Never edits files"],
    scopes: ["file_content:read", "projects:read"],
    fields: [
      { name: "token", label: "Personal access token", secret: true },
      { name: "teamId", label: "Team ID" },
    ],
    tokenHelp: "Figma → Settings → Security → Personal access tokens (read-only scopes). Team ID is the number in figma.com/files/team/<ID>/….",
  },
];

export const CATEGORIES: IntegrationCategory[] = ["Communication", "Productivity", "Knowledge", "Content", "Business"];
