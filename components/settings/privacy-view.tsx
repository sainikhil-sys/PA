"use client";

import { DownloadSimple, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { deleteSyncedData } from "@/app/actions/knowledge";
import { deleteAccount } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Row, Section } from "./section";

export type DataFlow = { what: string; where: string; why: string };

export function PrivacyView({ sources, flows }: { sources: { id: string; name: string; itemCount: number }[]; flows: DataFlow[] }) {
  const router = useRouter();
  const [confirmSource, setConfirmSource] = React.useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [pending, start] = React.useTransition();

  return (
    <div>
      <Section title="Export your data" description="Everything PA stores about you, minus secrets (tokens and hashes are never exported).">
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href="/api/export?format=json" download>
              <DownloadSimple /> Export JSON
            </a>
          </Button>
          <Button asChild variant="ghost">
            <a href="/api/export?format=md" download>
              <DownloadSimple /> Export Markdown
            </a>
          </Button>
        </div>
      </Section>

      <Section title="Synced data" description="Delete what PA indexed from each source. Nothing is deleted at the source itself.">
        {sources.length === 0 ? (
          <p className="text-[13px] text-muted">
            No synced sources. <Link href="/knowledge" className="underline underline-offset-4">Knowledge</Link>
          </p>
        ) : (
          sources.map((s) => (
            <Row key={s.id} label={s.name} hint={`${s.itemCount} items`}>
              <Button size="sm" variant="danger" onClick={() => setConfirmSource(s)}>
                <Trash /> Delete data
              </Button>
            </Row>
          ))
        )}
      </Section>

      <Section title="Where your data goes" description="Plain answers about each provider PA talks to.">
        <div className="overflow-x-auto rounded-[14px] border border-border">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Data</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Goes to</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {flows.map((f) => (
                <tr key={f.what + f.where}>
                  <td className="px-4 py-2.5">{f.what}</td>
                  <td className="px-4 py-2.5">{f.where}</td>
                  <td className="px-4 py-2.5 text-muted">{f.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Delete account" description="Removes your account and everything in PA: tasks, notes, chats, automations, knowledge and tokens. This can't be undone.">
        <Button variant="danger" className="w-fit" onClick={() => setDeleting(true)}>
          <Trash /> Delete account
        </Button>
      </Section>

      <Dialog
        open={confirmSource !== null}
        onOpenChange={(o) => !o && setConfirmSource(null)}
        title={`Delete synced data from ${confirmSource?.name}?`}
        footer={
          <>
            <Button onClick={() => setConfirmSource(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteSyncedData({ id: confirmSource!.id });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Deleted");
                  setConfirmSource(null);
                  router.refresh();
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">Indexed items and embeddings are removed from PA.</p>
      </Dialog>

      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete your account?"
        description="Type DELETE to confirm."
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={typed !== "DELETE" || pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteAccount({ confirm: "DELETE" });
                  if (!r.ok) return void toast.error(r.error);
                  window.location.assign("/login");
                })
              }
            >
              Delete everything
            </Button>
          </>
        }
      >
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm" placeholder="DELETE" />
      </Dialog>
    </div>
  );
}
