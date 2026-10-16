/**
 * Integration catalog shown on the Integrations page.
 * `connect` describes how a real adapter connects; `soon` entries are listed
 * honestly as not yet available rather than faking a connection.
 */
export type IntegrationCategory = "Communication" | "Productivity" | "Knowledge" | "Content" | "Business";

export type CatalogEntry = {
  id: string;
  name: string;
  logo: string; // file in /public/brands, or a monogram fallback if missing
  category: IntegrationCategory;
  description: string;
  connect: "google" | "token" | "none" | "soon";
  /** Provider row that stores the connection (several Google products share one). */
  provider?: string;
  permissions: string[];
  scopes: string[];
  tokenHelp?: string;
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
  { id: "linkedin", name: "LinkedIn", logo: "linkedin", category: "Content", description: "Drafts and copy-to-post. Publishing needs your approval.", connect: "soon", permissions: ["Share on LinkedIn (w_member_social), only when you approve"], scopes: ["w_member_social"] },
  { id: "asana", name: "Asana", logo: "asana", category: "Productivity", description: "Two-way task sync.", connect: "soon", permissions: ["Read and update task status"], scopes: [] },
  { id: "linear", name: "Linear", logo: "linear", category: "Productivity", description: "Two-way issue sync.", connect: "soon", permissions: ["Read and update issue status"], scopes: [] },
  { id: "hubspot", name: "HubSpot", logo: "hubspot", category: "Business", description: "Contact context for meetings.", connect: "soon", permissions: ["Read contacts"], scopes: [] },
  { id: "stripe", name: "Stripe", logo: "stripe", category: "Business", description: "Revenue summaries in your briefing.", connect: "soon", permissions: ["Read-only reports"], scopes: [] },
  { id: "zoom", name: "Zoom", logo: "zoom", category: "Communication", description: "Meeting links and recordings.", connect: "soon", permissions: ["Read meetings"], scopes: [] },
  { id: "youtube", name: "YouTube", logo: "youtube", category: "Content", description: "Channel stats and ideas.", connect: "soon", permissions: ["Read channel data"], scopes: [] },
  { id: "canva", name: "Canva", logo: "canva", category: "Content", description: "Designs for your posts.", connect: "soon", permissions: ["Read designs"], scopes: [] },
  { id: "figma", name: "Figma", logo: "figma", category: "Content", description: "Design files as knowledge.", connect: "soon", permissions: ["Read files"], scopes: [] },
];

export const CATEGORIES: IntegrationCategory[] = ["Communication", "Productivity", "Knowledge", "Content", "Business"];
