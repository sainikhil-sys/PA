"use client";

import { Check, Copy, Key, Sparkle, Trash, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { createTokenAction, revokeTokenAction } from "@/app/actions/tokens";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, inputClass } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { fetcher } from "@/lib/fetcher";
import { cn, timeAgo } from "@/lib/utils";
import { Row, Section } from "./section";

type Token = { id: string; name: string; prefix: string; kind: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type Activity = { id: string; tool: string; inputSummary: string; outcome: string; createdAt: string };

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-surface px-3 py-2.5 font-mono text-[13px]" aria-label={label}>
        {value}
      </code>
      <Button
        size="icon"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function ClaudeConnect({ mcpUrl, tokens, scopes }: { mcpUrl: string; tokens: Token[]; scopes: Record<string, string> }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("Claude");
  const [picked, setPicked] = React.useState<string[]>(Object.keys(scopes));
  const [expiry, setExpiry] = React.useState<"7" | "30" | "90" | "365" | "never">("90");
  const [newToken, setNewToken] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const { data: activity } = useSWR<{ items: Activity[] }>("/api/activity?actor=claude", fetcher, { refreshInterval: 5_000 });

  const active = tokens.filter((t) => !t.revokedAt && (!t.expiresAt || new Date(t.expiresAt) > new Date()));
  const lastUsed = active.map((t) => t.lastUsedAt).filter(Boolean).sort().at(-1);
  const connected = Boolean(lastUsed && Date.now() - new Date(lastUsed).getTime() < 7 * 86_400_000);

  return (
    <div>
      <Section title="Status">
        <div className="flex items-center gap-4 rounded-[14px] border border-border p-4">
          <BrandLogo id="claude" size={28} box />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <StatusDot state={connected ? "ok" : active.length ? "warn" : "idle"} pulse={connected} />
              {connected ? "Connected" : active.length ? "Ready, not used recently" : "Not connected"}
            </p>
            <p className="text-[13px] text-muted">{lastUsed ? `Last request ${timeAgo(lastUsed)}` : "Claude hasn't called PA yet."} · {active.length} active credential{active.length === 1 ? "" : "s"}</p>
          </div>
        </div>
      </Section>

      <Section title="Add PA to Claude" description="PA is a remote MCP server. Claude can read your tasks and briefing, claim and complete tasks, and search your knowledge. It can't send, post or delete anything.">
        <div className="flex flex-col gap-2">
          <Label>MCP server URL</Label>
          <CopyField value={mcpUrl} label="MCP server URL" />
        </div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-relaxed">
          <li>
            In Claude, open <span className="font-medium">Settings → Connectors</span> and choose <span className="font-medium">Add custom connector</span>.
          </li>
          <li>Name it “PA” and paste the URL above. Leave the OAuth fields empty.</li>
          <li>Click Connect. You'll land on PA's consent screen; review the scopes and approve.</li>
          <li>In a chat, enable the PA connector and try: “List my PA tasks.”</li>
        </ol>
        <p className="text-[13px] text-muted">
          Claude Code or another client that sends headers? Create a token below and use <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>.
        </p>
      </Section>

      <Section title="Credentials" description="Tokens are stored hashed and shown once. OAuth credentials appear here when Claude connects.">
        <div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Key /> Create token
          </Button>
        </div>
        {tokens.length === 0 ? (
          <p className="text-[13px] text-muted">No credentials yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[14px] border border-border">
            {tokens.map((t) => {
              const expired = t.expiresAt && new Date(t.expiresAt) < new Date();
              const off = t.revokedAt || expired;
              return (
                <li key={t.id} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center", off && "text-muted")}>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", off && "line-through")}>
                      {t.name} <span className="font-mono text-[12px] text-muted">{t.prefix}…</span>
                    </p>
                    <p className="text-[12px] text-muted">
                      {t.kind === "oauth" ? "OAuth" : "Token"} · {t.scopes.length} scopes · {t.revokedAt ? "revoked" : expired ? "expired" : t.expiresAt ? `expires ${new Date(t.expiresAt).toLocaleDateString()}` : "no expiry"} · {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"}
                    </p>
                  </div>
                  {!off ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await revokeTokenAction({ id: t.id });
                          if (!r.ok) return void toast.error(r.error);
                          toast.success("Revoked");
                          router.refresh();
                        })
                      }
                    >
                      <Trash /> Revoke
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Claude activity" description="Every tool call Claude makes, live.">
        {!activity?.items.length ? (
          <p className="text-[13px] text-muted">No activity yet.</p>
        ) : (
          <ol className="flex flex-col gap-2" aria-live="polite">
            {activity.items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-[13px]">
                {a.outcome === "success" ? <Sparkle size={16} className="text-muted" /> : <WarningCircle size={16} className="text-danger" />}
                <span className="font-mono">{a.tool}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{a.inputSummary}</span>
                {a.outcome !== "success" ? <span className="text-danger">{a.outcome}</span> : null}
                <span className="tabular shrink-0 text-subtle">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Dialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          if (!o) setNewToken(null);
        }}
        title={newToken ? "Copy your token" : "Create a token"}
        description={newToken ? "This is the only time it's shown. Store it somewhere safe." : "Least privilege: grant only what you need."}
        footer={
          newToken ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreating(false);
                setNewToken(null);
              }}
            >
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={pending || !picked.length || !name.trim()}
              onClick={() =>
                start(async () => {
                  const r = await createTokenAction({ name, scopes: picked as never, expiresInDays: expiry === "never" ? null : (Number(expiry) as 7) });
                  if (!r.ok) return void toast.error(r.error);
                  setNewToken(r.data.token);
                  router.refresh();
                })
              }
            >
              Create
            </Button>
          )
        }
      >
        {newToken ? (
          <CopyField value={newToken} label="Token" />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tk-name">Name</Label>
              <Input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-medium">Scopes</legend>
              {Object.entries(scopes).map(([k, v]) => (
                <label key={k} className="flex min-h-10 items-center gap-3 text-sm">
                  <Checkbox checked={picked.includes(k)} onCheckedChange={(c) => setPicked(c ? [...picked, k] : picked.filter((x) => x !== k))} aria-label={k} />
                  <span className="font-mono text-[12px]">{k}</span>
                  <span className="text-muted">{v}</span>
                </label>
              ))}
            </fieldset>
            <Row label="Expires" htmlFor="tk-exp">
              <select id="tk-exp" value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)} className={inputClass}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
                <option value="never">Never</option>
              </select>
            </Row>
          </div>
        )}
      </Dialog>
    </div>
  );
}
