# Cowork social platform: Phase Zero audit

Date: 2026-11-12. Base commit: `0d8ae3d` (master), plus uncommitted work in the same checkout listed in section 1.
Read-only: no application file was changed for this audit. This document is the only file written.

Scope: the "Cowork ultimate master" brief (global social network: Chat, Spaces, Moments, Nearby, Explore, Pulse, AI as a productivity layer). The pasted brief stops inside section 18 (Notifications); sections 18 onward have not been received and are not mapped here.

Builds on `docs/COWORK_V2_AUDIT.md` (assistant product, phases 0 to 3), `docs/COWORK_CONNECT_FEASIBILITY.md` (offline peer-to-peer) and `docs/ADMIN_CONSOLE_PROPOSAL.md` (admin). Where they disagree on a fact, this document is newer.

**Ownership (user decision, 2026-11-12: "Split by area")**
- Mobile app (`apps/mobile`): session "Cowork mobile application transformation" (`local_4764f7f3`).
- Backend and web (realtime delivery, media storage, web routes and pages, admin and moderation tooling, the server APIs those need): session `local_6aeaa843`.
- `lib/social/*`, `app/api/social/**` and migration `0013` were written by the mobile session and stay with it; changes there are agreed between the two sessions first.

---

## 1. Repository architecture

```
Android app (Expo SDK 58, RN 0.88.1)            Website (Next.js 15.5, React 19)
   | Bearer session token                           | session cookie, nonce CSP
   +--------------> Next.js API on Vercel (syd1) <--+
                      app/api/** (83 handlers), server actions
                      lib/agent, lib/ai (router), lib/social (Chats)
                      lib/jobs (queue), lib/push (web-push + FCM v1), lib/email (Resend)
                      v
          Postgres on Supabase (owner role through Drizzle + postgres.js)
          56 tables, 14 migrations (0000-0013), pgvector
```

- One deployable (a modular monolith), not microservices. Background work runs through a `jobs` table drained by `/api/cron/dispatch`. Vercel schedules it daily; a more frequent run comes from Supabase `pg_cron`, which is configured outside the repository.
- Realtime: none. AI answers stream as NDJSON; Chats between people uses polling.
- Files: none stored as files. Broadcast attachments are Postgres `bytea`. Knowledge and chat uploads keep extracted text only. Avatars are base64 data URLs (up to 200 KB) in `users.avatar_url`.

**Uncommitted work in the checkout at audit time** (other sessions; not reviewed for correctness here):
- Chats between people: `lib/social/*`, `app/api/social/**`, migration `0013_social_chats.sql` (8 tables, RLS on), the app's `(tabs)/chats`, `dm/*`, `people/*`. It is not known whether `0013` is applied to production.
- App lock: `apps/mobile/src/features/lock/*`, `settings/app-lock`.
- AI Studio: `lib/studio/*`, `app/api/mobile/studio/*`, `apps/mobile/src/app/studio/*`.
- Opening animation: `apps/mobile/src/components/launch.tsx` and the boot section of `apps/mobile/src/app/_layout.tsx` (mobile tsc and lint pass; not checked on the phone).

## 2. Feature inventory against the brief

Legend: **W** working, **P** partial, **B** broken, **M** missing, **X** needs external configuration.

