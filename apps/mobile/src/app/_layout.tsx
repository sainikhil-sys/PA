import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold } from "@expo-google-fonts/hanken-grotesk";
import { Newsreader_400Regular } from "@expo-google-fonts/newsreader";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ReducedMotionConfig, ReduceMotion } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Launch } from "@/components/launch";
import { useAdminLifecycle } from "@/features/admin/lifecycle";
import { GateOverlay, gateCovers } from "@/features/config/gate-overlay";
import { useClientConfigSync, useGate } from "@/features/config/use-client-config";
import { LockGate } from "@/features/lock/gate";
import { PushRouter } from "@/features/notifications/push-router";
import { cachePersister, persistOptions } from "@/lib/persist";
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
  // The opening animation plays once per launch, over the app, until it hands over.
  const [launched, setLaunched] = React.useState(false);
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
    if (status === "signedOut") {
      queryClient.clear();
      // The offline copy of Chats belongs to the account that signed out.
      void cachePersister.removeClient();
    }
  }, [status]);

  // A font that fails to load falls back to the system face rather than holding the splash screen.
  const fontsReady = fontsLoaded || Boolean(fontError);
  const ready = fontsReady && status !== "restoring" && themeLoaded;
  // The system splash (one image) hands over to the launch animation as soon as text can draw. The
  // app mounts underneath once the session and settings are restored; the animation finishes, then
  // fades into it.
  React.useEffect(() => {
    if (fontsReady && themeLoaded) void SplashScreen.hideAsync();
  }, [fontsReady, themeLoaded]);
  const onLaunched = React.useCallback(() => setLaunched(true), []);
  if (!fontsReady || !themeLoaded) return null;

  const signedIn = status === "signedIn";
  const onboarded = onboarding === "done";

  return (
    // The launch view keeps its place in this tree, so it does not restart when the app mounts.
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {ready ? (
        // App lock sits over the mounted app; its lock screen follows the launch animation.
        <LockGate launched={launched} scheme={scheme}>
          <App scheme={scheme} signedIn={signedIn} onboarded={onboarded} gate={gate} covered={covered} />
        </LockGate>
      ) : null}
      {launched ? null : <Launch ready={ready} onDone={onLaunched} />}
    </View>
  );
}

function App({ scheme, signedIn, onboarded, gate, covered }: { scheme: Scheme; signedIn: boolean; onboarded: boolean; gate: ReturnType<typeof useGate>; covered: boolean }) {
  // Settings > Appearance > Reduce motion: every Reanimated animation follows it, on top of the phone's setting.
  const motion = useThemePreference((st) => st.motion);
  return (
    // Keyed on the scheme: a theme change re-mounts the app so every screen redraws in the new palette
    // (screens read colours during render; the React Compiler would otherwise keep the old ones).
    <GestureHandlerRootView key={scheme} style={{ flex: 1, backgroundColor: color.bg }}>
      <ReducedMotionConfig mode={motion === "reduce" ? ReduceMotion.Always : ReduceMotion.System} />
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
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
                  <Stack.Screen name="dm" />
                  <Stack.Screen name="people" />
                  <Stack.Screen name="post/new" options={{ presentation: "modal" }} />
                  <Stack.Screen name="post/[id]" />
                  <Stack.Screen name="u/[handle]" />
                  <Stack.Screen name="follows" />
                  <Stack.Screen name="connect" />
                  <Stack.Screen name="space/new" options={{ presentation: "modal" }} />
                  <Stack.Screen name="space/[id]" />
                  <Stack.Screen name="workspace" />
                  <Stack.Screen name="admin" />
                </Stack.Protected>
              </Stack>
            </View>
            <GateOverlay gate={gate} />
            {/* After the Stack, so the navigator is mounted before a cold-start tap navigates. */}
            {signedIn && onboarded ? <PushRouter /> : null}
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
