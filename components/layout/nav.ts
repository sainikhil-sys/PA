import {
  Books,
  ChatCircle,
  CheckSquare,
  GearSix,
  Lightning,
  PenNib,
  PuzzlePiece,
  SunHorizon,
  Tray,
  type Icon,
} from "@phosphor-icons/react";

export type NavItem = { href: string; label: string; icon: Icon; match?: string[] };

/** Primary group (max 7 items) and a secondary group, per the taste rules. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Today", icon: SunHorizon },
  { href: "/chat", label: "Chat", icon: ChatCircle },
  { href: "/inbox", label: "Inbox", icon: Tray },
  { href: "/tasks", label: "Tasks & Schedule", icon: CheckSquare, match: ["/schedule"] },
  { href: "/automations", label: "Automations", icon: Lightning },
  { href: "/knowledge", label: "Knowledge", icon: Books },
  { href: "/content", label: "Content", icon: PenNib },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/integrations", label: "Integrations", icon: PuzzlePiece },
  { href: "/settings", label: "Settings", icon: GearSix },
];

export const MOBILE_NAV: NavItem[] = [PRIMARY_NAV[0]!, PRIMARY_NAV[1]!, PRIMARY_NAV[2]!, PRIMARY_NAV[3]!];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
