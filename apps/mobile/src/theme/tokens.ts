/**
 * Cowork V2 design tokens: light grey pages, white surfaces, near-black type, emerald as the
 * accent and vermillion for small marks. Same values as the website (app/globals.css).
 *
 * House rules: no purple, no gradients for decoration, no pill-shaped buttons (controls use
 * `radius.control`), no emoji icons, restrained motion that respects reduced-motion.
 *
 * `color` and `type` read the active palette, so `color.text` is always current. The root layout
 * sets the scheme before rendering and re-mounts the app when it changes (see app/_layout.tsx).
 */

export type Scheme = "light" | "dark";

const light = {
  /** Light grey page; white cards and bars sit on it. */
  bg: "#F2F2F4",
  surface: "#FFFFFF",
  surface2: "#EDEDF0",
  surface3: "#E4E4E8",
  border: "#E4E4E7",
  borderStrong: "#CFCFD4",
  /** Near-black text: 16.9:1 on bg, 18.9:1 on white. */
  text: "#111113",
  /** Secondary text: 5.9:1 on bg, 6.6:1 on white. */
  muted: "#5C5C63",
  /** Tertiary text and placeholders: 4.5:1 on bg, 5.1:1 on white. */
  subtle: "#6E6E76",
  /** Emerald, Cowork's accent: 6.5:1 with white text on it. */
  accent: "#0F6B4F",
  accentDeep: "#0A5039",
  onAccent: "#FFFFFF",
  /** Vermillion for small marks (badges): 5.2:1 on white. */
  accent2: "#C63B20",
  /** Text on vermillion (badges). */
  onAccent2: "#FFFFFF",
  success: "#1D7A4C",
  danger: "#B42318",
  warning: "#9A6200",
  overlay: "rgba(17,17,19,0.4)",
};

const dark: typeof light = {
  bg: "#0F0F11",
  surface: "#18181B",
  surface2: "#212125",
  surface3: "#2A2A2F",
  border: "#2A2A2F",
  borderStrong: "#3D3D44",
  /** Text: 17.4:1 on bg. */
  text: "#F4F4F5",
  /** Secondary text: 8.2:1 on bg. */
  muted: "#A9A9B2",
  /** Tertiary text and placeholders: 5.9:1 on bg. */
  subtle: "#8E8E97",
  accent: "#3FBF8F",
  accentDeep: "#2A9A71",
  /** Text on the emerald accent: 8.0:1. */
  onAccent: "#0C1511",
  accent2: "#F0694B",
  onAccent2: "#1A0B06",
  success: "#4CC38A",
  danger: "#F2735A",
  warning: "#E3B341",
  overlay: "rgba(0,0,0,0.6)",
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
    return active === "light" ? { shadowColor: "#111113", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 } : {};
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
