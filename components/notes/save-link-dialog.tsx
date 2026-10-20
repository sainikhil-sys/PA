"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveBookmarkAction } from "@/app/actions/notes";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { normalizeTags } from "@/lib/notes/text";

/** "Save link": stores the URL plus the page's title and description, and says when those couldn't be fetched. */
export function SaveLinkDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => void }) {
  const [url, setUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [pending, start] = React.useTransition();

  const save = () =>
    start(async () => {
      const r = await saveBookmarkAction({ url, tags: normalizeTags(tags) });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.existed) toast("Already saved");
      else if (!r.data.fetched) toast.success("Link saved", { description: `Couldn't fetch the page details. ${r.data.reason ?? ""}`.trim() });
      else toast.success("Link saved");
      setUrl("");
      setTags("");
      onOpenChange(false);
      onDone(r.data.id);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save a link"
      description="We fetch the page's title and description. Only public pages can be fetched."
      footer={
        <Button variant="primary" disabled={pending || !url.trim()} onClick={save}>
          {pending ? "Fetching…" : "Save"}
        </Button>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !pending && url.trim()) save();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="link-url">URL</Label>
          <Input id="link-url" type="text" inputMode="url" autoComplete="url" autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="link-tags">Tags (optional)</Label>
          <Input id="link-tags" placeholder="reading, pricing" value={tags} onChange={(e) => setTags(e.target.value)} />
          <FieldHint>Comma separated.</FieldHint>
        </div>
      </div>
    </Dialog>
  );
}
