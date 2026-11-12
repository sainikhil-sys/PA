import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { getCalendars } from "expo-localization";
import { router } from "expo-router";
import { GlobeIcon } from "phosphor-react-native";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { View } from "react-native";
import { z } from "zod";
import { Button, Input, Skeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { keys, useMe } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { AuthFrame, Heading, Note, StepIndicator, useStepGuard } from "@/features/onboarding/frame";
import { color, space } from "@/theme/tokens";

const schema = z.object({ name: z.string().trim().max(80, "Keep it under 80 characters.") });
type Form = z.infer<typeof schema>;

function detectedTimeZone(): string | undefined {
  try {
    return getCalendars()[0]?.timeZone ?? undefined;
  } catch {
    return undefined;
  }
}

/** Setup step 1: what to call you, and the phone's time zone for reminders and your day plan. */
export default function Profile() {
  const qc = useQueryClient();
  const me = useMe();
  const setOnboarding = useSession((s) => s.setOnboarding);
  const timezone = React.useMemo(() => detectedTimeZone(), []);
  const [busy, setBusy] = React.useState<"save" | "skip" | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: "" } });
  const inflight = React.useRef(false);
  const redirecting = useStepGuard("profile");

  React.useEffect(() => {
    if (me.data?.name && !formState.isDirty) reset({ name: me.data.name });
  }, [me.data?.name, formState.isDirty, reset]);

  const next = async () => {
    await setOnboarding("privacy");
    router.replace("/onboarding/privacy");
  };

  const save = () =>
    // handleSubmit runs in the press handler, not during render (React Compiler rule).
    handleSubmit(async ({ name }) => {
      if (inflight.current) return;
      inflight.current = true;
      setBusy("save");
      setServerError(null);
      try {
        await api<{ ok: true }>("/api/mobile/me", { method: "PATCH", body: { ...(name ? { name } : {}), ...(timezone ? { timezone } : {}) } });
        void qc.invalidateQueries({ queryKey: keys.me });
        await next();
      } catch (err) {
        inflight.current = false;
        setServerError(errorText(err));
        setBusy(null);
      }
    })();

  const skip = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy("skip");
    setServerError(null);
    // Still send the time zone so reminders land at the right hour; a failure here is not a blocker.
    if (timezone) await api("/api/mobile/me", { method: "PATCH", body: { timezone } }).catch(() => {});
    void qc.invalidateQueries({ queryKey: keys.me });
    try {
      await next();
    } catch (err) {
      inflight.current = false;
      setServerError(errorText(err));
      setBusy(null);
    }
  };

  if (redirecting) return null;

  return (
    <AuthFrame
      footer={
        <>
          <Button label="Continue" variant="primary" loading={busy === "save"} disabled={busy !== null || me.isPending} onPress={() => void save()} />
          <Button label="Skip" variant="ghost" loading={busy === "skip"} disabled={busy !== null} onPress={() => void skip()} />
        </>
      }
    >
      <StepIndicator step="profile" />
      <Heading title="What should Cowork call you?" body="Cowork uses it when it talks to you. You can change it later on the website." />
      {me.isPending ? (
        <Skeleton rows={1} height={52} />
      ) : (
        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <Input
              label="Name"
              value={field.value}
              onChangeText={(t) => {
                field.onChange(t);
                if (serverError) setServerError(null);
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              placeholder="Your name"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              maxLength={80}
              onSubmitEditing={() => void save()}
              editable={busy === null}
            />
          )}
        />
      )}
      {me.isError ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
          <Txt variant="small" style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {`Couldn't load your profile. ${errorText(me.error)}`}
          </Txt>
          <Button label="Try again" compact onPress={() => void me.refetch()} style={{ minHeight: 48 }} accessibilityLabel="Try loading your profile again" />
        </View>
      ) : null}
      <Note style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
        <GlobeIcon size={20} color={color.muted} />
        <View style={{ flex: 1 }} accessible accessibilityLabel={timezone ? `Time zone, ${timezone}, from this phone` : "Time zone not detected"}>
          <Txt variant="label">Time zone</Txt>
          <Txt variant="small">{timezone ? `${timezone}, from this phone` : "Not detected on this phone. You can set it later in Settings on the website."}</Txt>
        </View>
      </Note>
      {serverError ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {serverError}
        </Txt>
      ) : null}
    </AuthFrame>
  );
}
