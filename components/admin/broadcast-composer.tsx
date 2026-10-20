"use client";

import {
  ArrowDown,
  ArrowUp,
  Bell,
  CursorClick,
  EnvelopeSimple,
  Image as ImageIcon,
  LinkSimple,
  ListBullets,
  Minus,
  Paperclip,
  PaperPlaneTilt,
  Sparkle,
  TextAa,
  TextH,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { draftBroadcast, removeBroadcastFile, sendBroadcast, sendBroadcastTest } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/tabs";
import { BRAND } from "@/lib/brand";
import type { BroadcastEmailContent, MailBlock } from "@/lib/db/schema";
import {
  ACCEPT_ATTACHMENTS,
  ACCEPT_IMAGES,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_INLINE_BYTES,
  MAX_INLINE_IMAGES,
  MAX_TOTAL_BYTES,
  type UploadRole,
} from "@/lib/email/attachments";
import { BROADCAST_STYLE_IDS, BROADCAST_STYLES, cleanEmail, EMAIL_LIMITS as L, renderBroadcastEmail, safeMailUrl, type BroadcastStyle } from "@/lib/email/broadcast";

type Channel = "in_app" | "push" | "email";
const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: "in_app", label: "In-app", hint: "Bell in the top bar" },
  { id: "push", label: "Phones", hint: "Paired devices, if push is on" },
  { id: "email", label: "Email", hint: "If email updates are on" },
];

type FileMeta = { id: string; filename: string; size: number; contentType: string; role: UploadRole; width: number | null; height: number | null; preview?: string };
type Block = MailBlock & { key: string };

let seq = 0;
const withKey = (b: MailBlock): Block => ({ ...b, key: `b${++seq}` });
const stripKey = ({ key: _key, ...b }: Block) => b as MailBlock;

const BLOCK_META: Record<MailBlock["type"], { label: string; icon: React.ReactNode }> = {
  heading: { label: "Heading", icon: <TextH size={16} /> },
  text: { label: "Text", icon: <TextAa size={16} /> },
  list: { label: "List", icon: <ListBullets size={16} /> },
  button: { label: "Button", icon: <CursorClick size={16} /> },
  image: { label: "Image", icon: <ImageIcon size={16} /> },
  divider: { label: "Divider", icon: <Minus size={16} /> },
};

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** The first link problem in the email (buttons and image links must be real links). */
function linkProblem(email: BroadcastEmailContent, appBase: string): string | null {
  for (const b of email.blocks) {
    if (b.type === "button" && !safeMailUrl(b.url, appBase)) return `The "${b.label}" button needs a link that starts with https:// or an app path like /settings.`;
    if (b.type === "image" && b.href && !safeMailUrl(b.href, appBase)) return "An image link isn't valid.";
  }
  return null;
}

/**
 * Compose with AI → edit → preview → test → confirm. The email preview is rendered by the same
 * code that builds the real email. Nothing reaches anyone until the confirm click.
 */
