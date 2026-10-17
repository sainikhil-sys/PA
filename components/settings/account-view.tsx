"use client";

import { Desktop, DeviceMobile, SignOut } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { revokeSessionAction, signOutEverywhereAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { Row, Section } from "./section";

type S = { id: string; userAgent: string | null; ipPrefix: string | null; lastSeenAt: string; current: boolean };
type L = { id: string; tool: string; outcome: string; at: string; detail: string | null };

function device(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /iphone|android|mobile/i.test(ua);
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome/i.test(ua) ? "Chrome" : /firefox/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Browser";
  const os = /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : /iphone|ipad/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /linux/i.test(ua) ? "Linux" : "";
  return { label: `${browser}${os ? ` on ${os}` : ""}`, mobile };
}

const LOG_LABEL: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "auth.sign_out_everywhere": "Signed out everywhere",
  "auth.session_revoked": "Session revoked",
  "integration.connected": "Integration connected",
  "integration.disconnected": "Integration disconnected",
  "token.created": "Claude token created",
  "token.revoked": "Claude token revoked",
  "oauth.token": "Claude authorized via OAuth",
};

export function AccountView({ email, sessions, log }: { email: string; sessions: S[]; log: L[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div>
      <Section title="Email" description="You sign in with a one-time code sent here.">
        <Row label={email} hint="To change it, add the new address to ALLOWED_EMAILS, sign in with it (verified by a code), then remove the old one. The single-user guard stays on.">
          <span className="text-[13px] text-muted">Verified</span>
        </Row>
      </Section>
      <Section title="Active sessions" description="Devices currently signed in.">
        <ul className="divide-y divide-border rounded-[14px] border border-border">
          {sessions.map((s) => {
            const d = device(s.userAgent);
            const Icon = d.mobile ? DeviceMobile : Desktop;
            return (
              <li key={s.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <Icon size={20} className="text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {d.label} {s.current ? <span className="text-[12px] text-muted">· this device</span> : null}
                  </p>
                  <p className="text-[12px] text-muted">
                    {s.ipPrefix ? `${s.ipPrefix} · ` : ""}active {timeAgo(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await revokeSessionAction(s.id);
                        toast.success("Session signed out");
                        router.refresh();
                      })
                    }
                  >
                    Sign out
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Button variant="danger" className="w-fit" onClick={() => start(() => signOutEverywhereAction())}>
          <SignOut /> Sign out everywhere
        </Button>
      </Section>
      <Section title="Connected accounts">
        <Row label="Google, Notion, Slack, GitHub…" hint="Manage what Cowork can read.">
          <Button asChild size="sm">
            <Link href="/integrations">Manage</Link>
          </Button>
        </Row>
      </Section>
      <Section title="Security log" description="Sign-ins, connections, tokens and approvals.">
        {log.length === 0 ? (
          <p className="text-[13px] text-muted">No events yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {log.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  {LOG_LABEL[l.tool] ?? l.tool.replace(/[._]/g, " ")}
                  {l.outcome !== "success" ? <span className="text-danger"> · {l.outcome}</span> : null}
                </span>
                <span className="tabular shrink-0 text-muted">{timeAgo(l.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
