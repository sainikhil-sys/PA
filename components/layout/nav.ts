import {
  Books,
  Newspaper,
  UsersThree,
  RocketLaunch,
  ChartLineUp,
  SealCheck,
  ChatCircle,
  CheckSquare,
  GearSix,
  Lightning,
  PenNib,
  DeviceMobile,
  PuzzlePiece,
  Robot,
  SunHorizon,
  Tray,
  type Icon,
} from "@phosphor-icons/react";

export type NavItem = { href: string; label: string; icon: Icon; match?: string[] };

/** Small counts shown next to nav items, keyed by href (e.g. pending approvals). */
export type NavBadges = Record<string, number>;

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
  { href: "/feed", label: "Feed", icon: Newspaper, match: ["/p", "/u"] },
  { href: "/spaces", label: "Spaces", icon: UsersThree, match: ["/s", "/join"] },
  { href: "/startups", label: "Startups", icon: RocketLaunch },
  { href: "/approvals", label: "Approvals", icon: SealCheck },
  { href: "/trackers", label: "Trackers", icon: ChartLineUp },
  { href: "/phone", label: "Phone", icon: DeviceMobile },
  { href: "/agents", label: "Agents & sprints", icon: Robot },
  { href: "/integrations", label: "Integrations", icon: PuzzlePiece },
  { href: "/settings", label: "Settings", icon: GearSix },
];

export const MOBILE_NAV: NavItem[] = [PRIMARY_NAV[0]!, PRIMARY_NAV[1]!, PRIMARY_NAV[2]!, PRIMARY_NAV[3]!];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
