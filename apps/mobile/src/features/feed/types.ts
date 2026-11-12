/** Shapes returned by the feed API (/api/feed, /api/posts, /api/people, /api/follows, /api/media). */
import type { ReactionKind } from "@/features/social/types";

export type Visibility = "public" | "followers" | "friends";
export type Author = { id: string; handle: string; name: string; avatarUrl: string | null };

export type PostMedia = { id: string; kind: "image" | "video" | "audio"; width: number | null; height: number | null; /** Signed, expires after an hour; null while uploads are off. */ url: string | null };

export type Post = {
  id: string;
  author: Author;
  body: string;
  visibility: Visibility;
  /** "held": waiting for review, visible only to its author. */
  status: "published" | "held" | string;
  media: PostMedia[];
  commentCount: number;
  reactionCount: number;
  myReactions: ReactionKind[];
  saved: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
};

export type FeedPage = { items: Post[]; next: string | null };

export type Comment = {
  id: string;
  parentId: string | null;
  body: string;
  status: "published" | "held" | string;
  author: Author;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
};
export type CommentPage = { items: Comment[]; next: string | null };

export type FollowState = "none" | "following" | "requested" | "self";

export type PersonProfile = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  privateAccount: boolean;
  followState: FollowState;
  friends: boolean;
  blocked: boolean;
  followers: number;
  following: number;
  canSeePosts: boolean;
};
export type PersonPage = { profile: PersonProfile; posts: FeedPage };

export type FollowRequest = { userId: string; handle: string; name: string; avatarUrl: string | null; createdAt: string };

export type FeedTab = "following" | "foryou" | "saved";

export const VISIBILITY_LABEL: Record<Visibility, { title: string; detail: string }> = {
  public: { title: "Everyone", detail: "Anyone on Cowork" },
  followers: { title: "Followers", detail: "People you approved to follow you" },
  friends: { title: "Friends", detail: "Your Chats friends only" },
};
