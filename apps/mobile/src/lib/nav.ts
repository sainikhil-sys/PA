import { router, type Href } from "expo-router";

/**
 * Back when there is somewhere to go back to; otherwise (opened from a link or a notification, so
 * the screen is the only one in the stack) replace it with a sensible parent.
 */
export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
