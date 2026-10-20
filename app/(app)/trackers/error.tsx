"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function TrackersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      message="This tracker couldn't load. Try again in a moment."
      retry={
        <Button size="sm" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
