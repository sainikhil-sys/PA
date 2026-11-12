import { PermissionsAndroid, Platform, type Permission } from "react-native";

/**
 * Runtime permissions Google Nearby Connections needs, by Android version (from its setup guide).
 * Location is only on Android 12L and older, where the system requires it for Bluetooth LE scanning
 * and the local hotspot; Cowork never reads or sends a location.
 */
export function nearbyPermissions(): Permission[] {
  if (Platform.OS !== "android") return [];
  const api = typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10);
  const list: string[] = [];
  if (api >= 31) list.push("android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_ADVERTISE", "android.permission.BLUETOOTH_CONNECT");
  if (api >= 33) list.push("android.permission.NEARBY_WIFI_DEVICES");
  // Android 6 to 12L: Bluetooth LE scanning, Wi-Fi scanning and hosting a hotspot need it.
  if (api <= 32) list.push("android.permission.ACCESS_FINE_LOCATION");
  if (api >= 37) list.push("android.permission.ACCESS_LOCAL_NETWORK");
  return list as Permission[];
}

export type PermissionResult = { ok: true } | { ok: false; blocked: boolean; missing: string[] };

export async function requestNearbyPermissions(): Promise<PermissionResult> {
  const wanted = nearbyPermissions();
  if (!wanted.length) return { ok: true };
  const result = await PermissionsAndroid.requestMultiple(wanted);
  const missing = wanted.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (!missing.length) return { ok: true };
  return { ok: false, blocked: missing.some((p) => result[p] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN), missing };
}
