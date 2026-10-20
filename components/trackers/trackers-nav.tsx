"use client";

import { usePathname } from "next/navigation";
import { TabLinks } from "@/components/ui/tabs";

const ITEMS = [
  { href: "/trackers/money", label: "Money" },
  { href: "/trackers/learning", label: "Learning" },
];

export function TrackersNav() {
  const pathname = usePathname();
  const active = ITEMS.find((i) => pathname.startsWith(i.href))?.href ?? ITEMS[0]!.href;
  return <TabLinks id="trackers" items={ITEMS} active={active} />;
}
