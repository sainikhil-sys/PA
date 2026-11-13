/**
 * Every feature flag Cowork knows, with its safe default (docs/ADMIN_CONSOLE_PROPOSAL.md 4.1).
 * A flag row in the database whose key is not here does nothing. With no row, the default applies.
 * Pure module so it is unit tested.
 */

export type FlagDef = {
  key: string;
  label: string;
  description: string;
  /** Used when the flag has no database row (or the row is archived). */
  default: boolean;
  /** The server code that refuses the feature when the flag is off, or null when nothing checks it yet. */
  enforcedIn: string | null;
};

export const FLAG_DEFS: readonly FlagDef[] = [
  {
    key: "chat.attachments",
    label: "Chat attachments",
    description: "Attaching files and images to a chat message.",
    default: true,
    enforcedIn: null,
  },
  {
    key: "chat.suggestions",
    label: "Chat suggestions",
    description: "Suggested prompts under the chat box.",
    default: true,
    enforcedIn: null,
  },
  {
    key: "notes.bookmarks",
    label: "Link bookmarks",
    description: "Saving a web link as a note with its title and preview.",
    default: true,
    enforcedIn: null,
  },
  {
    key: "social.anonymous",
    label: "Anonymous Spaces",
    description: "Spaces where everyone posts and comments under a per-Space pseudonym. Adults only; identities are revealed to admins only through an audited action.",
    default: false,
    enforcedIn: "lib/spaces/service.ts (create, discover, open, join and post in anonymous Spaces) via lib/anonymous/identity.ts anonymousOn()",
  },
];

export const FLAGS: ReadonlyMap<string, FlagDef> = new Map(FLAG_DEFS.map((f) => [f.key, f]));

export type FlagKey = (typeof FLAG_DEFS)[number]["key"];

export function isKnownFlag(key: string): boolean {
  return FLAGS.has(key);
}
