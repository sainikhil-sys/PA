import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The design system has two sources (app tokens and web CSS variables). These tests keep them
 * identical, keep every text pair at WCAG AA, and keep green out of Cowork's palette.
 * Files are read as text so the test does not import React Native.
 */

const appSrc = readFileSync("apps/mobile/src/theme/tokens.ts", "utf8");
const css = readFileSync("app/globals.css", "utf8");

/** The `const light = { ... }` or `const dark: typeof light = { ... }` object, as key to colour. */
function appPalette(name: "light" | "dark"): Record<string, string> {
  const start = appSrc.search(new RegExp(`const ${name}(: typeof light)? = \\{`));
  if (start < 0) throw new Error(`no ${name} palette`);
  const body = appSrc.slice(start, appSrc.indexOf("\n};", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(\w+): "([^"]+)",/gm)) out[m[1]!] = m[2]!;
  return out;
}

/** CSS custom properties in the first block that starts with `selector {`. */
function cssBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const app = { light: appPalette("light"), dark: appPalette("dark") };
const web = { light: cssBlock(":root"), dark: cssBlock(':root[data-theme="dark"]') };

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Hue in degrees and HSL saturation, for the no-green rule. */
function hueSat(hex: string): { hue: number; sat: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  return { hue: (hue + 360) % 360, sat };
}

const isHex = (v: string) => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v);

/** App token name to web variable name, for every colour the two share. */
const SHARED: Record<string, string> = {
  bg: "background",
  text: "foreground",
  muted: "muted",
  subtle: "subtle",
  surface: "surface",
  surface2: "surface-2",
  surface3: "surface-hover",
  border: "border",
  borderStrong: "border-strong",
  accent: "primary",
  onAccent: "primary-foreground",
  accentDeep: "primary-hover",
  accentText: "primary-text",
  accent2: "accent",
  onAccent2: "accent-foreground",
  success: "success",
  danger: "danger",
  warning: "warning",
};

describe.each(["light", "dark"] as const)("%s palette", (scheme) => {
  const a = app[scheme];
  const w = web[scheme];

  it("app and website use the same values", () => {
    for (const [appKey, webKey] of Object.entries(SHARED)) {
      expect(w[webKey]?.toLowerCase(), `${appKey} / --${webKey}`).toBe(a[appKey]?.toLowerCase());
    }
  });

  it("every text pair passes WCAG AA (4.5:1)", () => {
    const pairs: [string, string][] = [
      ["text", "bg"],
      ["text", "surface"],
      ["text", "surface2"],
      ["muted", "bg"],
      ["muted", "surface"],
      ["subtle", "bg"],
      ["subtle", "surface"],
      ["accentText", "bg"],
      ["accentText", "surface"],
      ["onAccent", "accent"],
      ["onAccent", "accentDeep"],
      ["onAccent2", "accent2"],
      ["danger", "bg"],
      ["danger", "surface"],
      ["warning", "bg"],
      ["success", "bg"],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(a[fg]!, a[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("contains no green", () => {
    const values = [...Object.values(a), ...Object.values(w)].filter(isHex);
    for (const v of values) {
      const { hue, sat } = hueSat(v);
      expect(sat > 0.2 && hue >= 75 && hue <= 170, `${v} is green`).toBe(false);
    }
  });

  it("uses the brief's orange", () => {
    expect(a.accent).toBe("#F97316");
    expect(a.accent2).toBe("#EA580C");
  });
});

describe("dark blocks in globals.css agree", () => {
  it("the system-dark block matches the pinned-dark block", () => {
    const start = css.indexOf("@media (prefers-color-scheme: dark)");
    const media = css.slice(start, css.indexOf("}", css.indexOf(":root:not", start)));
    for (const m of media.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      expect(web.dark[m[1]!], `--${m[1]}`).toBe(m[2]!.trim());
    }
  });
});
