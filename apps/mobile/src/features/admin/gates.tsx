import { useQueryClient } from "@tanstack/react-query";
import { FingerprintIcon, GlobeIcon, LockKeyIcon, ShieldStarIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { Button, Input, Screen, Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { ApiError, errorText } from "@/lib/api";
import { color, radius, space } from "@/theme/tokens";
import { adminKeys, adminRaw, endAdminSession, type AdminMe } from "./api";
import { confirmBiometric } from "./biometric";
import { useAdminToken } from "./token-store";
import { ADMIN_MAX_WIDTH, clockTime, openWebConsole } from "./ui";

function GateLayout({ icon: IconCmp, title, children }: { icon: typeof LockKeyIcon; title: string; children: React.ReactNode }) {
  return (
    <Screen>
      <BackHeader title="Admin console" fallback="/settings" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl, width: "100%", maxWidth: ADMIN_MAX_WIDTH, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.md }}>
            <View style={{ width: 52, height: 52, borderRadius: radius.card, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: "center", justifyContent: "center" }}>
              <IconCmp size={26} color={color.accentText} />
            </View>
            <Txt variant="title" accessibilityRole="header">
              {title}
            </Txt>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Two-step verification isn't set up yet: that happens on the website console only. */
export function MfaSetupNeeded() {
  return (
    <GateLayout icon={ShieldStarIcon} title="Set up two-step verification first">
      <Txt variant="bodyMuted">
        The admin console asks for a code from an authenticator app. Set that up on the website console first, then come back here and enter a code to unlock.
      </Txt>
      <Button label="Open the website console" variant="primary" icon={GlobeIcon} onPress={openWebConsole} />
    </GateLayout>
  );
}

/** Unlock with an authenticator or recovery code. The token comes back once and stays in memory only. */
export function StepUpScreen({ me }: { me: AdminMe }) {
  const qc = useQueryClient();
  const notice = useAdminToken((s) => s.notice);
  const unlock = useAdminToken((s) => s.unlock);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // When the screen opened, or the last attempt: a lockout that has passed doesn't block the field.
  const [now, setNow] = React.useState(() => Date.now());
  const lockedUntil = me.lockedUntil && new Date(me.lockedUntil).getTime() > now ? me.lockedUntil : null;
  const cleaned = code.trim();
  const ready = cleaned.length >= 6 && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setNow(Date.now());
    try {
      const r = await adminRaw<{ expiresAt: string; adminToken?: string }>("/api/admin/step-up", { method: "POST", body: { code: cleaned } });
      if (!r.adminToken) {
        setError("The server didn't return an admin session. Try again.");
        return;
      }
      unlock(r.adminToken, r.expiresAt);
      setCode("");
      void qc.invalidateQueries({ queryKey: adminKeys.me });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? err.message : errorText(err));
      // Too many wrong codes locks admin access for a while; the server says until when.
      if (err instanceof ApiError && err.status === 401) void qc.invalidateQueries({ queryKey: adminKeys.me });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateLayout icon={LockKeyIcon} title="Unlock the admin console">
      {notice ? (
        <Txt variant="body" accessibilityLiveRegion="polite">
          {notice}
        </Txt>
      ) : null}
      <Txt variant="bodyMuted">Enter the 6-digit code from your authenticator app, or one of your recovery codes. The console stays unlocked on this phone until you lock it, close the app or stop using it for a while.</Txt>
      {lockedUntil ? (
        <Txt variant="body" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {`Too many wrong codes. Admin access is locked until ${clockTime(lockedUntil)}.`}
        </Txt>
      ) : null}
      <Input
        label="Code"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          setError(null);
        }}
        placeholder="123456"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={20}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        error={error}
        editable={!lockedUntil}
      />
      <Button label="Unlock" variant="primary" loading={busy} disabled={!ready || Boolean(lockedUntil)} onPress={() => void submit()} />
      <Txt variant="small">{`Signed in as ${me.role}. Two-step verification is managed on the website console.`}</Txt>
    </GateLayout>
  );
}

/** The biometric gate after time in the background. The admin session itself is unchanged. */
export function BiometricGate() {
  const setLocked = useAdminToken((s) => s.setBiometricLocked);
  const [failed, setFailed] = React.useState(false);
  const tryUnlock = React.useCallback(async () => {
    const ok = await confirmBiometric("Unlock the admin console");
    setFailed(!ok);
    if (ok) setLocked(false);
  }, [setLocked]);

  // Ask once when the gate appears; the button asks again.
  React.useEffect(() => {
    let live = true;
    void confirmBiometric("Unlock the admin console").then((ok) => {
      if (!live) return;
      setFailed(!ok);
      if (ok) setLocked(false);
    });
    return () => {
      live = false;
    };
  }, [setLocked]);

  return (
    <GateLayout icon={FingerprintIcon} title="Admin console locked">
      <Txt variant="bodyMuted">{"This is a lock on this phone only. Cowork's server still asks for your admin code when the admin session ends."}</Txt>
      {failed ? (
        <Txt variant="small" accessibilityLiveRegion="polite">
          Not unlocked. Try again, or lock the console and unlock it with your code.
        </Txt>
      ) : null}
      <Button label="Unlock with fingerprint or face" variant="primary" icon={FingerprintIcon} onPress={() => void tryUnlock()} />
      <Button
        label="Lock and use my code"
        variant="ghost"
        onPress={() => {
          void adminRaw("/api/admin/lock", { method: "POST" }).catch(() => {});
          endAdminSession();
        }}
      />
    </GateLayout>
  );
}
