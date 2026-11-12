/** Shapes returned by /api/spaces (communities). */
import type { Post } from "@/features/feed/types";

export const SPACE_CATEGORIES = ["university", "professional", "gaming", "technology", "entertainment", "interest", "local", "other"] as const;
export type SpaceCategory = (typeof SPACE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<SpaceCategory, string> = {
  university: "University",
  professional: "Professional",
  gaming: "Gaming",
  technology: "Technology",
  entertainment: "Entertainment",
  interest: "Interests",
  local: "Local",
  other: "Other",
};

export type Space = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string | null;
  category: SpaceCategory | null;
  visibility: "public" | "private";
  joinPolicy: "open" | "request" | "invite";
  audience: "all" | "adults";
  memberCount: number;
  expiresAt: string | null;
  archived: boolean;
  myRole: "owner" | "moderator" | "member" | null;
  myStatus: "active" | "requested" | "banned" | null;
  canRead: boolean;
  canPost: boolean;
  canModerate: boolean;
};

export type SpacePostsPage = { pinned: Post[]; items: Post[]; next: string | null };

export type SpaceMember = { userId: string; role: "owner" | "moderator" | "member"; status: "active" | "requested" | "banned"; joinedAt: string; handle: string; name: string; avatarUrl: string | null };

export type SpaceEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  cancelled: boolean;
  going: number;
  maybe: number;
  myRsvp: "going" | "maybe" | "not_going" | null;
};

export type MemberAction = "accept" | "decline" | "ban" | "unban" | "make_moderator" | "make_member" | "make_owner" | "remove";
