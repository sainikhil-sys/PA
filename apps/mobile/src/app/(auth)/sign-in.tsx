import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Input, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { pendingEmail } from "@/lib/session";
import { AuthFrame, Heading } from "@/features/onboarding/frame";
import { color } from "@/theme/tokens";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254) });
type Form = z.infer<typeof schema>;

/** One email field for both sign-in and sign-up: the emailed code creates the account if it's new. */
export default function SignIn() {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const inflight = React.useRef(false);

  const submit = () =>
    // handleSubmit runs in the press handler, not during render (React Compiler rule).
    handleSubmit(async ({ email }) => {
      if (inflight.current) return;
      inflight.current = true;
      setServerError(null);
      try {
        await api<{ ok: boolean; message: string }>("/api/mobile/auth/request", { body: { email } });
        await pendingEmail.set(email);
        router.push("/verify");
      } catch (err) {
        setServerError(errorText(err));
      } finally {
        inflight.current = false;
      }
    })();

  return (
    <AuthFrame
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
      footer={<Button label="Send code" variant="primary" loading={formState.isSubmitting} onPress={() => void submit()} />}
    >
      <Heading title="Sign in or create an account" body="Enter your email and we'll send a 6-digit code. If you don't have an account yet, the same code creates one." />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            label="Email"
            value={field.value}
            onChangeText={(t) => {
              field.onChange(t);
              if (serverError) setServerError(null);
            }}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            inputMode="email"
            returnKeyType="send"
            autoFocus
            onSubmitEditing={() => void submit()}
            editable={!formState.isSubmitting}
          />
        )}
      />
      {serverError ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {serverError}
        </Txt>
      ) : null}
    </AuthFrame>
  );
}
