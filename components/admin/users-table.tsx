"use client";

import Link from "next/link";
import * as React from "react";
import { suspendUsers } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import type { UserSearchResult } from "@/lib/admin/users-query";
import { timeAgo } from "@/lib/utils";
import { useAdminCall } from "./users-call";

type Row = UserSearchResult["rows"][number];

function status(u: Row): string {
  const parts = [];
  if (u.disabledAt) parts.push("Suspended");
  if (u.restrictions) parts.push(`${u.restrictions} restriction${u.restrictions === 1 ? "" : "s"}`);
  if (!u.onboardedAt) parts.push("Not onboarded");
  return parts.join(", ") || "Active";
}

/** Results table. With users.suspend, rows can be selected and suspended together (confirmed first). */
export function UsersTable({ rows, canSuspend, meId }: { rows: Row[]; canSuspend: boolean; meId: string }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  const { pending, run, dialog } = useAdminCall();
  const selectable = rows.filter((r) => r.id !== meId && !r.disabledAt);
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  if (!rows.length) return <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">No accounts match these filters.</p>;

  return (
    <div className="flex flex-col gap-3">
      {canSuspend && selected.size ? (
        <div className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-3 sm:flex-row sm:items-center">
          <p className="shrink-0 text-[13px]">
            <span className="tabular">{selected.size}</span> selected
          </p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, kept in the audit log" maxLength={500} className="h-9 text-[13px]" aria-label="Reason for suspending" />
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                run((token) => suspendUsers({ userIds: [...selected], reason }, token), {
                  done: (d) => `Suspended ${d.suspended} account${d.suspended === 1 ? "" : "s"}`,
                  confirmLabel: "Suspend",
                  onDone: () => {
                    setSelected(new Set());
                    setReason("");
                  },
                })
              }
            >
              Suspend selected
            </Button>
          </div>
        </div>
      ) : null}
      <div className="card overflow-x-auto rounded-[14px] border border-border bg-background">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-border text-[12px] text-muted">
            <tr>
              {canSuspend ? (
                <th className="w-10 px-3 py-2 font-normal">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={selectable.length > 0 && selectable.every((r) => selected.has(r.id))}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(selectable.map((r) => r.id)) : new Set())}
                  />
                </th>
              ) : null}
              <th className="px-3 py-2 font-normal">Account</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Platform</th>
              <th className="px-3 py-2 font-normal">App version</th>
              <th className="px-3 py-2 font-normal">Joined</th>
              <th className="px-3 py-2 font-normal">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((u) => (
              <tr key={u.id}>
                {canSuspend ? (
                  <td className="px-3 py-2 align-middle">
                    {u.id === meId || u.disabledAt ? null : <Checkbox aria-label={`Select ${u.email}`} checked={selected.has(u.id)} onCheckedChange={(v) => toggle(u.id, v === true)} />}
                  </td>
                ) : null}
                <td className="max-w-[280px] px-3 py-2 align-middle">
                  <Link href={`/console/users/${u.id}`} className="block min-w-0 hover:underline">
                    <span className="block truncate font-medium">{u.name ?? u.email.split("@")[0]}</span>
                    <span className="block truncate text-[12px] text-muted">{u.email}</span>
                  </Link>
                </td>
                <td className={u.disabledAt ? "px-3 py-2 align-middle text-danger" : "px-3 py-2 align-middle text-muted"}>{status(u)}</td>
                <td className="px-3 py-2 align-middle text-muted">{u.platforms.length ? u.platforms.map((p) => (p === "android" ? "Android" : "Web")).join(", ") : "None live"}</td>
                <td className="tabular px-3 py-2 align-middle text-muted">{u.appVersion ?? "Not reported"}</td>
                <td className="px-3 py-2 align-middle text-muted">{timeAgo(u.createdAt)}</td>
                <td className="px-3 py-2 align-middle text-muted">{u.lastSeen ? timeAgo(u.lastSeen) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}