export function BroadcastComposer({ audience, appBase }: { audience: number; appBase: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [style, setStyle] = React.useState<BroadcastStyle>("announcement");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [href, setHref] = React.useState("");
  const [channels, setChannels] = React.useState<Channel[]>(["in_app", "push", "email"]);
  const [subject, setSubject] = React.useState("");
  const [preheader, setPreheader] = React.useState("");
  const [headline, setHeadline] = React.useState("");
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [files, setFiles] = React.useState<Record<string, FileMeta>>({});
  const [attachmentIds, setAttachmentIds] = React.useState<string[]>([]);
  const [tab, setTab] = React.useState<"email" | "notification">("email");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(0);
  const [drafting, startDraft] = React.useTransition();
  const [sending, startSend] = React.useTransition();
  const [testing, startTest] = React.useTransition();
  const imageInput = React.useRef<HTMLInputElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const emailOn = channels.includes("email");
  // Untouched email fields fall back to the notification, so a quick announcement still makes a proper email.
  const email = React.useMemo(
    () =>
      cleanEmail({
        subject: subject || title,
        preheader,
        headline: headline || title,
        blocks: blocks.length ? blocks.map(stripKey) : [{ type: "text", text: body }],
      }),
    [subject, title, preheader, headline, blocks, body],
  );
  const imageIds = React.useMemo(() => [...new Set(email.blocks.flatMap((b) => (b.type === "image" ? [b.fileId] : [])))], [email]);
  const totalBytes = [...imageIds, ...attachmentIds].reduce((n, id) => n + (files[id]?.size ?? 0), 0);
  const problem = emailOn ? linkProblem(email, appBase) : null;
  const tooBig = emailOn && totalBytes > MAX_TOTAL_BYTES;
  const emailReady = email.subject.length >= 3 && email.headline.length > 0 && !problem && !tooBig;
  const canSend = title.trim().length >= 3 && body.trim().length >= 3 && channels.length > 0 && (!emailOn || emailReady) && uploading === 0;

  const deferredEmail = React.useDeferredValue(email);
  const previewHtml = React.useMemo(() => {
    const images = new Map(
      Object.values(files)
        .filter((f) => f.role === "inline")
        .map((f) => [f.id, { width: f.width, height: f.height }]),
    );
    const attachments = attachmentIds.flatMap((id) => {
      const f = files[id];
      return f ? [{ filename: f.filename, size: f.size }] : [];
    });
    const settings = `${appBase}/settings/notifications`;
    return renderBroadcastEmail(deferredEmail, { appBase, imageSrc: (id) => files[id]?.preview ?? null, images, attachments, manageUrl: settings, unsubscribeUrl: settings }).html;
  }, [deferredEmail, files, attachmentIds, appBase]);

  async function upload(file: File, role: UploadRole): Promise<FileMeta | null> {
    const max = role === "inline" ? MAX_INLINE_BYTES : MAX_ATTACHMENT_BYTES;
    if (file.size > max) {
      toast.error(`${file.name} is over ${formatBytes(max)}.`);
      return null;
    }
    setUploading((n) => n + 1);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("role", role);
      const res = await fetch("/api/admin/broadcast-files", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as (FileMeta & { error?: string }) | null;
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? `Couldn't upload ${file.name}.`);
        return null;
      }
      const meta: FileMeta = { ...data, preview: role === "inline" ? await readDataUrl(file) : undefined };
      setFiles((f) => ({ ...f, [meta.id]: meta }));
      return meta;
    } catch {
      toast.error(`Couldn't upload ${file.name}. Check your connection.`);
      return null;
    } finally {
      setUploading((n) => n - 1);
    }
  }

  function forgetFile(id: string) {
    void removeBroadcastFile({ id });
    setFiles(({ [id]: _gone, ...rest }) => rest);
  }

  /** Add blocks; the first ones added keep the notification message as the opening paragraph. */
  function appendBlocks(...added: MailBlock[]) {
    setBlocks((b) => [...(b.length || !body.trim() ? b : [withKey({ type: "text", text: body })]), ...added.map(withKey)]);
  }

  async function onImagePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const meta = await upload(file, "inline");
    if (meta) appendBlocks({ type: "image", fileId: meta.id, alt: "", href: "" });
  }

  async function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    let room = MAX_ATTACHMENTS - attachmentIds.length;
    for (const file of picked) {
      if (room <= 0) {
        toast.error(`An email can carry up to ${MAX_ATTACHMENTS} attachments.`);
        break;
      }
      const meta = await upload(file, "attachment");
      if (meta) {
        room--;
        setAttachmentIds((ids) => [...ids, meta.id]);
      }
    }
  }

  function addBlock(type: MailBlock["type"]) {
    if (blocks.length >= L.blocks) return void toast.error(`An email can have up to ${L.blocks} blocks.`);
    if (type === "image") {
      if (imageIds.length >= MAX_INLINE_IMAGES) return void toast.error(`An email can show up to ${MAX_INLINE_IMAGES} images.`);
      return imageInput.current?.click();
    }
    const fresh: Record<Exclude<MailBlock["type"], "image">, MailBlock> = {
      heading: { type: "heading", text: "" },
      text: { type: "text", text: "" },
      list: { type: "list", items: [""] },
      button: { type: "button", label: "", url: "" },
      divider: { type: "divider" },
    };
    appendBlocks(fresh[type]);
  }

  function updateBlock(key: string, next: MailBlock) {
    setBlocks((b) => b.map((x) => (x.key === key ? { ...next, key } : x)));
  }

  function moveBlock(index: number, by: -1 | 1) {
    setBlocks((b) => {
      const to = index + by;
      if (to < 0 || to >= b.length) return b;
      const copy = [...b];
      [copy[index], copy[to]] = [copy[to]!, copy[index]!];
      return copy;
    });
  }

  function removeBlock(key: string) {
    const gone = blocks.find((b) => b.key === key);
    setBlocks((b) => b.filter((x) => x.key !== key));
    if (gone?.type === "image" && !blocks.some((b) => b.key !== key && b.type === "image" && b.fileId === gone.fileId)) forgetFile(gone.fileId);
  }

  function draft() {
    startDraft(async () => {
      const r = await draftBroadcast({ prompt: note, style });
      if (!r.ok) return void toast.error(r.error);
      setTitle(r.data.title);
      setBody(r.data.body);
      setSubject(r.data.email.subject);
      setPreheader(r.data.email.preheader);
      setHeadline(r.data.email.headline);
      // Images already added stay, after the first paragraph.
      const drafted = r.data.email.blocks.map(withKey);
      const images = blocks.filter((b) => b.type === "image");
      setBlocks(images.length ? [...drafted.slice(0, 1), ...images, ...drafted.slice(1)] : drafted);
      setTab("email");
    });
  }

  function sendTest() {
    startTest(async () => {
      const r = await sendBroadcastTest({ email, attachmentIds });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Test sent to ${r.data.to}`);
    });
  }

  function send() {
    startSend(async () => {
      const r = await sendBroadcast({ title, body, href, channels, email: emailOn ? email : undefined, attachmentIds: emailOn ? attachmentIds : [], confirm: true });
      if (!r.ok) return void toast.error(r.error);
      setConfirmOpen(false);
      setNote("");
      setTitle("");
      setBody("");
      setHref("");
      setSubject("");
      setPreheader("");
      setHeadline("");
      setBlocks([]);
      setFiles({});
      setAttachmentIds([]);
      toast.success("Sending now. Progress shows below.");
      router.refresh();
    });
  }

  const channelNames = channels.map((c) => CHANNELS.find((x) => x.id === c)!.label).join(", ");
  const fileSummary = emailOn && (imageIds.length || attachmentIds.length) ? ` The email carries ${imageIds.length} image${imageIds.length === 1 ? "" : "s"} and ${attachmentIds.length} attachment${attachmentIds.length === 1 ? "" : "s"} (${formatBytes(totalBytes)}).` : "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <Section title="Write with AI">
          <Textarea id="bc-note" aria-label="What to announce" rows={3} placeholder="e.g. we launched Spotify and YouTube in the Today room, plus phone notifications" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
            <Segmented id="bc-style" label="Template" value={style} onChange={setStyle} options={BROADCAST_STYLE_IDS.map((id) => ({ value: id, label: BROADCAST_STYLES[id].label }))} />
          </div>
          <FieldHint>{BROADCAST_STYLES[style].guide} Links come only from your note or app pages.</FieldHint>
          <Button variant="secondary" className="w-fit" disabled={drafting || note.trim().length < 5} onClick={draft}>
            <Sparkle /> {drafting ? "Writing…" : "Draft notification and email"}
          </Button>
        </Section>

        <Section title="Notification" hint="In the app and on phones. Short, no links.">
          <Field id="bc-title" label="Title">
            <Input id="bc-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="bc-body" label="Message">
            <Textarea id="bc-body" rows={3} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Field id="bc-href" label="Opens (optional)">
            <Input id="bc-href" placeholder="/settings/devices" value={href} onChange={(e) => setHref(e.target.value)} />
          </Field>
        </Section>

        {emailOn ? (
          <Section title="Email" hint="Starts from the notification. Add sections, links, images and files.">
            <Field id="bc-subject" label="Subject">
              <Input id="bc-subject" maxLength={L.subject} placeholder={title || "Subject line"} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field id="bc-preheader" label="Preview text (optional)">
              <Input id="bc-preheader" maxLength={L.preheader} placeholder="The line inboxes show after the subject" value={preheader} onChange={(e) => setPreheader(e.target.value)} />
            </Field>
            <Field id="bc-headline" label="Headline">
              <Input id="bc-headline" maxLength={L.headline} placeholder={title || "Headline"} value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </Field>

            {blocks.length ? (
              <ol className="flex flex-col gap-2" aria-label="Email blocks">
                {blocks.map((b, i) => (
                  <li key={b.key} className="rounded-[12px] border border-border bg-background p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
                      {BLOCK_META[b.type].icon}
                      <span>{BLOCK_META[b.type].label}</span>
                      <div className="ml-auto flex">
                        <Button size="icon" variant="quiet" aria-label="Move up" disabled={i === 0} onClick={() => moveBlock(i, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button size="icon" variant="quiet" aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => moveBlock(i, 1)}>
                          <ArrowDown />
                        </Button>
                        <Button size="icon" variant="quiet" aria-label={`Remove ${BLOCK_META[b.type].label.toLowerCase()}`} onClick={() => removeBlock(b.key)}>
                          <Trash />
                        </Button>
                      </div>
                    </div>
                    <BlockFields block={b} appBase={appBase} file={b.type === "image" ? files[b.fileId] : undefined} onChange={(next) => updateBlock(b.key, next)} />
                  </li>
                ))}
              </ol>
            ) : (
              <FieldHint>The message above is the email body. Add blocks to build a longer email.</FieldHint>
            )}

            <div role="group" className="flex flex-wrap gap-2" aria-label="Add a block">
              {(Object.keys(BLOCK_META) as MailBlock["type"][]).map((t) => (
                <Button key={t} variant="secondary" disabled={t === "image" && uploading > 0} onClick={() => addBlock(t)}>
                  {BLOCK_META[t].icon} {BLOCK_META[t].label}
                </Button>
              ))}
            </div>
            <input ref={imageInput} type="file" accept={ACCEPT_IMAGES} className="hidden" onChange={onImagePicked} />

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-[13px] font-medium">Attachments</p>
              <FieldHint>PDF, Word, Excel, PowerPoint, CSV, text or calendar files, up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.</FieldHint>
              {attachmentIds.length ? (
                <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
                  {attachmentIds.map((id) => (
                    <li key={id} className="flex items-center gap-2 pl-3 text-[13px]">
                      <Paperclip size={16} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">{files[id]?.filename ?? "File"}</span>
                      <span className="tabular shrink-0 text-subtle">{formatBytes(files[id]?.size ?? 0)}</span>
                      <Button
                        size="icon"
                        variant="quiet"
                        aria-label={`Remove ${files[id]?.filename ?? "file"}`}
                        onClick={() => {
                          setAttachmentIds((ids) => ids.filter((x) => x !== id));
                          forgetFile(id);
                        }}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" disabled={uploading > 0 || attachmentIds.length >= MAX_ATTACHMENTS} onClick={() => fileInput.current?.click()}>
                  <Paperclip /> {uploading > 0 ? "Uploading…" : "Attach files"}
                </Button>
                <span className={tooBig ? "text-[12px] text-danger" : "tabular text-[12px] text-subtle"}>
                  {formatBytes(totalBytes)} of {formatBytes(MAX_TOTAL_BYTES)}
                </span>
              </div>
              <input ref={fileInput} type="file" multiple accept={ACCEPT_ATTACHMENTS} className="hidden" onChange={onFilesPicked} />
            </div>
            <FieldError>{problem ?? (tooBig ? `Images and attachments are over ${formatBytes(MAX_TOTAL_BYTES)}.` : null)}</FieldError>
          </Section>
        ) : null}

        <Section title="Send">
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="sr-only">Send to</legend>
            {CHANNELS.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-2 text-[13px]">
                <Checkbox checked={channels.includes(c.id)} onCheckedChange={(v) => setChannels(v ? [...channels, c.id] : channels.filter((x) => x !== c.id))} aria-label={c.label} />
                {c.label} <span className="text-subtle">· {c.hint}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {emailOn ? (
              <Button variant="secondary" disabled={testing || !emailReady || uploading > 0} onClick={sendTest}>
                <EnvelopeSimple /> {testing ? "Sending test…" : "Send test to me"}
              </Button>
            ) : null}
            <Button variant="primary" disabled={!canSend} onClick={() => setConfirmOpen(true)}>
              <PaperPlaneTilt /> Review and send
            </Button>
          </div>
        </Section>
      </div>

      <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
        <Segmented
          id="bc-preview"
          label="Preview"
          value={tab}
          onChange={setTab}
          options={[
            { value: "email", label: "Email", icon: <EnvelopeSimple size={16} /> },
            { value: "notification", label: "Notification", icon: <Bell size={16} /> },
          ]}
        />
        {tab === "email" ? (
          emailOn ? (
            <>
              <p className="truncate text-[12px] text-muted">
                Subject: <span className="text-foreground">{email.subject || "…"}</span>
                {email.preheader ? <span className="text-subtle"> · {email.preheader}</span> : null}
              </p>
              {/* Sandboxed: no scripts, no navigation. Same renderer as the real email; images are local previews. */}
              <iframe title="Email preview" sandbox="" srcDoc={previewHtml} data-lenis-prevent className="h-[680px] w-full rounded-[14px] border border-border bg-white" />
            </>
          ) : (
            <p className="rounded-[14px] border border-border bg-surface p-4 text-[13px] text-muted">Email is off for this announcement. Turn it on under Send.</p>
          )
        ) : (
          <>
            <div className="card rounded-[14px] border border-border bg-background p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Announcement</p>
              <p className="mt-1 text-[17px] font-medium">{title || "Your title"}</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] text-muted">{body || "Your message appears here, as a notification and a phone alert."}</p>
            </div>
            <div className="flex items-start gap-3 rounded-[14px] border border-border bg-surface p-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-foreground text-[13px] font-medium text-background">{BRAND.name.charAt(0)}</span>
              <div className="min-w-0 text-[13px]">
                <p className="font-medium">{title || "Your title"}</p>
                <p className="line-clamp-2 text-muted">{body || "Phone notification preview"}</p>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Send this announcement?"
        description={`It goes to ${audience.toLocaleString()} account${audience === 1 ? "" : "s"} via ${channelNames}. This can't be unsent.${fileSummary}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={sending} onClick={send}>
              <PaperPlaneTilt /> {sending ? "Sending…" : "Send to everyone"}
            </Button>
          </>
        }
      >
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">{body}</p>
        {emailOn ? <p className="mt-3 text-[13px] text-muted">Email subject: {email.subject}</p> : null}
      </Dialog>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <div>
        <h2 className="text-[15px] font-medium">{title}</h2>
        {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function BlockFields({ block, appBase, file, onChange }: { block: Block; appBase: string; file?: FileMeta; onChange: (b: MailBlock) => void }) {
  const b = stripKey(block);
  switch (b.type) {
    case "heading":
      return <Input aria-label="Heading" maxLength={L.heading} placeholder="Section heading" value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} />;
    case "text":
      return <TextBlock value={b.text} appBase={appBase} onChange={(text) => onChange({ ...b, text })} />;
    case "list":
      return (
        <>
          <Textarea aria-label="List items" rows={4} placeholder="One item per line" value={b.items.join("\n")} onChange={(e) => onChange({ ...b, items: e.target.value.split("\n").slice(0, L.listItems) })} />
          <FieldHint className="mt-1">One item per line. **bold** and [label](link) work here too.</FieldHint>
        </>
      );
    case "button": {
      const bad = b.url.trim() !== "" && !safeMailUrl(b.url, appBase);
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <Input aria-label="Button label" maxLength={L.buttonLabel} placeholder="Open Cowork" value={b.label} onChange={(e) => onChange({ ...b, label: e.target.value })} />
          <Input aria-label="Button link" aria-invalid={bad} placeholder="https://… or /settings" value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} />
          {bad ? <FieldError>Use a link that starts with https:// or an app path like /settings.</FieldError> : null}
        </div>
      );
    }
    case "image": {
      const bad = Boolean(b.href?.trim()) && !safeMailUrl(b.href ?? "", appBase);
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          {file?.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data: preview of the upload
            <img src={file.preview} alt="" className="h-24 w-auto max-w-40 shrink-0 rounded-[10px] border border-border object-cover" />
          ) : (
            <div className="grid h-24 w-32 shrink-0 place-items-center rounded-[10px] border border-dashed border-border text-[12px] text-subtle">Image</div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Input aria-label="Describe the image" maxLength={L.alt} placeholder="Describe the image (for people who can't see it)" value={b.alt} onChange={(e) => onChange({ ...b, alt: e.target.value })} />
            <Input aria-label="Image link (optional)" aria-invalid={bad} placeholder="Link when clicked (optional)" value={b.href ?? ""} onChange={(e) => onChange({ ...b, href: e.target.value })} />
            {file ? (
              <p className="truncate text-[12px] text-subtle">
                {file.filename} · {formatBytes(file.size)}
                {file.width ? ` · ${file.width}×${file.height}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      );
    }
    case "divider":
      return <p className="text-[12px] text-subtle">A thin line between sections.</p>;
  }
}

/** Text with an "Insert link" helper that writes [label](url) at the cursor (or around the selection). */
function TextBlock({ value, appBase, onChange }: { value: string; appBase: string; onChange: (v: string) => void }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const selection = React.useRef<[number, number]>([0, 0]);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const urlOk = url.trim() !== "" && safeMailUrl(url, appBase) !== null;

  function openLink() {
    const t = ref.current;
    const start = t?.selectionStart ?? value.length;
    const end = t?.selectionEnd ?? value.length;
    selection.current = [start, end];
    setLabel(value.slice(start, end));
    setUrl("");
    setLinkOpen(true);
  }

  function insert() {
    const [start, end] = selection.current;
    const text = `[${(label.trim() || url.trim()).replace(/[[\]\n]/g, " ")}](${url.trim()})`;
    onChange(value.slice(0, start) + text + value.slice(end));
    setLinkOpen(false);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea ref={ref} aria-label="Text" rows={4} maxLength={L.text} placeholder="Write a paragraph" value={value} onChange={(e) => onChange(e.target.value)} />
      {linkOpen ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-2 sm:flex-row">
          <Input aria-label="Link text" placeholder="Link text" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input
            aria-label="Link address"
            placeholder="https://… or /settings"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && urlOk) {
                e.preventDefault();
                insert();
              }
            }}
          />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!urlOk} onClick={insert}>
              Insert
            </Button>
            <Button variant="quiet" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3">
          <Button variant="quiet" className="w-fit px-2" onClick={openLink}>
            <LinkSimple /> Insert link
          </Button>
          <span className="text-[12px] text-subtle">**bold** · blank line = new paragraph</span>
        </div>
      )}
    </div>
  );
}
