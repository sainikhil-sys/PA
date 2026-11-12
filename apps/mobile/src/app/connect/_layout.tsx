import { Stack } from "expo-router";
import * as React from "react";
import { useCalls } from "@/features/connect/calls";
import { useConnect } from "@/features/connect/connect-store";
import { startFiles } from "@/features/connect/files";
import { startGroups } from "@/features/connect/groups";
// Registers the receiver for contact cards shared nearby.
import "@/features/connect/social-cards";
import { useWalkie } from "@/features/connect/walkie";
import { useMe } from "@/lib/queries";
import { color } from "@/theme/tokens";

/**
 * Every Connect screen sits under this layout, so opening any of them starts Connect and every
 * feature listener (files, groups, Walkie, calls, cards). They stay registered for the rest of the
 * session: links and their traffic outlive the screens, including with the app in the background.
 */
export default function ConnectLayout() {
  const me = useMe();
  const name = me.data?.name ?? "";

  React.useEffect(() => {
    void useConnect.getState().init(name);
  }, [name]);

  React.useEffect(() => {
    startFiles();
    startGroups();
    void useWalkie.getState().start().catch(() => {});
    void useCalls.getState().start().catch(() => {});
  }, []);

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
