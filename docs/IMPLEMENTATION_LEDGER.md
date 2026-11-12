# Cowork implementation ledger

The running record for the all-in-one Cowork brief. Each row says what exists in the repository today, how it was checked, and what remains. A feature is marked "working" only when it was exercised, and the row says how. Update this file whenever a row changes.

Last updated: 2026-11-12, 22:40 IST. Production deploy of `9f303bd` is READY (admin console, Spaces, date of birth, private account live). `origin/master` = `8dabdd0`. Production serves `5d48262`: every deploy since `7596f97` fails on one admin console type error (`app/api/admin/ai/route.ts`, `adminRoute` second argument); the admin console session is pushing the fix.

Status key: **Working** (exercised) · **Built, unverified** (code complete, not exercised end to end) · **Partial** · **Broken** · **Not built** · **Needs external config** · **Needs native or hardware**.

Owners (user's split, 2026-11-12): **M** = mobile session (`apps/mobile`, `lib/social`, `app/api/social`), **B** = backend and web session (realtime, media, Spaces, Moments, Anonymous, Explore, Calls, moderation), **A** = admin console session (admin, Connect server side).

## 1. Navigation

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Chats opens person-to-person chats, Assistant opens AI | Working | Separate tabs and data (`dm_*` tables vs `conversations`); checked on the phone, and by a 52-check API test that AI chats never list person chats | M |
| Five tabs: Home, Chats, Community, Assistant, Profile | Built, unverified | Community took Workspace's slot (22:10). Workspace is a normal screen, reached from Home > More and Profile. Typecheck passes; not yet on the phone, and the Spaces API is live only after the blocked deploy | M |

## 2. Appearance and personalization

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| System, Light, Dark applied app-wide | Working | Theme engine with tokens; light and dark checked on the phone | M |
| Orange accent, no green, contrast | Working | `tests/unit/design-tokens.test.ts` (WCAG AA, no green) | M |
| 8 launcher icons, 4-column grid | Working on Android | Activity aliases plus `modules/app-icon`; switch to Ivory confirmed on the phone (`CoworkIconIvory` focused). "Mint" ships as "Orange" (house rule: no green). iOS needs a Mac build | M |
| Haptics, reduce motion | Working | Settings > Appearance; persisted | M |
| Font scaling | Partial | Follows the phone's font size up to 160%; no separate in-app slider | M |
| Chat wallpaper, bubble style, sound preferences | Not built | | M |
| Notification preferences | Partial | Settings > Notifications (existing); per-category Chats settings not built | M, B |
| Profile visibility, private account | Built, unverified | Chats privacy switches, private account (server change waits on deploy) | M |

## 3. App lock

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Fingerprint, face, device credential, 4 or 6 digit PIN | Working | Set up on the phone by the user; PBKDF2 in SecureStore; 20 unit tests | M |
| Lock policies (immediately, 30 s, 1 min, 5 min, fresh launch) | Built, unverified | Lock on return and on fresh launch not yet walked through on the device | M |
| Recents privacy | Built, unverified | Cover plus optional FLAG_SECURE switch | M |
| Passkeys | Not built | Passkeys are a sign-in feature (server WebAuthn plus Credential Manager); not started | B |

## 4. Launch and animation

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Launch animation, theme-aware splash | Working | Seen on the phone | M |
| Transitions, message appearance, sheets, reduced motion | Partial | Stack transitions, message fade-in, sheet slide; media viewer not built | M |

## 5. Chats

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Handles, friend requests, accept, decline, cancel, remove, block | Working | 52-check two-account API test on a local database | M |
| Direct and group chats, roles, leave, owner hand-over | Working | Same test | M |
| Replies, reactions, edit, delete, search, read and delivered marks, typing, presence | Working | Same test; read receipts respect both people's settings | M |
| Offline outbox, offline copy of chats | Built, unverified | Outbox states and idempotent ids; not tested offline on the phone | M |
| Realtime delivery | Partial, needs external config | Server publishes hints (B2); app still polls (3 s open chat, 8 s list). Needs Supabase Realtime keys, then the app subscribes | B, M |
| Forwarding | Not built | | M |
| Images, video, documents, voice messages in Chats | Not built | Needs media storage live (see 12) | M, B |
| Push notifications | Needs external config | Code complete; no Firebase `google-services.json` | M |

## 6 to 8. Nearby and offline (Connect)

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Same-network and Bluetooth discovery, encrypted P2P chat, files, SnapShare, groups, Walkie, offline calls | Discovery working between two phones (2026-11-12 22:28, release build): advertising over BLE, Wi-Fi LAN, Bluetooth Classic and mDNS, discovery over BLE and Wi-Fi LAN, and the other phone ("Sai nikhil") found over BLE. Connecting and encrypted chat both ways: working (user, 22:33). Offline voice call: working after the identity fix workaround (user, 22:45). Walkie, files, SnapShare and groups between two phones: not yet confirmed. Walkie: "Join with a code" added (next build). This OPPO phone's settings reset Bluetooth discoverability and BLE advertising sometimes times out; LAN and BLE still worked | Connect app side merged in `8721541` (from `feat/connect-c1`); 101 unit tests pass (Noise XX handshake against a published vector); permissions granted on the phone. Never run between two phones | M (app), A (server) |
| Location-based discovery with distance filters | Not built | Server B10 not started; needs a privacy design (approximate distance, opt-in) | B, M |
| Circles and social (Connect online part) | Not built on server | App hides it until `GET /api/connect/circles` answers 200 | A |

### Bugs found on the phones

| Bug | Cause | Fix | Status |
|---|---|---|---|
| Calls stuck on "Ringing", Walkie joins ignored, while chat worked (2026-11-12 22:37) | Race on first start after install: Connect, Calls, Walkie and Groups each created their own identity key at once, so feature messages named a key the other phone's link didn't know and were dropped | `loadIdentity` is single-flight (`features/connect/identity.ts`); `tests/connect/identity.test.ts` fails on the old code and passes now | Fixed in code (next build). Workaround on the installed APK confirmed by the user: after restarting Cowork on both phones, calls ring and connect |

## 9 to 10. Anonymous

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| University anonymous (verification, rooms, identities) | Not built | Server B7 after Spaces; needs moderation provider decision (R4) | B, M |
| Public anonymous rooms | Not built | Same | B, M |

## 11. Communities (Spaces)

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Create, discover, join, roles, invites, posts, polls, events, moderation | Server built (`15c7692`, migration 0018 applied); app built, unverified | App: Community tab (your Spaces, discover with search and categories), create form (teens: private only), Space page with posts, polls, announcements, pin and remove for moderators, events with RSVP, about and invite codes, members and join requests. Shows a clear message while the server lacks Spaces | B (server), M (app) |

## 12. Feed, stories and media

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Feed, posts, comments, likes, saves, follows, profiles | Built, unverified on device | App code in `8721541`; server live in `5d48262` | M, B |
| Photo uploads (EXIF stripped on the phone) | Needs external config: R2 values are not on the `pa` project (checked 22:40, 80 settings, none R2_) | Picker and re-encode work on the phone; server answers 503 until R2 keys reach a successful deploy. User added the R2 values; not yet confirmed by `vercel env ls` | B, M |
| Stories | Not built | Server B6 | B, M |

## 13. Voice and video

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Online voice and video calls, group calls, screen share | Not built | Needs a calls provider (R3, LiveKit recommended) | B, M |
| Offline voice messages, Walkie, offline calls | Built, unverified; needs two phones | Connect | M |

## 14. AI assistant

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| AI chat with streaming, history, context, attachments | Working | Existing, separate tab | — |
| Assignment Writer | Built by another session, uncommitted | `lib/studio`, `app/studio` untracked in the working tree | Studio session |
| Document intelligence (upload, search) | Partial | Documents and knowledge search exist; PDF summaries via chat | — |
| Voice input and read aloud | Working in Cowork's build | Crashed Expo Go; fixed (loads the module only when present), uncommitted | M |

## 15 to 16. Workspace and command center

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Personal tasks, notes, agenda, documents, briefing | Working | Existing | — |
| Shared workspaces, task boards with assignees, comments, shared editing | Not built | | B, M |

## 17. Admin

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| Admin console (roles, flags, config, users, reports, health, audit) | Built; waits on deploy | `7596f97`, migration 0017 applied; app admin area gated by `/api/admin/me` | A |

## 19 to 21. Realtime, security, performance

| Feature | Status | Evidence and what remains | Owner |
|---|---|---|---|
| RLS on every table, rate limits, reports queue, data export | Built | Migrations 0015, 0012; export includes Chats data | B |
| Server-side authorization for Chats | Working | API test covers blocked users, non-members, ex-friends | M |
| End-to-end encryption | Connect only | Online Chats is not end-to-end encrypted and says so | — |
| Metro start-up hang | Fixed | `apps/mobile/metro.config.js` limits Metro to the app folder | M |

## 23. Tests actually run (today)

- Web: 571 unit tests, typecheck, lint pass on `6ffbdca` (clean worktree). CI green on `6ffbdca`.
- App: typecheck, lint, 129 tests (Connect, admin) pass on `6ffbdca`; 20 App lock tests; 4 icon tests.
- Chats: 52-check two-account API test against a local database.
- Phone (CPH2763, Android 16): launch, icon switch to Ivory, App lock setup by the user. Feed, Chats screens, People nearby search: not yet exercised in Cowork's own build (the user mostly used Expo Go, which lacks the native modules).
- Not run: two-phone Connect, offline outbox, push, iOS anything.

## Next, in order (mobile)

1. Release APK: build, send to the user, install on the phone, walk through every row marked "Built, unverified".
2. Confirm a successful deploy carries R2 and the admin console; verify photo uploads and the private account.
3. Community tab with Spaces screens: built, verify on the phone after the deploy.
4. Chats media (images, documents, voice) once uploads work; forwarding.
5. Realtime subscription in the app once Supabase Realtime keys are set.
