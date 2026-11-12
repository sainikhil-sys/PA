# Cowork design system (V2)

One visual language for the website and the Android app. This describes what is built (Phase 2, revised to follow the Unifesto reference screens: light grey pages, white surfaces, black type, flat settings lists, a floating three-item tab bar). Accent customization comes later.

## Sources of truth

| Surface | File | How it works |
|---|---|---|
| Website | `app/globals.css` | CSS variables on `:root`, mapped to Tailwind names in `@theme inline` (`bg-background`, `text-muted`, `bg-primary`, `text-accent` ...). Components never hard-code colours. |
| App | `apps/mobile/src/theme/tokens.ts` | `color`, `type` and `elevation` read the **active** scheme. Read them during render; never copy a value into module scope (it would not follow theme changes). |

The two files hold the same values. Change both together.

## Colour

Light grey pages, white surfaces, near-black type, emerald as Cowork's accent and vermillion for small marks. Every text pair is WCAG AA or better (computed, not estimated).

| Token (web / app) | Light | Dark | Use |
|---|---|---|---|
| `--background` / `bg` | `#F2F2F4` light grey | `#0F0F11` | Page |
| `--surface` / `surface` | `#FFFFFF` | `#18181B` | Cards, inputs, headers, tab bar |
| `--surface-2` / `surface2` | `#EDEDF0` | `#212125` | Pressed rows, icon wells |
| `--border` / `border` | `#E4E4E7` | `#2A2A2F` | Hairlines |
| `--border-strong` / `borderStrong` | `#CFCFD4` | `#3D3D44` | Inputs, outline buttons |
| `--foreground` / `text` | `#111113` (16.9:1) | `#F4F4F5` (17.4:1) | Body text |
| `--muted` / `muted` | `#5C5C63` (5.9:1) | `#A9A9B2` (8.2:1) | Secondary text |
| `--subtle` / `subtle` | `#6E6E76` (4.5:1) | `#8E8E97` (5.9:1) | Tertiary text, placeholders |
| `--primary` / `accent` | `#0F6B4F` emerald | `#3FBF8F` | Primary buttons, links, selected checks, focus ring |
| `--primary-foreground` / `onAccent` | `#FFFFFF` (6.5:1) | `#0C1511` (8.0:1) | Text on emerald |
| `--accent` / `accent2` | `#C63B20` vermillion (5.2:1 on white) | `#F0694B` | Small marks only: badges |
| `--accent-foreground` / `onAccent2` | `#FFFFFF` | `#1A0B06` | Text on vermillion |
| `--danger`, `--success`, `--warning` | `#B42318`, `#1D7A4C`, `#9A6200` | `#F2735A`, `#4CC38A`, `#E3B341` | States only |

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
- Depth: a hairline border does the work. Light mode adds a faint warm card shadow; dark mode has none (sheets keep a soft shadow).
- Motion: 150 / 220 / 320 ms. Respect reduced motion (web: CSS collapses transitions; app: Phase 3 setting).

## Navigation and layout (app)

- **Tab bar**: a floating white bar (radius 28, faint shadow) above the system navigation with three items: **Home**, **Workspace**, **Profile** (your photo or initial). A small dot slides under the active item; a light haptic tick on change; the approvals count shows on Workspace in vermillion. Tab screens leave room for it with `useTabBarSpace()`.
- **Home**: the `cowork` wordmark and notifications bell, "What's happening?", a search field with a filter button (search in chats, tasks, notes, documents or memories), quick actions (New chat, Talk, New task, New note, More), Recent chats, then Today's cards.
- **Pushed screens**: a white header with back on the left and the title centred, a hairline underneath (`BackHeader`, `SubHeader`).
- **Settings lists**: flat sections on the grey page, a small grey heading, rows split by hairlines (`ListSection`), the way the reference screens do it.
- **Profile**: photo, name, email and member-since, Edit profile, real counts (chats, notes, documents), bio, then My stuff, Settings (Account, Notifications, Permissions, Appearance, Phone link, Connected services), Help and more, Sign out and Delete account.
- **Launch**: the system splash (light grey or dark) hands over to a launch view (wordmark, tagline, progress bar, a short line at the bottom) only while the session and settings restore.

Features in the reference that Cowork doesn't have yet (spaces, events, certificates, usernames, phone sign-in, passkeys) are not shown until they exist.

## Rules

- No purple, no decorative gradients (the voice orb's radial light is the one purposeful exception), no pill buttons, no emoji, no em dashes in copy, no fake metrics or testimonials.
- One primary (emerald) button per screen.
- Vermillion is for small marks only.
- Exceptions that keep fixed colours on purpose: QR codes (white for scanning), email previews, third-party brand marks (WhatsApp green), Today room wallpapers, the app icon and the system splash image (brand asset, the orange mark, not yet redrawn).