| Brief area | Status | Evidence |
|---|---|---|
| 3.1 Splash, session restore, AppState | W | `expo-splash-screen`, `lib/session.ts` (SecureStore token, 401 signs out) |
| 3.1 Network detection, offline mode, sync | M | `netinfo` installed but never imported; no SQLite |
| 3.1 Update check, forced update, maintenance | M | no `expo-updates`, no server version gate, no maintenance page (web or app) |
| 3.1 Crash recovery | M | no error boundary in the app; web has one (`trackers/error.tsx`), no `global-error.tsx` |
| 3.1 Deep links | P | `cowork://` scheme only; no App Links / universal links; push routing has no `/dm` mapping |
| 3.2 Email OTP | W | `lib/auth/otp.ts` (hashed, 10 min, 5 attempts, rate limited) |
| 3.2 Google sign-in, passkeys, password, recovery | M | Google OAuth exists only for Gmail/Calendar/Drive integrations |
| 3.2 Session list and revoke | P | web `settings/account` lists and revokes; no app endpoint or screen |
| 3.2 Suspicious-login alerts, device verification | M | sign-in only writes an activity row |
| 3.2 Username availability, interests, language | P | handle is chosen when joining Chats (`social_profiles.handle`, reserved list in `lib/social/rules.ts`); no interests or language |
| 3.3 App lock (PIN, biometrics, timeout, recents) | W (uncommitted) | `features/lock/*`; not reviewed here |
| 3.4 Five tabs Home, Spaces, Create, Chat, Explore | P | tabs today: Home, Chat (the AI), Create, Workspace, Profile; Chats between people has no tab |
| 4 Feed, posts, comments, reactions, saves | M | no tables, routes or screens |
| 5 1:1 and group chat (text) | P (uncommitted) | reply, edit within 24h, delete, 6 reactions, typing, read state, presence, mute, rename, leave, search; **delivered by polling** (thread every 3 s) |
| 5 Attachments, voice notes, link previews, forward, pin, disappearing | M | `dm_messages` is text only |
| 5 Group roles, invite links, join requests | P | `dm_members.role` owner/admin/member; no invite links or requests |
| 5 Voice and video calls | M | no calling provider |
| 6 Offline queue | B | `features/social/outbox.ts` exists but `useOutboxRunner` is never mounted, so queued messages are not reloaded or retried after a restart |
| 6 SQLite, sync cursors, media cache | P | server has a per-thread `seq` cursor and idempotent `clientId`; no local database |
| 6 Nearby / same-network transport | M | see `COWORK_CONNECT_FEASIBILITY.md`; needs a second Android phone |
| 7 Friends, block, report, people search | W (uncommitted) | `friendships`, `user_blocks`, `user_reports`, `app/api/social/{friends,blocks,reports,people}` |
| 7 Follow, followers, mutuals, suggestions | M | no follow model |
| 7 Profile page, QR, links, verification, themes | M | other users appear as rows only; avatar upload not wired |
| 7 Public/private profile, discoverability | P | `social_profiles.searchable`, `showPresence`, `readReceipts`, `pushPreview` |
| 8 Spaces (communities, roles, rules, events) | M | |
| 9 Anonymous (university and public) | M | |
| 10 Moments (stories, snaps, camera) | M | no camera, image picker or media storage |
| 11 Nearby discovery | M | no location, discovery sessions or QR pairing |
| 12 Explore, Pulse, trending | M | |
| 13 AI assistant | W | chat with streaming, attachments (text extraction), retry, export, delete, memory with user control, usage rows (`ai_runs`), provider fallback, rate limits; AI Studio assignment writer uncommitted |
| 13 Image-to-text, quizzes, translation, presentation, resume | M | the AI layer is text only; images are refused (V2 audit D6) |
| 14 Theme, reduced motion, haptics, skeletons | W | orange palette (`0d8ae3d`), light/dark/system, `useReducedMotion`, static skeletons |
| 14 Accent colour, wallpapers, font size, density | M | |
| 14 Bottom sheets with gestures, shared-element transitions | M | `components/sheet.tsx` is an RN `Modal` |
| 15 Settings: account, notifications, appearance, delete | W | `settings/*` (app) and `settings/*` (web) |
| 15 Settings: privacy (social), blocked accounts | W (uncommitted) | `people/settings` |
| 15 Settings: sessions, login history, storage, data saver, language | M | |
| 15 Data export | P | `app/api/export` leaves out all social data |
| 16 Web: social pages (feed, chat, spaces, profiles, moments) | M | the website has no social pages; Chats is app-only |
| 16 Web: landing, terms, privacy, login | W | `/home`, `/terms`, `/privacy`, `/login`, `/delete-account` |
| 16 Web: help, not-found, error, maintenance | M | |
| 16 Web: sitemap, robots, OG, manifest, security headers | W | `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, `manifest.ts`, HSTS / CSP / frame DENY in `next.config.ts` and `middleware.ts` |
| 16 Web: PWA offline caching | P | `public/sw.js` handles push only |
| 17 Camera, gallery, microphone recording, contacts, location | M | none imported; speech recognition is the only microphone use |
| 17 Push | X | code complete (FCM v1 + web-push); the app has no `google-services.json`, so native push returns `not_configured` |
| Admin console | P | `/console` (users, broadcast, AI, system), allowlist admins via `ADMIN_EMAILS`; reports from `user_reports` have **no reader** |
| Moderation | M | no content moderation, no review queue, no appeals |

## 3. Screen inventory

**App** (`apps/mobile/src/app`): `(auth)` welcome, sign-in, verify; `onboarding` profile, privacy, permissions, first-chat; tabs `index` (Home), `assistant` (AI chats), `create`, `workspace`, `settings` (Profile), `chats` (people, no tab); `chat/[id]` (AI); `dm/[id]`, `dm/details/[id]`, `dm/new-group`; `people/index`, `people/settings`; `tasks`, `task/[id]`, `agenda`, `meeting/[id]`, `notes/*`, `approvals`, `notifications`, `search`; `studio/index`, `studio/assignment` (not linked from any screen); `settings/` account, activity, app-lock, appearance, delete, documents, integrations, memory, notifications, permissions, phone; `+not-found`.

**Web** (`app/`): public `/home`, `/login`, `/onboarding`, `/privacy`, `/terms`, `/delete-account`, `/oauth/authorize`; signed-in `/` (Today), agents, approvals, automations, chat, console/*, content, flow, inbox, integrations, knowledge, notes, phone, schedule, settings/*, tasks, trackers/*. No social pages.

## 4. API inventory (83 handlers)

| Area | Routes |
|---|---|
| Social (uncommitted) | `social/` profile, people, friends, blocks, threads, `threads/[id]` (+ `?after=` polling), `threads/[id]/messages` (idempotent by `clientId`), `threads/[id]/read` (receipt + typing), `messages/[id]` (+ reactions), search, reports |
| Mobile | auth (request, verify, sign-out), me, today, tasks, notes, memories, approvals, meetings, documents, integrations, preferences, push, phone, search, notifications/read, report (AI answer), studio (questions, answer, check, export) |
| AI chat | chat (NDJSON), attach, conversations, suggestions |
| Assistant data | tasks, notes, emails, schedule, focus, meetings, knowledge, news, notifications, activity, trackers, spotify, voice, export, tokens |
| Platform | cron (sync-email, dispatch, briefing), health, mcp, oauth/* (authorization server), integrations (Google, LinkedIn, Canva), automations webhook, phone pairing, flow, brand/logo, email/unsubscribe, admin/broadcast-files, dev/mock-ai (404 outside test mode) |

## 5. Database audit

- 56 tables. Social (uncommitted, `0013`): `social_profiles`, `friendships`, `user_blocks`, `dm_threads`, `dm_members`, `dm_messages`, `dm_reactions`, `user_reports`.
- Missing for the brief: follows, posts, comments, reactions on posts, saves, hashtags, spaces, space members and roles, space rules, events, anonymous identities, stories, story views, media objects, nearby sessions, call logs, moderation actions, appeals, admin roles, audit log, device sessions for login alerts.
- RLS is enabled on 17 tables with no policies (defence in depth against Supabase's public Data API). `users`, `sessions` and all tables from `0000` to `0009` have it **off**: the Data API could expose them if the anon key were ever used. Fix: one migration enabling RLS on every remaining table.
- `users.avatar_url` holds image data inline, so every row that joins `users` carries up to 200 KB. It should move to object storage before profiles appear in feeds.

## 6. Authentication audit

- Strong for what exists: hashed OTPs, attempt limits, rate limits, SHA-256 session tokens, 30-day sliding expiry, `OTP_TEST_MODE` refused on Vercel production.
- Gaps for a public social network: no Google sign-in, no passkeys, no app session management, no login alerts, no age or birthdate (needed for the audience decision, section 11), admin is an email allowlist rather than roles.
- Google sign-in can reuse the existing Google OAuth client, but the consent screen must be verified for public use. Passkeys need `/.well-known/assetlinks.json` and `apple-app-site-association` on antropic.me.

## 7. Dependency audit

- Web: `motion` and `gsap` are both installed (two animation libraries); `swr` alongside server components. No media, realtime, calling or maps library.
- App: imported nowhere: `expo-constants`, `expo-linking`, `expo-linear-gradient`, `expo-symbols`, `@expo/ui`, `@react-native-community/netinfo`, both TanStack Query persisters. Keep `netinfo` and the persisters (offline work needs them); remove the rest once confirmed unused.
- Needed later, each only in its phase: `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-audio`, `expo-video`, `expo-sqlite`, `expo-location`, a realtime client, a calling SDK.

## 8. Security audit

| Finding | Severity | Fix |
|---|---|---|
| No content moderation on anything users write | High before any public surface | Text and image moderation in the write path plus a review queue (section 11, R4) |
| No CSAM detection for user images | High before media uploads | Hash matching on upload is a legal expectation for image hosting (R4) |
| Reports are write-only | High | Reports queue in `/console`, actions, audit log |
| RLS off on `users`, `sessions` and older tables | Medium | One migration enabling RLS everywhere |
| No EXIF stripping (location in photos) | Medium before media | Strip on the client and re-encode on the server |
| Admin by email allowlist, no second factor | Medium | Roles table and step-up auth (`ADMIN_CONSOLE_PROPOSAL.md`) |
| Data export leaves out social data | Medium (GDPR access right) | Add social tables to `app/api/export` |
| Rate limits exist for social writes (90/min) but no spam or abuse heuristics | Medium | Per-action limits, new-account limits, duplicate-content checks |
| Good: SSRF guard (`safeFetch`), nonce CSP, HSTS, frame DENY, OAuth server per RFCs, no keys in the app | | |

## 9. Performance audit

- Polling: each open conversation hits Postgres every 3 s and the list every 8 s per device. Acceptable for a test group; at scale this is the main database load. Realtime delivery (R1) fixes it.
- Region `syd1` for a global audience: users far from Sydney pay 200 to 300 ms per request. Move the functions next to the database region (check the Supabase project's region first).
- Inline avatars (section 5) bloat every people and message response.
- Feed and explore will need cursor pagination with covering indexes and precomputed counters from the start; no fan-out tables exist yet.

## 10. Deployment audit

- Vercel builds `master`; `next build` typechecks. No CI (no `.github`): nothing runs the 266 unit tests or the Playwright smoke test before deploy.
- `vercel.json`: daily crons only. The frequent dispatch runs from Supabase `pg_cron`, which is not in the repository; it should be documented or scripted.
- `.env.example` is missing `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `AI_MOCK`.
- Push on the app needs a Firebase project file (`google-services.json`) wired through `app.json`.
- iOS has never been built: it needs an Apple Developer account and a Mac or EAS cloud builds.

## 11. Decisions needed before building (backend and web area)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| R1 | **Realtime delivery** for chat, typing, presence, notifications | (a) Supabase Realtime Broadcast on private channels, server-minted short-lived tokens, server publishes after each write; (b) a managed service (Ably or Pusher) with token auth from our API; (c) our own WebSocket service | **(a)**: same Supabase project, no new vendor, sign-in stays ours (D1 keeps Cowork's auth; only the transport is added). Postgres stays the source of truth and polling stays as the fallback |
| R2 | **Media storage** for avatars, posts, stories, chat attachments | (a) Supabase Storage, private buckets, signed upload and read URLs; (b) Vercel Blob (private); (c) Cloudflare R2 | **(a)**. Uploads go straight from the device with a signed URL (Vercel functions cap bodies at 4.5 MB); the server records the object, strips metadata and makes thumbnails in a job. Video: compress on the device first; streaming (HLS) only if needed later |
| R3 | **Calls** | LiveKit Cloud, Agora, Daily, Stream | **LiveKit** (open source, Expo config plugin, self-hostable later). Needs incoming-call notifications (Android ConnectionService, iOS CallKit) in the app. Separate phase, after chat is realtime |
| R4 | **Moderation** | Text: through `lib/ai/router.ts` classification, or a dedicated moderation API. Images: a moderation API plus CSAM hash matching. Humans: a reports queue in `/console` | All three before any public surface (posts, Spaces, Anonymous, Moments). The provider choice is yours; it is never shown to users |
| R5 | **Microservices** | Split now, or a modular monolith with modules extracted when a workload needs it | **Modular monolith**: `lib/social`, `lib/feed`, `lib/media`, `lib/realtime`, `lib/moderation` with no cross-imports of internals. Realtime, media and calls already run on managed services, which is the part that needs to scale separately |
| R6 | **Audience and age** ("everyone, globally") | 18+ only at first, or 13+ with age declaration and teen protections | 18+ at launch, then 13+ once teen defaults (private profiles, no Nearby, no Anonymous, restricted DMs) exist. This changes store ratings and legal duties, so it is your call |
| R7 | **Product identity** | Tagline "Connect Beyond Boundaries" replaces "A personal AI assistant"; the assistant features (mail, calendar, tasks, notes, meetings, automations) stay as the AI layer | Confirm. Nothing is removed (brief rule 2) |
| R8 | **Function region** | Keep `syd1`, or match the database region | Match the database region |
| R9 | **Rest of the brief** | Sections 18 onward did not arrive | Paste the rest so notifications, admin and release sections can be mapped |

**Decided (user, 2026-11-12)**
- **R1: Supabase Realtime.** Private Broadcast channels with server-minted short-lived tokens; the server publishes after each committed write; polling stays as the fallback. Cowork's own sign-in is unchanged.
- **R2: Cloudflare R2.** Private bucket, signed upload and read URLs minted by our API (S3-compatible API), thumbnails and metadata stripping in jobs. Needs an R2 bucket and API token (external configuration).
- **R6: 13+ from the start.** Date of birth at sign-up (under-13 refused, no account created). Teen accounts (13 to 17) get protective defaults before any public surface ships: private profile, messages from friends only, not shown in Nearby, no Anonymous, not suggested to adults they don't know. These protections gate B4 to B10.
- **B1 approved** to start.
- **R4: existing AI provider plus Cloudflare.** Text and images are classified through `lib/ai/router.ts` (images need a vision-capable model configured); Cloudflare's CSAM Scanning Tool covers images served from R2 through a Cloudflare domain; anything flagged goes to the console review queue.
- Still open: R3 (calls provider, decided at B9), R5 (modular monolith assumed unless you say otherwise), R7, R8, R9.

**Progress (2026-11-12)**
- B1 shipped (`6a835c9`, `923a9ed`): not-found, error and help pages, maintenance mode, CI. The reports queue (`/console/reports`) and social data in the export are built and wait for the Chats commit (they read its tables).
- Production migrations applied with approval: `0014` (users.birth_date), `0015` (RLS on all 56 tables; the realtime channel policy). Verified: column present, RLS 56/56, policy created, live health check ok.
- Age gate built: `PUT /api/mobile/me/birthdate`, `ageGroup` in `/api/mobile/me`, a date-of-birth step in web onboarding; under 13 deletes the account. Waits for the Chats commit (shared `schema.ts`).
- B2 server side: `GET /api/realtime/token` and the publisher shipped (`9074b88`); every Chats write route sends its hint after the response (uncommitted with Chats). Off until the Supabase keys are set.

- B3 and B4 server side shipped: migration `0016` (applied with approval), feeds, posts, comments, reactions, saves, follows, profiles, reports, uploads, text moderation with holds, Take down in the console. Verified on an in-memory Postgres with every migration applied (13 checks). Not done yet: website pages for the feed, image moderation (needs a vision-capable model), thumbnails, and removing R2 objects when posts or accounts are deleted.

## 12. Migration plan (backend and web; mobile phases are the mobile session's)

Each step is reversible, keeps every existing feature, and uses Drizzle migrations reviewed before `pnpm db:migrate` (production).

| Step | Work | Depends on |
|---|---|---|
| B0 | This audit. Commit the uncommitted Chats work after review (mobile session) and confirm `0013` on production | |
| B1 | Foundations: RLS on every table; reports queue and moderation actions in `/console` with an audit log; social data in export; web `not-found`, `global-error`, maintenance and help pages; `.env.example` and `pg_cron` documented; CI running typecheck, lint and tests | none |
| B2 | Realtime: channel tokens, publish-after-write for messages, receipts, typing and presence; the app switches from polling to subscriptions (mobile session) with polling as fallback | R1 |
| B3 | Media: storage buckets, signed uploads, a `media` table, metadata stripping, thumbnails, avatars moved out of `users`; chat attachments and voice notes | R2, R4 |
| B4 | Follows, profiles, posts, comments, reactions, saves, feed (cursor pagination, block and privacy filters) with web pages | B1, B3, R4 |
| B5 | Spaces: communities, roles, rules, join requests, posts and threads, events; web pages | B4 |
| B6 | Moments: stories with server-enforced expiry and storage deletion, viewers, close friends | B3 |
| B7 | Anonymous: per-space pseudonyms, identity mapping readable only by a restricted admin role, appeals | B5, R4, R6 |
| B8 | Explore and Pulse: trending and suggestions from real signals, privacy-aware | B4 to B6 |
| B9 | Calls | R3, B2 |
| B10 | Nearby (server side: discovery sessions, consent, expiry) alongside Connect's native work | Connect decisions D1 to D7 |

## 13. Requirement-to-code mapping (where each brief area lands)

| Brief section | Server | Web | App (mobile session) |
|---|---|---|---|
| 3 Lifecycle, auth, lock | `lib/auth/*` (Google, passkeys, sessions API, login alerts), a version and maintenance endpoint | `app/(auth)`, `settings/account` | `_layout.tsx`, `features/lock`, `(auth)` |
| 4 Feed | `lib/feed/*`, `app/api/feed/*`, `app/api/posts/*` | `app/(app)/feed`, post pages | `(tabs)/index` |
| 5 Chat | `lib/social/*`, `lib/realtime/*`, `app/api/social/*` | `app/(app)/messages/*` | `(tabs)/chats`, `dm/*` |
| 6 Offline | idempotent writes and cursors (exist) | | `expo-sqlite`, outbox |
| 7 Social graph | `lib/social/graph`, follows table | profile pages `/u/[handle]` | `people/*`, profile screen |
| 8 Spaces | `lib/spaces/*`, `app/api/spaces/*` | `/spaces/*` | Spaces tab |
| 9 Anonymous | `lib/anonymous/*` | `/spaces/[id]/anonymous` | |
| 10 Moments | `lib/moments/*`, `lib/media/*`, expiry job | `/moments/[id]` viewer | camera, editor |
| 11 Nearby | `lib/nearby/*` | | `modules/*` native |
| 12 Explore, Pulse | `lib/explore/*` | `/explore` | Explore tab |
| 13 AI | `lib/ai/*`, `lib/studio/*` (exist) | `/chat` (exists) | AI entry outside the tab bar |
| 14, 15 Appearance, settings | `user_settings` columns | `settings/*` | `settings/*` |
| 16 Web | | everything under `app/` | |
| 17 Device | | | Expo modules per phase |
| Admin and moderation | `lib/admin/*`, `lib/moderation/*` | `/console/*` | |
