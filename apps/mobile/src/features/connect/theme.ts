import { color } from "@/theme/tokens";

/**
 * Accent colors for Connect screens that work with both token sets: the current one (`orange`)
 * and the Cowork V2 one (`accent`, `accent2`, light and dark). Connect code reads accents only
 * from here, so it keeps working when V2's tokens land. Other colors (bg, surface, text, muted,
 * subtle, border, success, danger, warning) exist in both and are read from `color` directly.
 */
type Tokens = Record<string, string | undefined>;
const t = color as unknown as Tokens;

export const connectAccent = {
  get main(): string {
    return t.accent ?? t.orange ?? "#F97316";
  },
  get onMain(): string {
    return t.onAccent ?? t.onOrange ?? "#FFFFFF";
  },
  /** Live states: speaking, recording, incoming call. */
  get live(): string {
    return t.accent2 ?? t.orangeDeep ?? "#EA580C";
  },
};
