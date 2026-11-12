import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The config plugin is CommonJS inside the Expo app; load it the way Expo does.
const require = createRequire(import.meta.url);
const mobile = path.resolve(__dirname, "../../apps/mobile");
const plugin = require(path.join(mobile, "plugins/with-app-icons.js")) as {
  applyIconAliases: (app: Record<string, unknown>) => Record<string, unknown>;
  ICONS: string[];
};

type Node = { $: Record<string, string>; [k: string]: unknown };
const filter = (action: string, category: string) => ({ action: [{ $: { "android:name": action } }], category: [{ $: { "android:name": category } }] });
const launcher = () => filter("android.intent.action.MAIN", "android.intent.category.LAUNCHER");
const deepLink = () => ({ action: [{ $: { "android:name": "android.intent.action.VIEW" } }], category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }], data: [{ $: { "android:scheme": "cowork" } }] });

function manifestApp() {
  return { activity: [{ $: { "android:name": ".MainActivity" }, "intent-filter": [launcher(), deepLink()] }] };
}

describe("app icon variants", () => {
  it("moves the launcher entry to one alias per icon, with only the default enabled", () => {
    const app = plugin.applyIconAliases(manifestApp());
    const main = (app.activity as Node[])[0]!;
    const filters = main["intent-filter"] as ReturnType<typeof deepLink>[];
    expect(filters).toHaveLength(1);
    expect(filters[0]!.data).toBeDefined(); // deep links stay on MainActivity

    const aliases = app["activity-alias"] as Node[];
    expect(aliases.map((a) => a.$["android:name"])).toEqual(plugin.ICONS.map((k) => `.CoworkIcon${k[0]!.toUpperCase()}${k.slice(1)}`));
    expect(aliases.filter((a) => a.$["android:enabled"] === "true").map((a) => a.$["android:name"])).toEqual([".CoworkIconNight"]);
    for (const a of aliases) {
      expect(a.$["android:targetActivity"]).toBe(".MainActivity");
      expect(a.$["android:exported"]).toBe("true");
      expect(a["intent-filter"]).toEqual([launcher()]);
    }
  });

  it("is safe to run twice (prebuild without --clean)", () => {
    const once = plugin.applyIconAliases(manifestApp());
    const twice = plugin.applyIconAliases(once);
    expect((twice["activity-alias"] as Node[]).length).toBe(plugin.ICONS.length);
  });

  it("has every resource each alias points at", () => {
    const res = path.join(mobile, "assets/app-icons/android/res");
    const colors = fs.readFileSync(path.join(res, "values/app_icon_colors.xml"), "utf8");
    for (const key of plugin.ICONS) {
      expect(fs.existsSync(path.join(res, "mipmap-anydpi-v26", `ic_launcher_${key}.xml`))).toBe(true);
      for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
        expect(fs.existsSync(path.join(res, `mipmap-${d}`, `ic_launcher_${key}.png`))).toBe(true);
        expect(fs.existsSync(path.join(res, `mipmap-${d}`, `ic_launcher_${key}_foreground.png`))).toBe(true);
      }
      expect(colors).toContain(`ic_launcher_${key}_background`);
      expect(fs.existsSync(path.join(mobile, "assets/app-icons/preview", `${key}.png`))).toBe(true);
    }
  });

  it("matches the keys the app offers, and has no green", () => {
    const src = fs.readFileSync(path.join(mobile, "src/features/appearance/icons.ts"), "utf8");
    const appKeys = [...src.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
    expect(appKeys).toEqual(plugin.ICONS);
    const colors = fs.readFileSync(path.join(mobile, "assets/app-icons/android/res/values/app_icon_colors.xml"), "utf8");
    for (const [, hex] of colors.matchAll(/>#([0-9A-Fa-f]{6})</g)) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16));
      // Green-dominant colours are not part of Cowork.
      expect(g! > r! + 20 && g! > b! + 20).toBe(false);
    }
  });
});
