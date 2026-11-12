// Launcher icon variants on Android (Settings > Appearance > App icon).
// Android has no API to replace an app's icon, so each variant is an <activity-alias> of
// MainActivity with its own icon and the LAUNCHER filter. Exactly one alias is enabled at a time;
// the app enables the chosen one with PackageManager (modules/app-icon). MainActivity keeps every
// other intent filter (deep links), so links and notifications open the app as before.
// Resources come from assets/app-icons/android (made by scripts/generate-app-icons.py).
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// Keep in step with src/features/appearance/icons.ts and scripts/generate-app-icons.py.
const ICONS = ["night", "day", "orange", "sky", "ivory", "blue", "dark", "light"];
const DEFAULT_ICON = "night";
const PREFIX = ".CoworkIcon";

const aliasName = (key) => `${PREFIX}${key[0].toUpperCase()}${key.slice(1)}`;

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

function withIconResources(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const from = path.join(cfg.modRequest.projectRoot, "assets", "app-icons", "android", "res");
      const to = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res");
      copyDir(from, to);
      return cfg;
    },
  ]);
}

const isLauncher = (filter) =>
  (filter.action ?? []).some((a) => a.$["android:name"] === "android.intent.action.MAIN") &&
  (filter.category ?? []).some((c) => c.$["android:name"] === "android.intent.category.LAUNCHER");

/** Moves the launcher entry from MainActivity to one alias per icon. Pure: edits the given application node. */
function applyIconAliases(app) {
  const main = (app.activity ?? []).find((a) => a.$["android:name"] === ".MainActivity");
  if (!main) throw new Error("with-app-icons: .MainActivity not found in AndroidManifest.xml");
  // The launcher entry moves from MainActivity to the aliases.
  main["intent-filter"] = (main["intent-filter"] ?? []).filter((f) => !isLauncher(f));
  const others = (app["activity-alias"] ?? []).filter((a) => !a.$["android:name"].startsWith(PREFIX));
  app["activity-alias"] = [
    ...others,
    ...ICONS.map((key) => ({
      $: {
        "android:name": aliasName(key),
        "android:enabled": key === DEFAULT_ICON ? "true" : "false",
        "android:exported": "true",
        "android:icon": `@mipmap/ic_launcher_${key}`,
        "android:roundIcon": `@mipmap/ic_launcher_${key}`,
        "android:targetActivity": ".MainActivity",
      },
      "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.MAIN" } }], category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }] }],
    })),
  ];
  return app;
}

function withIconAliases(config) {
  return withAndroidManifest(config, (cfg) => {
    applyIconAliases(AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults));
    return cfg;
  });
}

module.exports = function withAppIcons(config) {
  return withIconAliases(withIconResources(config));
};
module.exports.applyIconAliases = applyIconAliases;
module.exports.ICONS = ICONS;
