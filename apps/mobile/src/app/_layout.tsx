import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold } from "@expo-google-fonts/hanken-grotesk";
import { Newsreader_400Regular } from "@expo-google-fonts/newsreader";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Launch } from "@/components/launch";
import { useAdminLifecycle } from "@/features/admin/lifecycle";
import { GateOverlay, gateCovers } from "@/features/config/gate-overlay";
import { useClientConfigSync, useGate } from "@/features/config/use-client-config";
import { PushRouter } from "@/features/notifications/push-router";
import { queryClient } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useScheme, useThemePreference } from "@/theme/preference";
import { color, setScheme, type Scheme } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync();

/** Navigation colours for the active scheme (read after setScheme). */
function navTheme(scheme: Scheme) {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, background: color.bg, card: color.bg, primary: color.accentText, text: color.text, border: color.border } };
}

/**
 * Launch: restore the session from secure storage, then route by state. Signed out sees Welcome;
 * a new account resumes onboarding where it stopped; everyone else lands on Home.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, Newsreader_400Regular });
  const status = useSession((s) => s.status);
  const onboarding = useSession((s) => s.onboarding);
  const restore = useSession((s) => s.restore);
  const loadTheme = useThemePreference((s) => s.load);
  const themeLoaded = useThemePreference((s) => s.loaded);
  const scheme = useScheme();
  // Before anything renders: every `color.x` read below uses this scheme.
  setScheme(scheme);
  // Client configuration (cached copy first, then the server) and the update or maintenance screen.
  useClientConfigSync();
  const gate = useGate();
  const pathname = usePathname();
  const covered = gateCovers(gate, pathname);
  // The admin session ends with the user session; the biometric gate tracks time in the background.
  useAdminLifecycle();

  React.useEffect(() => {
    void loadTheme();
  }, [loadTheme]);

  React.useEffect(() => {
    // The window behind the app (seen during transitions and the keyboard) matches the theme.
    void SystemUI.setBackgroundColorAsync(color.bg).catch(() => {});
  }, [scheme]);

  React.useEffect(() => {
    void restore();
  }, [restore]);

  React.useEffect(() => {
    // A sign-out (or expired session) clears cached data from the previous account.
    if (status === "signedOut") queryClient.clear();
  }, [status]);

  // A font that fails to load falls back to the system face rather than holding the splash screen.
  const fontsReady = fontsLoaded || Boolean(fontError);
  const ready = fontsReady && status !== "restoring" && themeLoaded;
  // The system splash (one image) hands over to the launch view as soon as text can draw; the launch
  // view stays only until the session and settings are restored, then fades out.
  React.useEffect(() => {
    if (fontsReady && themeLoaded) void SplashScreen.hideAsync();
  }, [fontsReady, themeLoaded]);
  if (!fontsReady || !themeLoaded) return null;
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <Launch />
      </View>
    );
  }

  const signedIn = status === "signedIn";
  const onboarded = onboarding === "done";

  return (
    // Keyed on the scheme: a theme change re-mounts the app so every screen redraws in the new palette
    // (screens read colours during render; the React Compiler would otherwise keep the old ones).
    <GestureHandlerRootView key={scheme} style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navTheme(scheme)}>
            <StatusBar style={scheme === "dark" ? "light" : "dark"} />
            <View style={{ flex: 1 }} importantForAccessibility={covered ? "no-hide-descendants" : "auto"}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, animation: "fade_from_bottom" }}>
                <Stack.Protected guard={!signedIn}>
                  <Stack.Screen name="(auth)" />
                </Stack.Protected>
                <Stack.Protected guard={signedIn && !onboarded}>
                  <Stack.Screen name="onboarding" />
                </Stack.Protected>
                <Stack.Protected guard={signedIn && onboarded}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="tasks" />
                  <Stack.Screen name="chat/[id]" />
                  <Stack.Screen name="task/[id]" options={{ presentation: "modal" }} />
                  <Stack.Screen name="approvals" />
                  <Stack.Screen name="notifications" />
                  <Stack.Screen name="settings" />
                  <Stack.Screen name="search" />
                  <Stack.Screen name="agenda" />
                  <Stack.Screen name="meeting/[id]" />
                  <Stack.Screen name="notes" />
                  <Stack.Screen name="admin" />
                </Stack.Protected>
              </Stack>
            </View>
            <GateOverlay gate={gate} />
            {/* After the Stack, so the navigator is mounted before a cold-start tap navigates. */}
            {signedIn && onboarded ? <PushRouter /> : null}
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
