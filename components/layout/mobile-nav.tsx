"use client";

import { DotsThreeOutline } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Sheet } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isActive, MOBILE_NAV, PRIMARY_NAV, SECONDARY_NAV } from "./nav";

/** Bottom tab bar on small screens (44px+ touch targets) with a "More" sheet. */
export function MobileNav() {
  const pathname = usePathname();
  const [more, setMore] = React.useState(false);
  const rest = [...PRIMARY_NAV.slice(4), ...SECONDARY_NAV];
  const moreActive = rest.some((i) => isActive(pathname, i));

  React.useEffect(() => setMore(false), [pathname]);

  return (
    <>
      <nav aria-label="Main navigation" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-5">
          {MOBILE_NAV.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px]", active ? "text-foreground" : "text-muted")}>
                  <Icon size={22} weight={active ? "fill" : "regular"} />
                  <span className="max-w-full truncate px-1">{item.label.split(" ")[0]}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={cn("flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px]", moreActive ? "text-foreground" : "text-muted")}>
              <DotsThreeOutline size={22} weight={moreActive ? "fill" : "regular"} />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="More" side="bottom">
        <ul className="grid grid-cols-2 gap-2 pb-4">
          {rest.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link href={item.href} className={cn("flex h-14 items-center gap-3 rounded-[12px] border px-4 text-sm", active ? "border-foreground" : "border-border")}>
                  <Icon size={20} weight={active ? "fill" : "regular"} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
