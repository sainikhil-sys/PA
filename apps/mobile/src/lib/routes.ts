import type { Href } from "expo-router";

const id = (href: string, key: string) => new RegExp(`[?&]${key}=([\\w-]+)`).exec(href)?.[1];

/**
 * Where a website link (a notification's `href`) goes in the app, or null when the app has no
 * matching screen. Used by the notifications list and by taps on push notifications.
 */
export function appRoute(href: string | null | undefined): Href | null {
  if (!href || !href.startsWith("/")) return null;
  if (href === "/" || href.startsWith("/?")) return "/";
  if (/^\/chat\/[\w-]+$/.test(href)) return href as Href;
  // Chats (person-to-person): a conversation, the list, or friend requests.
  if (/^\/dm\/[\w-]+$/.test(href)) return href as Href;
  if (href === "/chats") return "/chats";
  if (href === "/people" || href.startsWith("/people?")) return "/people";
  if (href === "/approvals" || href.startsWith("/approvals?")) return "/approvals";
  if (href === "/tasks" || href.startsWith("/tasks?")) {
    const task = id(href, "task");
    return task ? `/task/${task}` : "/tasks";
  }
  // An agent run's result lives on the task itself.
  if (href.startsWith("/agents?")) {
    const task = id(href, "task");
    return task ? `/task/${task}` : null;
  }
  if (href === "/notes" || href.startsWith("/notes?") || href.startsWith("/knowledge?tab=notes")) {
    const note = id(href, "note");
    return note ? `/notes/${note}` : "/notes";
  }
  if (href === "/meetings" || href.startsWith("/meetings?")) {
    const meeting = id(href, "meeting");
    return meeting ? `/meeting/${meeting}` : "/agenda";
  }
  if (href === "/notifications") return "/notifications";
  return null;
}
