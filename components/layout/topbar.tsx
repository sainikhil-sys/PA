"use client";

import { Bell, Gear, MagnifyingGlass, Microphone, Plugs, SignOut, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { signOutAction } from "@/app/actions/auth";
import { markNotificationsRead } from "@/app/actions/notifications";
import { Avatar, Kbd, Tooltip } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { fetcher } from "@/lib/fetcher";
import { cn, greeting, timeAgo } from "@/lib/utils";
import { Logo } from "./logo";
import { useShell } from "./shell-context";

function useLocalHour(tz: string) {
  const [state, setState] = React.useState<{ hour: number; date: string } | null>(null);
  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
      const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(now);
      setState({ hour, date });
    };
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
  }, [tz]);
  return state;
}

export function Topbar() {
  const { user, openPalette, openVoice } = useShell();
  const local = useLocalHour(user.timezone);
  const firstName = user.name?.split(" ")[0];

  return (
    <header className="no-print sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-[2px] supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        <div className="lg:hidden">
          <Logo withWord={false} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[20px] leading-tight tracking-[-0.01em] sm:text-[22px]">
            {local ? `${greeting(local.hour)}${firstName ? `, ${firstName}` : ""}` : " "}
          </p>
          <p className="hidden truncate text-[12px] text-muted sm:block">{local?.date ?? " "}</p>
        </div>

        <button
          type="button"
          onClick={openPalette}
          className="hidden h-10 w-[260px] items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-sm text-subtle transition-colors hover:border-border-strong md:flex"
          aria-label="Open command palette"
        >
          <MagnifyingGlass size={18} />
          <span className="flex-1 text-left">Search or ask…</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </button>
        <Tooltip content="Search (⌘K)">
          <button type="button" onClick={openPalette} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground md:hidden" aria-label="Search">
            <MagnifyingGlass size={20} />
          </button>
        </Tooltip>
        <Tooltip content="Talk to your agent">
          <button type="button" onClick={openVoice} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Start voice">
            <Microphone size={20} />
          </button>
        </Tooltip>
        <NotificationsMenu />
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-surface-hover" aria-label="Account menu">
              <Avatar src={user.avatarUrl} name={user.name} email={user.email} size={32} />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>
              <span className="block truncate text-sm text-foreground">{user.name ?? "You"}</span>
              <span className="block truncate">{user.email}</span>
            </MenuLabel>
            <MenuSeparator />
            <MenuItem asChild>
              <Link href="/settings">
                <UserCircle /> Profile
              </Link>
            </MenuItem>
            <MenuItem asChild>
              <Link href="/settings/agent">
                <Gear /> Agent settings
              </Link>
            </MenuItem>
            <MenuItem asChild>
              <Link href="/settings/claude">
                <Plugs /> Connect Claude
              </Link>
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => void signOutAction()}>
              <SignOut /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}

type NotificationRow = { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };

function NotificationsMenu() {
  const { data, mutate } = useSWR<{ items: NotificationRow[]; unread: number }>("/api/notifications", fetcher, { refreshInterval: 15_000 });
  const unread = data?.unread ?? 0;
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open && unread > 0) void markNotificationsRead({}).then(() => mutate());
      }}
    >
      <MenuTrigger asChild>
        <button type="button" className="relative grid size-11 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell size={20} />
          {unread > 0 ? <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-foreground ring-2 ring-background" aria-hidden /> : null}
        </button>
      </MenuTrigger>
      <MenuContent className="w-[340px]">
        <MenuLabel>Notifications</MenuLabel>
        <div className="max-h-[360px] overflow-y-auto" data-lenis-prevent>
          {!data?.items.length ? (
            <p className="px-2.5 py-6 text-center text-[13px] text-muted">You're all caught up.</p>
          ) : (
            data.items.map((n) => (
              <MenuItem key={n.id} asChild className="h-auto items-start py-2.5">
                <Link href={n.href ?? "/"}>
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-foreground")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm">{n.title}</span>
                    {n.body ? <span className="line-clamp-2 block text-[12px] text-muted">{n.body}</span> : null}
                    <span className="block text-[11px] text-subtle">{timeAgo(n.createdAt)}</span>
                  </span>
                </Link>
              </MenuItem>
            ))
          )}
        </div>
      </MenuContent>
    </Menu>
  );
}
