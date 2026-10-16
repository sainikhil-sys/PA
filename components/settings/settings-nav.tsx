"use client";

import { usePathname } from "next/navigation";
import { TabLinks } from "@/components/ui/tabs";

const ITEMS = [
  { href: "/settings", label: "Profile" },
  { href: "/settings/agent", label: "Agent" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/privacy", label: "Data & privacy" },
  { href: "/settings/appearance", label: "Appearance" },
  { href: "/settings/claude", label: "Connect Claude" },
];

export function SettingsNav() {
  const pathname = usePathname();
  const active = ITEMS.slice().reverse().find((i) => pathname === i.href || (i.href !== "/settings" && pathname.startsWith(i.href)))?.href ?? "/settings";
  return <TabLinks id="settings" items={ITEMS} active={active} />;
}
