/**
 * Cowork V2 design tokens (Phase 3): white and light grey surfaces, near-black type, orange for
 * primary actions and active states. No green anywhere. Same values as the website (app/globals.css);
 * tests/unit/design-tokens.test.ts checks that they match, that every text pair passes WCAG AA,
 * and that no green hue appears.
 *
 * Orange rule: fills use `accent` (#F97316) with dark text (`onAccent`, 6.7:1). Orange text, links
 * and icons on light surfaces use `accentText` (#C2410C, 5.2:1); white text on the bright orange
 * would be 2.8:1 and fails.
 *
 * House rules: no purple, no gradients for decoration, no pill-shaped buttons (controls use
 * `radius.control`), no emoji icons, restrained motion that respects reduced-motion.
 *
 * `color` and `type` read the active palette, so `color.text` is always current. The root layout
 * sets the scheme before rendering and re-mounts the app when it changes (see app/_layout.tsx).
 */

export type Scheme = "light" | "dark";

const light = {
  /** White page. */
  bg: "#FFFFFF",
  /** Light grey cards, inputs and rows. */
  surface: "#F3F4F6",
  surface2: "#E5E7EB",
  surface3: "#D9DCE1",
  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  /** Near-black text: 18.9:1 on bg, 17.0:1 on surface. */
  text: "#111111",
  /** Secondary text: 5.8:1 on bg, 5.3:1 on surface (the brief's #6B7280, darkened to pass on grey). */
  muted: "#5F6673",
  /** Tertiary text and placeholders: 5.0:1 on bg, 4.6:1 on surface. */
  subtle: "#667080",
  /** Orange fill for primary buttons and active marks. Always with `onAccent` text. */
  accent: "#F97316",
  /** Pressed fill. */
  accentDeep: "#EA580C",
  /** Text on orange: 6.7:1. */
  onAccent: "#111111",
  /** Orange text, links and icons on light surfaces: 5.2:1 on bg, 4.7:1 on surface. */
  accentText: "#C2410C",
  /** Secondary orange for small marks (badges). */
  accent2: "#EA580C",
  /** Text on the secondary orange: 5.3:1. */
  onAccent2: "#111111",
  /** Success is neutral (always paired with a check icon), because green is not part of Cowork. */
  success: "#111111",
  danger: "#B42318",
  warning: "#9A6200",
  overlay: "rgba(17,17,17,0.4)",
  /** Floating bar material: translucent page colour and a light top edge. */
  glass: "rgba(255,255,255,0.96)",
  glassEdge: "rgba(255,255,255,0.95)",
  shadow: "#111111",
};

const dark: typeof light = {
  bg: "#111111",
  surface: "#1F1F1F",
  surface2: "#292929",
  surface3: "#333333",
  border: "#292929",
  borderStrong: "#3A3A3A",
  /** Text: 18.9:1 on bg. */
  text: "#FFFFFF",
  /** Secondary text: 7.4:1 on bg, 6.4:1 on surface. */
  muted: "#A1A1AA",
  /** Tertiary text and placeholders: 6.0:1 on bg, 5.2:1 on surface. */
  subtle: "#909099",
  accent: "#F97316",
  accentDeep: "#FB923C",
  onAccent: "#111111",
  /** Orange text on dark: 6.7:1 on bg, 5.9:1 on surface. */
  accentText: "#F97316",
  accent2: "#EA580C",
  onAccent2: "#111111",
  success: "#FFFFFF",
  danger: "#F2735A",
  warning: "#E3B341",
  overlay: "rgba(0,0,0,0.6)",
  glass: "rgba(31,31,31,0.96)",
  glassEdge: "rgba(255,255,255,0.08)",
  shadow: "#000000",
};

export type Palette = typeof light;
export const palettes: Record<Scheme, Palette> = { light, dark };

let active: Scheme = "light";

/** Called by the root layout before it renders the app. */
export function setScheme(s: Scheme) {
  active = s;
}
export function currentScheme(): Scheme {
  return active;
}

/** The active palette. Read it during render; never copy a value into module state. */
export const color = Object.defineProperties(
  {},
  Object.fromEntries((Object.keys(light) as (keyof Palette)[]).map((k) => [k, { enumerable: true, get: () => palettes[active][k] }])),
) as Readonly<Palette>;

export const radius = {
  /** Buttons, inputs, chips. Never a pill. */
  control: 12,
  card: 16,
  sheet: 22,
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Minimum touch target. */
export const TOUCH = 48;

export const font = {
  regular: "HankenGrotesk_400Regular",
  medium: "HankenGrotesk_500Medium",
  semibold: "HankenGrotesk_600SemiBold",
  display: "Newsreader_400Regular",
} as const;

/** Text styles. Each read returns the style in the active palette. */
export const type = {
  get display() {
    return { fontFamily: font.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.4, color: color.text };
  },
  get title() {
    return { fontFamily: font.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: color.text };
  },
  get heading() {
    return { fontFamily: font.semibold, fontSize: 17, lineHeight: 24, color: color.text };
  },
  get body() {
    return { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.text };
  },
  get bodyMuted() {
    return { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.muted };
  },
  get label() {
    return { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.text };
  },
  get small() {
    return { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.muted };
  },
  get caption() {
    return { fontFamily: font.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, color: color.subtle, textTransform: "uppercase" as const };
  },
};

/** Card and sheet elevation: a hairline border does most of the work; shadows stay faint. */
export const elevation = {
  get card() {
    return active === "light" ? { shadowColor: palettes.light.shadow, shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 } : {};
  },
  get sheet() {
    return { shadowColor: "#000", shadowOpacity: active === "light" ? 0.12 : 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 8 };
  },
};

export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
} as const;
