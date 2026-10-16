"use client";

import { CalendarBlank, Lightbulb, NotePencil, Plus, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { createIdea, dismissIdea, draftFromIdea, refreshIdeas } from "@/app/actions/content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { timeAgo } from "@/lib/utils";

export type IdeaRow = { id: string; title: string; hook: string | null; source: string; createdAt: string };
export type DraftRow = { id: string; title: string; status: string; writtenBy: string; updatedAt: string; scheduledFor: string | null; preview: string };

const STATUS: Record<string, { label: string; variant: "solid" | "outline" | "soft" | "dashed" }> = {
  draft: { label: "Draft", variant: "dashed" },
  approved: { label: "Approved", variant: "outline" },
  scheduled: { label: "Scheduled", variant: "solid" },
  published: { label: "Published", variant: "soft" },
};

export function ContentPage({ ideas, drafts }: { ideas: IdeaRow[]; drafts: DraftRow[] }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"ideas" | "drafts" | "calendar">("ideas");
  const [newIdea, setNewIdea] = React.useState("");
  const [pending, start] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const scheduled = drafts.filter((d) => d.scheduledFor).sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));
  const byDay = scheduled.reduce<Record<string, DraftRow[]>>((acc, d) => {
    const k = new Date(d.scheduledFor!).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    (acc[k] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <Segmented
        id="content-tab"
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: "ideas", label: "Suggestions", icon: <Lightbulb size={16} /> },
          { value: "drafts", label: `Drafts · ${drafts.length}`, icon: <NotePencil size={16} /> },
          { value: "calendar", label: "Calendar", icon: <CalendarBlank size={16} /> },
        ]}
      />

      {tab === "ideas" ? (
        <div className="flex flex-col gap-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await createIdea({ title: newIdea });
                if (!res.ok) return void toast.error(res.error);
                setNewIdea("");
                router.refresh();
              });
            }}
          >
            <Input value={newIdea} onChange={(e) => setNewIdea(e.target.value)} placeholder="Capture an idea…" aria-label="New idea" />
            <Button type="submit" disabled={pending || newIdea.trim().length < 3}>
              <Plus /> Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await refreshIdeas({});
                  if (!res.ok) return void toast.error(res.error);
                  router.refresh();
                })
              }
            >
              Suggest more
            </Button>
          </form>
          {ideas.length === 0 ? (
            <Card>
              <EmptyState icon={Lightbulb} title="No ideas yet" description="Add one, or turn a news story into an idea from the Today page." />
            </Card>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {ideas.map((i) => (
                <li key={i.id}>
                  <Card className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{i.title}</p>
                      <Badge variant="soft">{i.source === "agent" ? "Suggested" : i.source === "news" ? "From news" : i.source === "claude" ? "From Claude" : "Yours"}</Badge>
                    </div>
                    {i.hook ? <p className="font-serif text-[15px] italic leading-snug text-muted">“{i.hook}”</p> : null}
                    <div className="mt-auto flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === i.id}
                        onClick={() => {
                          setBusyId(i.id);
                          start(async () => {
                            const res = await draftFromIdea({ ideaId: i.id });
                            setBusyId(null);
                            if (!res.ok) return void toast.error(res.error);
                            router.push(`/content/${res.data.id}`);
                          });
                        }}
                      >
                        <NotePencil /> {busyId === i.id ? "Drafting…" : "Draft"}
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label="Dismiss idea"
                        onClick={() =>
                          start(async () => {
                            await dismissIdea({ id: i.id });
                            router.refresh();
                          })
                        }
                      >
                        <X />
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === "drafts" ? (
        drafts.length === 0 ? (
          <Card>
            <EmptyState icon={NotePencil} title="No drafts yet" description="Draft from an idea, or ask your agent: “draft a post about…”." />
          </Card>
        ) : (
          <ul className="divide-y divide-border rounded-[16px] border border-border">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/content/${d.id}`} className="flex flex-col gap-1 p-4 hover:bg-surface sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="line-clamp-1 text-[13px] text-muted">{d.preview}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                    {d.writtenBy !== "me" ? <Badge variant="outline">{d.writtenBy === "claude" ? "By Claude" : "By agent"}</Badge> : null}
                    <Badge variant={STATUS[d.status]?.variant ?? "soft"}>{STATUS[d.status]?.label ?? d.status}</Badge>
                    <span>{timeAgo(d.updatedAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : scheduled.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarBlank} title="Nothing scheduled" description="Approve a draft, then pick a time. You'll get a reminder to post it." />
        </Card>
      ) : (
        <ol className="flex flex-col gap-6">
          {Object.entries(byDay).map(([day, list]) => (
            <li key={day}>
              <h3 className="mb-2 text-[13px] font-medium text-muted">{day}</h3>
              <ul className="flex flex-col gap-2">
                {list.map((d) => (
                  <li key={d.id}>
                    <Link href={`/content/${d.id}`} className="flex items-center gap-4 rounded-[12px] border border-border p-4 hover:border-border-strong">
                      <span className="tabular text-sm">{new Date(d.scheduledFor!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="truncate text-sm">{d.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
