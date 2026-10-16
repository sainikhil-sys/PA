# PA design system

Calm, editorial, premium. Whitespace, strong hierarchy, quiet confidence. Taste over decoration.

## Tokens (`app/globals.css`)

All colors live as CSS variables on `:root` and are mapped to Tailwind names in `@theme inline`.
Components use the Tailwind names (`bg-surface`, `text-muted`, `border-border`) and never hex values.
Dark mode later = redefine the variables under `[data-theme="dark"]`. No component changes needed.

| Token | Value | Use |
|---|---|---|
| `--background` | `#FFFFFF` | page |
| `--foreground` | `#0A0A0A` | primary text, primary buttons |
| `--muted` | `#52525B` | secondary text (7.4:1) |
| `--subtle` | `#71717A` | tertiary text, placeholders (4.8:1) |
| `--surface` / `--surface-2` | `#FAFAFA` / `#F4F4F5` | cards, wells, skeletons |
| `--border` / `--border-strong` | `#E7E7EA` / `#C9C9CF` | 1px borders, hover borders |
| `--primary` | `#0A0A0A` | the one primary action per view |
| `--success` / `--danger` / `--warning` | green / red / amber | **tiny dots and state icons only** |

Color is otherwise reserved for **integration brand logos** (original colors, never tinted).

### Type

- `--font-ui` → Hanken Grotesk (400, 500). Swap this single variable to change the UI face.
- `--font-display` → Newsreader 400 for the greeting and large page headings (`font-serif`).
- Max **two weights per screen**: 400 for text, 500 for emphasis. Headings get their weight from the serif face, not from bold.
- Numbers that change or line up use `.tabular` (tabular figures).
- Scale: 12 / 13 / 14 / 15 / 17 / 20–22 (top bar greeting) / 32–36 (page titles).

### Space, shape, depth

- 8px grid (Tailwind steps of 2). Cards pad 20px and gaps are 16–24px.
- Radius: 10px controls, 12px menus, 16px cards and dialogs.
- 1px borders over shadows. `--shadow-pop` only for floating layers (menus, dialogs, drawers).
- Icons: Phosphor, 20px, `regular` weight, `fill` for the active nav item. No other icon set besides brand logos.

## Taste rules

1. One primary (black) action per view; everything else is secondary/ghost.
2. Max two font weights per screen.
3. At most 7 items in any nav group or card list (lists link to "View all").
4. Every card has a skeleton, an empty state (icon + one sentence + one action) and an error state.
5. Copy is short and human. No jargon, no exclamation marks.
6. Touch targets ≥ 44px, which includes the invisible hit area on switches and checkboxes.

## Motion

| Library | Owns |
|---|---|
| **Motion** (`motion/react`) | UI state: page/list enter-exit, layout (`layoutId` pills), hover/press, dialogs, drawers, the voice orb |
| **GSAP** | choreographed timelines: news marquee, count-ups, intro timelines, ScrollTrigger effects |
| **Lenis** | main page scroll feel, driven by `gsap.ticker` so ScrollTrigger stays in sync |

- Never animate the same element with two libraries.
- 150–250ms, ease-out `cubic-bezier(0.16, 1, 0.3, 1)`. Springs only for drawers and drag.
- Animate only `transform` and `opacity`. No layout shift.
- Reduced motion (OS setting **or** Settings > Appearance): `MotionConfig reducedMotion="always"`, Lenis off, marquee becomes a static scrollable list, and CSS transitions collapse.
- Inner scroll areas (chat list, dialogs, code blocks, menus) carry `data-lenis-prevent`.
- GSAP and Lenis are dynamically imported and never part of the first-load bundle.

## Components

- `components/ui/*`: shadcn-style primitives on Radix, restyled to the tokens (Button, Input, Card, Badge, Dialog, Sheet, Menu, Switch, Checkbox, Segmented, TabLinks, EmptyState, ErrorState, PageHeader, Skeleton).
- Status is never conveyed by color alone: badges vary by **fill / outline / dash / strikethrough** plus an icon and a label (e.g. URGENT = solid black, REPLY_NEEDED = outline, FYI = soft, NEWSLETTER = dashed, SPAM = muted strikethrough).
- Server Components by default; client components only for interaction.
- Data that changes in the background is polled with SWR every 5–15s.

## Live Link panel

A see-through overlay (⌘⇧L or the Graph button in the top bar) that shows how inputs, the agent, models, sources, the approval gate and outputs are linked, and what's moving right now. It reads the same `trace_spans` as the Flow run page through `/api/flow/events` and `/api/flow/status`. There is no second event system.

### The translucency exception

The design system otherwise bans glassmorphism. This panel is the single exception, because it has to float over your work.

- Surface: `.lp-surface`, white at `--lp-alpha` (default 72%, user-adjustable 40–100%), `backdrop-filter: blur(14px)`, 1px border, one soft shadow. Blur is applied **only** here.
- Readability: every text run sits on `.lp-text`, a backing whose alpha is raised by `panelBacking()` (in `lib/flow/model.ts`) to the minimum that keeps muted text at **4.5:1 even over a black page**. At 100% opacity nothing changes.
- No `backdrop-filter` support → solid white (`@supports not …`).
- Click-through mode sets `pointer-events: none` on the panel. Its own toolbar stays interactive so you can switch it back.

### Visual language (never color alone)

| Node status | Dot | Extra | Label |
|---|---|---|---|
| Active | pulsing green | — | Active |
| Idle | hollow gray | — | Idle |
| Off | none | logo grayscale, 40% opacity | Off |
| Not connected | none | dashed outline | Connect (link) |
| Waiting for you | amber half-filled | — | Waiting for you |
| Error | red | warning icon | Needs attention |
| Dry run | pulsing | dashed border | Dry run |

| Link state | Line |
|---|---|
| Connected, idle | thin gray |
| Active | solid black + travelling dots in the direction of flow |
| Recently used (≤60s) | gray, fading out |
| Disabled / not connected | dashed light gray |
| Error | red dashed, shakes once |
| Blocked by permission | dotted, ends at a lock badge |
| Draft (unsaved plan) | dashed black at 60% |

Lanes, left to right: Inputs → Agent core → Models (+ knowledge sources) → Tools & sources → Approval gate → Outputs. Run focus brightens the involved nodes, dims the rest, and numbers the steps (1, 2, 3…).

### Motion rules for the panel

- Only transform and opacity animate. Travelling dots use SVG `animateMotion`, and the error shake is a 240ms translate, once.
- At most **8** links animate at a time (the most recent). Others render as "recent".
- "Pause animation" or reduced motion stops the dots, pulses and replay animation, and the map stays fully informative.
- React Flow and GSAP (used for replay) are loaded only when the panel first opens.

### Modes

Floating (drag the header, resize from the corner or with arrow keys on the handle; position and size persist), Docked right (380px, pushes content via `--lp-right`), Docked bottom (240px, `--lp-bottom`), and a Minimized pill ("● 3 active"). On phones it becomes a bottom sheet with the list view. Preferences persist per user in `user_settings.link_panel`.
