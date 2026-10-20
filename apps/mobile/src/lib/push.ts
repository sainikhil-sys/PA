import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "./api";

const TOKEN_KEY = "cowork.pushToken";

export type PushResult = { ok: true } | { ok: false; reason: "denied" | "not_configured" | "emulator" | "error"; message: string };

/**
 * Turn on phone notifications: ask permission, get this phone's Firebase token and register it with
 * Cowork (stored server-side as a native-app endpoint). Never claims success it didn't get: a build
 * without Firebase configured reports "not_configured".
 */
export async function enablePush(): Promise<PushResult> {
  if (!Device.isDevice) return { ok: false, reason: "emulator", message: "Notifications need a real phone." };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Cowork", importance: Notifications.AndroidImportance.HIGH, lightColor: "#EA5A15" });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return { ok: false, reason: "denied", message: "Notifications are off for Cowork. You can turn them on in Android settings." };
  let token: string;
  try {
    token = (await Notifications.getDevicePushTokenAsync()).data as string;
  } catch {
    return { ok: false, reason: "not_configured", message: "Phone notifications aren't set up in this version of the app yet." };
  }
  try {
    await api("/api/mobile/push", { body: { token, device: Device.modelName ?? undefined } });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : "Couldn't turn on notifications." };
  }
}

/** Stop notifications to this phone (also called on sign-out). */
export async function disablePush(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return;
  await api("/api/mobile/push", { method: "DELETE", body: { token } }).catch(() => {});
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function pushEnabled(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}
