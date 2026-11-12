import * as React from "react";
import { FREE_ATTEMPTS, remainingLockoutMs, waitText } from "./logic";
import { useLock } from "./store";
import { feedback } from "@/lib/feedback";

/**
 * PIN entry that checks against the saved PIN: submits when the last digit is in, counts wrong PINs,
 * shows the wait after five, and buzzes on a wrong PIN. Used by the lock screen and by Settings.
 */
export function usePinCheck(onSuccess: () => void) {
  const length = useLock((s) => s.pinLength);
  const attempts = useLock((s) => s.attempts);
  const checkPin = useLock((s) => s.checkPin);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [wrong, setWrong] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  const waitMs = remainingLockoutMs(attempts, now);
  // Tick once a second while a wait runs, so the countdown and the keypad update on their own.
  React.useEffect(() => {
    if (remainingLockoutMs(attempts, Date.now()) <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [attempts]);

  const onChange = (next: string) => {
    setWrong(null);
    setValue(next);
    if (next.length !== length) return;
    setBusy(true);
    void checkPin(next)
      .then((r) => {
        setNow(Date.now());
        if (r.result === "ok") {
          setValue("");
          onSuccess();
          return;
        }
        setValue("");
        setShake((n) => n + 1);
        feedback.error();
        if (r.result === "wrong") {
          const left = FREE_ATTEMPTS - r.attempts.failures;
          setWrong(left > 0 ? `That PIN is not right. ${left === 1 ? "1 try left" : `${left} tries left`} before a short wait.` : "That PIN is not right.");
        }
      })
      .catch(() => {
        setValue("");
        setWrong("Cowork could not check your PIN. Try again.");
      })
      .finally(() => setBusy(false));
  };

  const message = waitMs > 0 ? `Too many wrong PINs. Try again in ${waitText(waitMs)}.` : wrong;
  return { length, value, onChange, busy, waiting: waitMs > 0, message, tone: (waitMs > 0 || wrong ? "danger" : "muted") as "danger" | "muted", shake };
}
