"use client";

import { usePathname } from "next/navigation";
import { TabLinks } from "@/components/ui/tabs";

const ITEMS = [
  { href: "/knowledge", label: "Sources" },
  { href: "/knowledge/notes", label: "Notes" },
];

export function KnowledgeTabs() {
  const active = usePathname().startsWith("/knowledge/notes") ? "/knowledge/notes" : "/knowledge";
  return <TabLinks id="knowledge" items={ITEMS} active={active} />;
}
