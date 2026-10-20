import { router } from "expo-router";
import * as React from "react";
import { View } from "react-native";
import { Button, Skeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { pendingEmail, useSession } from "@/lib/session";
import { CODE_LENGTH, CodeInput } from "@/features/onboarding/code-input";
import { AuthFrame, Heading } from "@/features/onboarding/frame";
import { color, space } from "@/theme/tokens";

const RESEND_SECONDS = 30;

/**
 * Enter the emailed code. A full code submits on its own; on success the session is stored and the
 * root layout routes onward (new accounts to setup, everyone else to Home).
 */
export default function Verify() {
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = React.useState<string | null | undefined>(undefined);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(RESEND_SECONDS);
  const [resending, setResending] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void pendingEmail
      .get()
      .catch(() => null)
      .then((e) => {
        if (!alive) return;
        if (e) setEmail(e);
        else router.replace("/sign-in");
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = React.useCallback(
    async (value: string) => {
      if (!email || busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await api<{ ok: true; token: string; isNew: boolean }>("/api/mobile/auth/verify", { body: { email, code: value } });
        await signIn(res.token, res.isNew);
        // The root layout's guards take over from here.
      } catch (err) {
        setError(errorText(err));
        setCode("");
        setBusy(false);
      }
    },
    [email, busy, signIn],
  );

  const onChange = (next: string) => {
    setCode(next);
    if (error) setError(null);
    if (next.length === CODE_LENGTH) void verify(next);
  };

  const resend = async () => {
    if (!email || cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/mobile/auth/request", { body: { email } });
      setNotice(res.message);
      setCooldown(RESEND_SECONDS);
      setCode("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setResending(false);
    }
  };

  const changeEmail = () => (router.canGoBack() ? router.back() : router.replace("/sign-in"));

  return (
    <AuthFrame
      onBack={changeEmail}
      footer={
        <>
          <Button
            label={busy ? "Checking code" : "Verify"}
            variant="primary"
            loading={busy}
            disabled={code.length !== CODE_LENGTH || !email}
            onPress={() => void verify(code)}
          />
          <Button
            label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            variant="ghost"
            loading={resending}
            disabled={cooldown > 0 || busy || !email}
            onPress={() => void resend()}
            accessibilityLabel={cooldown > 0 ? `Resend code available in ${cooldown} seconds` : "Resend code"}
          />
        </>
      }
    >
      {email === undefined ? (
        <Skeleton rows={2} />
      ) : (
        <>
          <Heading title="Check your email" body={`We sent a 6-digit code to ${email ?? "your email"}. It works for 10 minutes.`} />
          <View style={{ gap: space.md }}>
            <CodeInput value={code} onChange={onChange} disabled={busy} error={Boolean(error)} />
            {error ? (
              <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
                {error}
              </Txt>
            ) : null}
            {notice ? (
              <Txt variant="small" accessibilityLiveRegion="polite">
                {notice}
              </Txt>
            ) : null}
          </View>
          <Button label="Use a different email" variant="ghost" compact onPress={changeEmail} style={{ alignSelf: "flex-start", minHeight: 48, paddingHorizontal: 0 }} />
        </>
      )}
    </AuthFrame>
  );
}
