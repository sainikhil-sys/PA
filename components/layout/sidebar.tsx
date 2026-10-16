"use client";

import { SidebarSimple } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Tooltip } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { isActive, PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav";

const KEY = "pa:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch {}
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-[var(--ease-out)] lg:flex",
        collapsed ? "w-[72px]" : "w-[244px]",
      )}
      aria-label="Main navigation"
    >
      <div className={cn("flex h-16 items-center", collapsed ? "justify-center" : "justify-between px-4")}>
        {!collapsed ? (
          <Link href="/" className="flex items-center gap-2 rounded-md">
            <Logo />
          </Link>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          className="grid size-10 place-items-center rounded-[10px] text-muted hover:bg-surface-hover hover:text-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          <SidebarSimple size={20} />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4 pt-2" data-lenis-prevent>
        <NavGroup items={PRIMARY_NAV} pathname={pathname} collapsed={collapsed} />
        <div className="mt-auto">
          <NavGroup items={SECONDARY_NAV} pathname={pathname} collapsed={collapsed} />
        </div>
      </nav>
    </aside>
  );
}

function NavGroup({ items, pathname, collapsed }: { items: NavItem[]; pathname: string; collapsed: boolean }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        const link = (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 items-center gap-3 rounded-[10px] text-[14px] transition-colors duration-150",
              collapsed ? "justify-center" : "px-3",
              active ? "text-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span layoutId="nav-active" className="absolute inset-0 rounded-[10px] border border-border bg-background" transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} />
            ) : null}
            <Icon size={20} weight={active ? "fill" : "regular"} className="relative shrink-0" />
            {!collapsed ? <span className={cn("relative truncate", active && "font-medium")}>{item.label}</span> : <span className="sr-only">{item.label}</span>}
          </Link>
        );
        return (
          <li key={item.href}>
            {collapsed ? (
              <Tooltip content={item.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}
