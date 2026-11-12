# Cowork design system (V2)

One visual language for the website and the Android app. This describes what is built: Phase 2 (layout, type, theme engine) with the Phase 3 palette from the updated V2 brief (white and light grey, near-black type, orange, no green) and the five-tab floating bar.

## Sources of truth

| Surface | File | How it works |
|---|---|---|
| Website | `app/globals.css` | CSS variables on `:root`, mapped to Tailwind names in `@theme inline` (`bg-background`, `text-muted`, `bg-primary`, `text-accent` ...). Components never hard-code colours. |
| App | `apps/mobile/src/theme/tokens.ts` | `color`, `type` and `elevation` read the **active** scheme. Read them during render; never copy a value into module scope (it would not follow theme changes). |

The two files hold the same values. Change both together.

## Colour

White pages, light grey surfaces, near-black type, orange for primary actions and active states. **No green anywhere.** Every text pair is WCAG AA or better, computed and enforced by `tests/unit/design-tokens.test.ts` (which also checks that the app and website values match and that no green hue appears).

| Token (web / app) | Light | Dark | Use |
|---|---|---|---|
| `--background` / `bg` | `#FFFFFF` | `#111111` | Page |
| `--surface` / `surface` | `#F3F4F6` | `#1F1F1F` | Cards, inputs, rows |
| `--surface-2` / `surface2` | `#E5E7EB` | `#292929` | Pressed rows, icon wells |
| `--surface-hover` / `surface3` | `#D9DCE1` | `#333333` | Inline code, tracks |
| `--border` / `border` | `#E5E7EB` | `#292929` | Hairlines |
| `--border-strong` / `borderStrong` | `#D1D5DB` | `#3A3A3A` | Inputs, outline buttons |
| `--foreground` / `text` | `#111111` (18.9:1) | `#FFFFFF` (18.9:1) | Body text |
| `--muted` / `muted` | `#5F6673` (5.8:1; 5.3:1 on surface) | `#A1A1AA` (7.4:1) | Secondary text. The brief's `#6B7280` is 4.4:1 on the grey surface, so it is darkened just enough to pass |
| `--subtle` / `subtle` | `#667080` (5.0:1; 4.6:1 on surface) | `#909099` (6.0:1) | Tertiary text, placeholders |
| `--primary` / `accent` | `#F97316` | `#F97316` | **Fills**: primary buttons, the active tab indicator, checked boxes, count badges |
| `--primary-foreground` / `onAccent` | `#111111` (6.7:1) | `#111111` | Text and icons on orange fills |
| `--primary-hover` / `accentDeep` | `#EA580C` | `#FB923C` | Pressed or hovered fill |
| `--primary-text` / `accentText` | `#C2410C` (5.2:1) | `#F97316` (6.7:1) | **Orange text, links, icons, focus rings, spinners, progress** |
| `--accent` / `accent2` | `#EA580C` | `#EA580C` | Small marks: approval badge, small icons |
| `--accent-foreground` / `onAccent2` | `#111111` (5.3:1) | `#111111` | Text on the secondary orange |
| `--success` / `success` | `#111111` | `#FFFFFF` | Neutral, always with a check icon (green is not part of Cowork) |
| `--danger`, `--warning` | `#B42318`, `#9A6200` | `#F2735A`, `#E3B341` | States only |

**The orange rule.** White text on `#F97316` is 2.8:1 and orange text on white is 2.8:1, so both fail. Orange fills always carry dark text (`onAccent`), and orange used as text or a meaningful mark on a light surface is the deeper `accentText`.

Ratios are against the page background unless the row says otherwise.

**Scheme selection**
- Website: light by default; follows the system dark setting; `<html data-theme="light|dark">` (from the `pa_theme` cookie) pins one. The Today "room" wallpaper keeps its own dark override.
- App: follows the phone (`userInterfaceStyle: "automatic"`) unless Profile > Appearance pins Light or Dark (saved on the phone as `cowork.theme`). A scheme change re-mounts the app tree so every screen redraws; this returns you to Home.

## Type

Hanken Grotesk for UI (400, 500, 600) and Newsreader for display headings.

| App style | Size / line | Use |
|---|---|---|
| `display` | 34 / 40, Newsreader | Screen titles on tab roots |
| `title` | 22 / 28 | Pushed screen titles |
| `heading` | 17 / 24 | Card and section headings |
| `body` | 15 / 22 | Text |
| `label` | 14 / 20, medium | Row titles, buttons |
| `small` | 13 / 18, muted | Details |
| `caption` | 11 / 14, uppercase, tracked | Section labels |

Text scales with the system font size up to 1.6x (`maxFontSizeMultiplier`).

## Shape, space, depth, motion

- Radius: controls 12, cards 16, sheets 22. **No pill shapes.**
- Spacing scale: 4, 8, 12, 16, 20, 24, 32. Screen gutter 16.
- Touch targets: at least 48 dp.
- Depth: a hairline border does the work. Light mode adds a faint card shadow; dark mode has none (sheets keep a soft shadow).
- Motion: 150 / 220 / 320 ms. Respect reduced motion (web: CSS collapses transitions; app: Phase 3 setting).

## Navigation and layout (app)

- **Tab bar**: five items, **Home**, **Chat**, **Create**, **Workspace**, **Profile** (your photo or initial), each an icon with a small label, floating above the system navigation (radius 28). On iOS with Liquid Glass it is a system glass surface (`expo-glass-effect`). On Android, older iOS and with Reduce Transparency it is a translucent page-coloured material (`glass` token, 96 percent: without blur, more see-through makes the labels hard to read), a hairline border, a light top edge (`glassEdge`) and a soft shadow; there is no blur on Android because it costs frame time on every scroll. An orange indicator slides to the active item (instant with reduced motion), a light haptic tick confirms a change, the approvals count shows on Workspace, and the bar steps aside while the keyboard is open. Item width follows the screen (56 to 72 dp). Tab screens leave room for it with `useTabBarSpace()`. Connect takes Workspace's slot once Connect has a working feature.
- **Home**: the `cowork` wordmark and notifications bell, "What's happening?", a search field with a filter button (search in chats, tasks, notes, documents or memories), quick actions (New chat, Talk, New task, New note, More), Recent chats, then Today's cards.
- **Pushed screens**: a white header with back on the left and the title centred, a hairline underneath (`BackHeader`, `SubHeader`).
- **Settings lists**: flat sections on the page, a small grey heading, rows split by hairlines (`ListSection`), the way the reference screens do it.
- **Profile**: photo, name, email and member-since, Edit profile, real counts (chats, notes, documents), bio, then My stuff, Settings (Account, Notifications, Permissions, Appearance, Phone link, Connected services), Help and more, Sign out and Delete account.
- **Launch**: the system splash (white or `#111111`; the colour needs a native build) hands over to a launch view (wordmark, tagline, progress bar, a short line at the bottom) only while the session and settings restore.

Features in the reference that Cowork doesn't have yet (spaces, events, certificates, usernames, phone sign-in, passkeys) are not shown until they exist.

## Rules

- No purple, no decorative gradients (the voice orb's radial light is the one purposeful exception), no pill buttons, no emoji, no em dashes in copy, no fake metrics or testimonials.
- No green: not as an accent, not for success. The test fails on any green token.
- One primary (orange) button per screen. Orange fills take dark text.
- The secondary orange is for small marks only.
- Exceptions that keep fixed colours on purpose: QR codes (white for scanning), email previews, third-party brand marks (WhatsApp green), Today room wallpapers, the app icon and the system splash image (brand asset, the orange mark, not yet redrawn).
