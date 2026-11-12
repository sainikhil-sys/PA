import type { ImageSourcePropType } from "react-native";

/**
 * Launcher icon variants. Keep the keys in step with plugins/with-app-icons.js and
 * scripts/generate-app-icons.py. "Orange" stands in for the brief's "Mint": Cowork has no green.
 */
export const APP_ICONS: { key: string; label: string; preview: ImageSourcePropType }[] = [
  { key: "night", label: "Night", preview: require("../../../assets/app-icons/preview/night.png") },
  { key: "day", label: "Day", preview: require("../../../assets/app-icons/preview/day.png") },
  { key: "orange", label: "Orange", preview: require("../../../assets/app-icons/preview/orange.png") },
  { key: "sky", label: "Sky", preview: require("../../../assets/app-icons/preview/sky.png") },
  { key: "ivory", label: "Ivory", preview: require("../../../assets/app-icons/preview/ivory.png") },
  { key: "blue", label: "Blue", preview: require("../../../assets/app-icons/preview/blue.png") },
  { key: "dark", label: "Dark", preview: require("../../../assets/app-icons/preview/dark.png") },
  { key: "light", label: "Light", preview: require("../../../assets/app-icons/preview/light.png") },
];

export const APP_ICON_KEYS = APP_ICONS.map((i) => i.key);
