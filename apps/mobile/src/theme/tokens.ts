/**
 * Cowork mobile design tokens. Dark, warm and quiet: near-black surfaces, one orange accent.
 * House rules: no purple, no pill-shaped buttons (controls use `radius.control`), no emoji icons,
 * restrained motion that respects reduced-motion.
 */
export const color = {
  bg: "#080808",
  surface: "#111111",
  surface2: "#181818",
  surface3: "#202020",
  border: "#242424",
  borderStrong: "#333333",
  text: "#FFFFFF",
  /** Secondary text: 9.6:1 on bg. */
  muted: "#A3A3A3",
  /** Tertiary text and placeholders: 5.6:1 on bg. */
  subtle: "#8A8A8A",
  orange: "#EA5A15",
  orangeDeep: "#CC2600",
  warm: "#E9BC8D",
  /** Text on the orange accent. */
  onOrange: "#0B0B0B",
  success: "#3DD68C",
  danger: "#FF6B5B",
  warning: "#F5B841",
  overlay: "rgba(0,0,0,0.6)",
} as const;

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

export const type = {
  display: { fontFamily: font.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.4, color: color.text },
  title: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: color.text },
  heading: { fontFamily: font.semibold, fontSize: 17, lineHeight: 24, color: color.text },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.text },
  bodyMuted: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.muted },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.text },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.muted },
  caption: { fontFamily: font.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, color: color.subtle, textTransform: "uppercase" as const },
} as const;

export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
} as const;
