import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as React from "react";
import { keys } from "@/lib/queries";
import { appRoute } from "@/lib/routes";

// While the app is open, still show the banner: reminders are time-sensitive.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function hrefOf(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  return typeof data?.href === "string" ? data.href : null;
}

/**
 * Opens the matching screen when a push notification is tapped: while the app runs, from the
 * background, and on a cold start. Mounted only for a signed-in, onboarded session, so a tap before
 * sign-in does nothing instead of skipping the auth screens. Renders nothing.
 */
export function PushRouter() {
  const qc = useQueryClient();
  const handled = React.useRef(new Set<string>());

  React.useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.me });
      const route = appRoute(hrefOf(response));
      // A link the app has no screen for still lands somewhere useful: the notifications list.
      router.push(route ?? "/notifications");
      Notifications.clearLastNotificationResponse();
    };

    // Cold start: the tap that launched the app.
    const last = Notifications.getLastNotificationResponse();
    // Next frame, so the first screen has rendered before this pushes on top of it.
    const frame = last && last.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ? requestAnimationFrame(() => open(last)) : null;

    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) open(r);
    });
    // Arrived while the app is open: refresh the badge counts and the list.
    const received = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.me });
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      tapped.remove();
      received.remove();
    };
  }, [qc]);

  return null;
}
