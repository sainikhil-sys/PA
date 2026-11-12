"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { call } from "./api";

type State = "none" | "following" | "requested" | "self";

const LABEL: Record<Exclude<State, "self">, string> = { none: "Follow", following: "Following", requested: "Requested" };

/** Follow, or cancel a request, or unfollow (asks first). */
export function FollowButton({ userId, initial }: { userId: string; initial: State }) {
  const router = useRouter();
  const [state, setState] = React.useState(initial);
  const [pending, start] = React.useTransition();
  if (state === "self") return null;
  const toggle = () =>
    start(async () => {
      if (state === "following" && !window.confirm("Unfollow? You'll stop seeing their followers-only posts.")) return;
      const r = await call<{ state: State }>("/api/follows", { body: { action: state === "none" ? "follow" : "unfollow", userId } });
      if (!r.ok) return void toast.error(r.error);
      setState(r.data.state);
      router.refresh();
    });
  return (
    <Button size="sm" variant={state === "none" ? "primary" : "secondary"} disabled={pending} onClick={toggle}>
      {LABEL[state]}
    </Button>
  );
}

/** Accept or decline someone's request to follow you. */
export function FollowRequestActions({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      const r = await call("/api/follows", { body: { action: accept ? "accept" : "decline", userId } });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  return (
    <span className="flex gap-1.5">
      <Button size="sm" variant="primary" disabled={pending} onClick={() => answer(true)}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => answer(false)}>
        Decline
      </Button>
    </span>
  );
}
