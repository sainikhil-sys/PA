import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold } from "@expo-google-fonts/hanken-grotesk";
import { Newsreader_400Regular } from "@expo-google-fonts/newsreader";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PushRouter } from "@/features/notifications/push-router";
import { queryClient } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { color } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: color.bg, card: color.bg, primary: color.orange, text: color.text, border: color.border },
};

/**
 * Launch: restore the session from secure storage, then route by state. Signed out sees Welcome;
 * a new account resumes onboarding where it stopped; everyone else lands on Home.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, Newsreader_400Regular });
  const status = useSession((s) => s.status);
  const onboarding = useSession((s) => s.onboarding);
  const restore = useSession((s) => s.restore);

  React.useEffect(() => {
    void restore();
  }, [restore]);

  React.useEffect(() => {
    // A sign-out (or expired session) clears cached data from the previous account.
    if (status === "signedOut") queryClient.clear();
  }, [status]);

  // A font that fails to load falls back to the system face rather than holding the splash screen.
  const ready = (fontsLoaded || Boolean(fontError)) && status !== "restoring";
  React.useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  const signedIn = status === "signedIn";
  const onboarded = onboarding === "done";

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, animation: "fade_from_bottom" }}>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
              <Stack.Protected guard={signedIn && !onboarded}>
                <Stack.Screen name="onboarding" />
              </Stack.Protected>
              <Stack.Protected guard={signedIn && onboarded}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="chat/[id]" />
                <Stack.Screen name="task/[id]" options={{ presentation: "modal" }} />
                <Stack.Screen name="approvals" />
                <Stack.Screen name="notifications" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="search" />
                <Stack.Screen name="agenda" />
                <Stack.Screen name="meeting/[id]" />
                <Stack.Screen name="notes" />
              </Stack.Protected>
            </Stack>
            {/* After the Stack, so the navigator is mounted before a cold-start tap navigates. */}
            {signedIn && onboarded ? <PushRouter /> : null}
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
