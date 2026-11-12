/** Shapes returned by /api/social (person-to-person Chats). AI chats use lib/types.ts instead. */

export type Person = { id: string; handle: string; name: string; avatarUrl: string | null; online: boolean };
export type Relationship = "none" | "friends" | "outgoing" | "incoming" | "blocked" | "blocked_you";
export type FoundPerson = Person & { relationship: Relationship };

export type SocialProfile = {
  handle: string;
  displayName: string;
  searchable: boolean;
  showPresence: boolean;
  readReceipts: boolean;
  pushPreview: boolean;
  /** Posts only for approved followers. Older servers omit it. */
  privateAccount?: boolean;
};
export type ProfileResponse = { profile: SocialProfile | null; suggestion?: { handle: string; displayName: string } };

export type Friends = { friends: Person[]; incoming: Person[]; outgoing: Person[] };

export type ThreadSummary = {
  id: string;
  kind: "direct" | "group";
  title: string;
  other: Person | null;
  memberCount: number;
  online: boolean;
  muted: boolean;
  unread: number;
  typing: string[];
  updatedAt: string;
  preview: string | null;
};

export const REACTIONS = ["like", "love", "laugh", "wow", "sad", "thanks"] as const;
export type ReactionKind = (typeof REACTIONS)[number];

export type DmMessage = {
  id: string;
  seq: number;
  clientId: string;
  kind: "text" | "system";
  senderId: string | null;
  body: string;
  replyTo: { id: string; senderName: string; body: string } | null;
  reactions: { kind: ReactionKind; count: number; mine: boolean }[];
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
  state?: "sent" | "delivered" | "read";
};

export type ThreadMember = Person & { role: "owner" | "admin" | "member" };

export type ThreadPage = {
  /** Your own user id. */
  me: string;
  thread: {
    id: string;
    kind: "direct" | "group";
    title: string;
    other: Person | null;
    canSend: boolean;
    relationship: Relationship | null;
    myRole: "owner" | "admin" | "member";
    muted: boolean;
    readSeq: number;
    members: ThreadMember[];
  };
  messages: DmMessage[];
  hasMore: boolean;
  typing: string[];
};

export type MessageHit = { threadId: string; messageId: string; title: string; sender: string; body: string; createdAt: string };

export const REPORT_REASONS = [
  { key: "spam", label: "Spam or scam" },
  { key: "harassment", label: "Bullying or harassment" },
  { key: "hate", label: "Hate speech" },
  { key: "sexual", label: "Sexual content" },
  { key: "violence", label: "Threats or violence" },
  { key: "self_harm", label: "Self-harm" },
  { key: "impersonation", label: "Pretending to be someone else" },
  { key: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["key"];
