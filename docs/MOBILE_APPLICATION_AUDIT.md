# Cowork mobile application audit

Audit date: 2026-10-21. Branch: master (HEAD 2e89b36, with uncommitted mobile changes listed in section 8).

This document describes the code as it is today. Nothing was changed while it was written. Every claim points to a file and, where useful, a line number. "Status" values used below:

| Status | Meaning |
| --- | --- |
| Complete | Works end to end on mobile, with server support |
| Partial | Some of the spec item works; the gaps are listed |
| Missing | Not in the mobile app, and usually not in the mobile API either |
| Broken | Present but behaves incorrectly |
| Server only | The server has the logic, but only as a web server action, so the app cannot call it |

---

## 1. Current repository architecture

One git repository holds the web app, the server and the Android app.

| Part | Location | Notes |
| --- | --- | --- |
| Web app and API | repo root: `app/`, `components/`, `lib/` | Next.js 15 App Router. Deployed on Vercel at https://antropic.me, region syd1 (`vercel.json`). |
| Web pages | `app/(app)/*` | agents, approvals, automations, chat, console, content, flow, inbox, integrations, knowledge, notes, phone, schedule, settings, tasks, trackers |
| API routes | `app/api/*` | 30 top-level groups. Mobile-only routes live in `app/api/mobile/**` (17 route files). |
| Server actions | `app/actions/*.ts` | Wrapped by `ownerAction` (`lib/auth/action.ts:14`). They accept bearer sessions, but their IDs change on every build, so they are not a usable mobile API. |
| Database | `lib/db/schema.ts`, migrations in `lib/db/migrations` | Drizzle ORM on Supabase Postgres. User-owned tables cascade from `users` (`schema.ts:37-40`). |
| Auth | `lib/auth/session.ts`, `lib/auth/otp.ts`, `lib/auth/api.ts` | Email one-time code. Session is a cookie OR an `Authorization: Bearer` token (`session.ts:52-57`). Tokens are stored as sha256 hashes (`session.ts:37`). Fixed 30-day lifetime (`session.ts:12`). |
| AI | `lib/ai/router.ts`, `lib/agent/*` | Router tries the user's own provider key first, then server providers (`router.ts:22-25`). Chat turn logic in `lib/agent/chat.ts`. |
| Jobs | `lib/jobs/*`, `app/api/cron/*` | Postgres job queue. `scheduleDueWork` (`lib/jobs/scheduler.ts:96`) is called only from `/api/cron/dispatch`. |
| Notifications | `lib/db/queries/notifications.ts`, `lib/push.ts`, `lib/fcm.ts` | Web push plus FCM. Mobile tokens are stored with an `fcmapp:` prefix and sent through `sendFcm` (`lib/push.ts:39-44`). |
| Security helpers | `lib/security/*` | Same-origin check, rate limits (Upstash with in-memory fallback), secret redaction. |
| Mobile app | `apps/mobile` | Expo SDK 58, React Native 0.88, React 19.3, Expo Router, TanStack Query, Zustand, SecureStore, `expo/fetch` streaming. Android only in practice (no `ios` or `web` section in `app.json`). |
| Native module | `apps/mobile/modules/phone-link` | Kotlin notification listener (Phone link). Forwards notifications to `/api/phone/events` with a device token. |
| Config plugin | `apps/mobile/plugins/with-release-signing.js` | Untracked, but referenced by the modified `app.json`. |
| Legacy phone app | `android/phone-link`, `public/downloads/cowork-phone-link.apk` | Older Java app. Still offered on the web Phone page (`app/(app)/phone/page.tsx:11`). |
| Tests | `tests/unit` (vitest), `tests/e2e` (Playwright) | No CI config in the repo (no `.github/`). |
| Docs | `README.md`, `docs/design.md`, `docs/feature-audit.md`, `docs/mobile-app.md` (untracked), `apps/mobile/store/listing.md` (untracked) | |

### Cron schedule (important for reminders)

`vercel.json` schedules `/api/cron/dispatch` at `0 1 * * *` (once a day, 01:00 UTC), `/api/cron/sync-email` daily and `/api/cron/briefing` daily. `README.md:126-128` says dispatch should run every 5 minutes and that the daily schedule is the Hobby-plan fallback. Task reminders are enqueued only by dispatch (`lib/jobs/scheduler.ts:90-93`). Unless an external scheduler calls `/api/cron/dispatch` (not visible in the repo), reminders can arrive up to a day late. This must be confirmed in the Vercel project before any reminder work on mobile.

---

## 2. Existing mobile application architecture

### Source layout (`apps/mobile/src`, 61 files)

| Folder | Contents |
| --- | --- |
| `app/` | Expo Router screens (file-based routes) |
| `components/` | `ui.tsx` (Button, IconButton, Txt, rows, states), `sheet.tsx`, `orb.tsx` |
| `features/` | approvals, chat, home, onboarding, settings, tasks, voice |
| `lib/` | `api.ts` (JSON client), `chat.ts` (streaming client), `ndjson.ts`, `session.ts` (Zustand + SecureStore), `push.ts`, `phone-link.ts`, `queries.ts` (TanStack Query), `types.ts`, `config.ts` |
| `theme/` | `tokens.ts`, a single dark palette |

### Navigation map

Root stack (`src/app/_layout.tsx`) uses three `Stack.Protected` groups. The splash stays up until fonts load and the session is restored.

| Guard | Screens | Files |
| --- | --- | --- |
| Signed out | Welcome, Sign in, Verify code | `(auth)/welcome.tsx`, `sign-in.tsx`, `verify.tsx` |
| Signed in, setup not finished | Profile, Privacy, Permissions, First chat | `onboarding/*.tsx`; resumes at the saved step via `useStepGuard` (`features/onboarding/frame.tsx:42-49`) |
| Signed in and set up | Tabs: Home, Assistant, Tasks, Settings | `(tabs)/_layout.tsx`, `index.tsx`, `assistant.tsx`, `tasks.tsx`, `settings.tsx` |
| | Chat (`new` or an id; optional `?prompt=` and `?voice=1`) | `chat/[id].tsx` |
| | Task detail (modal) | `task/[id].tsx` |
| | Approvals, Notifications | `approvals.tsx`, `notifications.tsx` |
| | Settings stack: Memory, Documents, Integrations, Activity, Phone link, Delete account | `settings/_layout.tsx` and children |

Deep links use the `cowork` scheme with a BROWSABLE intent filter. There is no `+not-found` screen, so an unknown link shows Expo Router's default "Unmatched Route" screen. Typed routes are off (`app.json` `experiments.typedRoutes: false`), so route strings are not compile-checked. Every `router.push` and `router.replace` target in the source resolves to an existing file.

### Data flow

- `lib/api.ts` adds the bearer token, maps network failures to an offline message, and signs out on any 401 (`api.ts:58`).
- `lib/chat.ts` posts to `/api/chat` with `expo/fetch` and parses NDJSON events. A 401 here returns an error but does not sign the app out (`chat.ts:32-35`).
- `lib/queries.ts:19-27` holds an in-memory `QueryClient`. Nothing is persisted, and there is no NetInfo or AppState wiring.
- `lib/session.ts` keeps the token and onboarding step in SecureStore.

---

## 3. Web-to-mobile dependencies and shared modules

All shared routes use `apiGuard` (`lib/auth/api.ts:11`), which accepts a bearer token. Its same-origin check (`lib/security/request.ts:12-19`) passes requests with no `Origin` and no `Sec-Fetch-Site` header, which is what native fetch sends. Every path and field the app calls matches a real route; no mismatches were found.

### Endpoints the app calls today

| Endpoint | Methods | Used by (mobile) | Server file | Notes |
| --- | --- | --- | --- | --- |
| `/api/mobile/auth/request` | POST | `(auth)/sign-in.tsx` | `app/api/mobile/auth/request/route.ts` | Sends the email code |
| `/api/mobile/auth/verify` | POST | `(auth)/verify.tsx` | `app/api/mobile/auth/verify/route.ts` | Returns `{ok, token, isNew}`, no-store |
| `/api/mobile/auth/sign-out` | POST | `lib/session.ts` | `app/api/mobile/auth/sign-out/route.ts` | Revokes the current session |
| `/api/mobile/me` | GET, PATCH, DELETE | onboarding, settings, delete | `app/api/mobile/me/route.ts` | PATCH takes only name, timezone, onboarded (lines 42-46). DELETE needs `{confirm:'DELETE'}` |
| `/api/mobile/today` | GET | Home | `app/api/mobile/today/route.ts` | Briefing, today's events (no id), priorities, review, mail, approval count |
| `/api/mobile/approvals`, `/[id]` | GET, POST | `approvals.tsx`, chat proposal cards | `app/api/mobile/approvals/*` | |
| `/api/mobile/tasks`, `/[id]` | GET, POST, PATCH, DELETE | Tasks tab, task modal | `app/api/mobile/tasks/*` | Open tasks only; PATCH lacks remindAt, tags, status |
| `/api/mobile/memories`, `/[id]` | GET, POST, PATCH, DELETE | `settings/memory.tsx` | `app/api/mobile/memories/*` | GET omits source and conversationId |
| `/api/mobile/documents/[id]` | DELETE | `settings/documents.tsx` | `app/api/mobile/documents/[id]/route.ts` | |
| `/api/mobile/push` | POST, DELETE | `lib/push.ts` | `app/api/mobile/push/route.ts` | Stores `fcmapp:` endpoint |
| `/api/mobile/phone` | GET, POST, DELETE | `settings/phone.tsx` | `app/api/mobile/phone/route.ts` | Creates the phone device token |
| `/api/mobile/integrations` | GET | `settings/integrations.tsx` | `app/api/mobile/integrations/route.ts` | Read only; connecting happens on the web |
| `/api/mobile/notifications/read` | POST | `notifications.tsx` | `app/api/mobile/notifications/read/route.ts` | Marks all as read |
| `/api/mobile/report` | POST | chat Report sheet | `app/api/mobile/report/route.ts` | Sends to admin Telegram |
| `/api/chat` | POST (NDJSON stream) | `lib/chat.ts` | `app/api/chat/route.ts`, `lib/agent/chat.ts` | Events: meta, tool, citations, text, proposal, memory, notice, done, error |
| `/api/chat/conversations` | GET (`?q=`, `?id=`) | Assistant tab, chat history | same | GET only, no rename or delete |
| `/api/chat/suggestions` | GET | empty chat | `lib/agent/suggestions.ts` | Empty-state prompts, not follow-ups |
| `/api/knowledge/items` | GET | Documents | `app/api/knowledge/items/route.ts` | Not filtered to uploads |
| `/api/knowledge/upload` | POST (multipart) | `features/settings/upload.ts` | `app/api/knowledge/upload/route.ts` | Synchronous extract, chunk, embed |
| `/api/notifications` | GET | Notifications screen, badge | `app/api/notifications` | |
| `/api/activity` | GET | `settings/activity.tsx` | `app/api/activity` | |
| `/api/phone/events` | POST | Kotlin `NotifyService` | `app/api/phone/events/route.ts` | Device token, not session |

### Shared routes that exist and work with a bearer token, but the app does not use yet

| Endpoint | Purpose | Server file |
| --- | --- | --- |
| `/api/chat/attach` (POST multipart) | Extract text from PDF, DOCX, text and code files for a chat turn; rejects images (415) and secret files | `app/api/chat/attach/route.ts:15-41` |
| `/api/notes`, `/api/notes/[id]` (GET) | Notes and bookmarks list with `q`, `tag`, `kind`, `limit` | `app/api/notes/*` |
| `/api/schedule?from=&to=` (GET) | Agenda up to 45 days, events with id, meetingUrl, hasNotes, calendar status ok/not_connected/error | `app/api/schedule/route.ts:15-41` |
| `/api/meetings?eventId=&at=` (GET) | Meeting notes for one event | `app/api/meetings/route.ts` |
| `/api/focus` (GET) | Focus summary | `app/api/focus/route.ts` |
| `/api/tasks`, `/api/tasks?id=` (GET) | All tasks; one task with subtasks and focus minutes | `app/api/tasks` |
| `/api/voice/config`, `/transcribe`, `/speak` | Voice preferences, server STT and TTS (501 when not configured) | `app/api/voice/*` |
| `/api/export?format=json|md` (GET) | Data export download | `app/api/export/route.ts:13-16` |

### Features that exist only as server actions (need new routes before mobile can use them)

| Feature | Server action | Backing module |
| --- | --- | --- |
| Session list, revoke, sign out everywhere | `app/actions/auth.ts:40,48` | `lib/auth/session.ts:109-141` |
| Full profile (role, bio, language, formats, avatar) | `app/actions/settings.ts:17-33,95` | |
| Agent settings (name, personality, voice, rate, capabilities) | `app/actions/settings.ts:35-60` | `lib/db/queries/settings.ts:19-26` |
| Notification preferences, quiet hours, briefing time | `app/actions/settings.ts:62-87` | |
| Own AI provider key | `app/actions/ai-key.ts:18,44` | |
| Notes and bookmarks writes | `app/actions/notes.ts:22-103` | `lib/notes/service.ts`, `lib/notes/bookmark.ts` |
| Meeting notes save, summarize, delete | `app/actions/meetings.ts:20-72` | |
| Focus logging | `app/actions/focus.ts:10-34` | |
| Expenses, budgets, learning | `app/actions/trackers.ts:66-129` | `lib/trackers/queries.ts` |
| Knowledge from URL or pasted text | `app/actions/knowledge.ts:59-75` | `lib/knowledge/ingest.ts` |
| Task comments, approve, request changes | `app/actions/tasks.ts` | `lib/db/queries/tasks.ts` |

Error bodies differ: `apiGuard` and shared routes return `{error: 'snake_code'}`, mobile routes return `{ok:false, message}`. The app shows `body.error` verbatim when there is no `message` (`apps/mobile/src/lib/api.ts:32-41`), so users can see `rate_limited` or `forbidden`.

---

## 4. Feature inventory by spec area

### A. Auth and account

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Email code sign-in and sign-up | Complete | `(auth)/sign-in.tsx`, `verify.tsx` (auto-submit at 6 digits, 30s resend cooldown, in-flight ref guards) |
| Session persistence | Partial | SecureStore (`lib/session.ts`). `restore()` (lines 35-38) has no try/catch, so a SecureStore failure leaves the splash up forever |
| Expiry | Partial | Fixed 30 days, never extended by use (`lib/auth/session.ts:12,72`). 401 in `api()` signs out and shows a banner (`welcome.tsx:46-53`); 401 in the chat stream does not |
| Logout | Broken | Remote sign-out revokes the session, but does not unlink Phone link. Expiry runs no cleanup at all (`lib/session.ts:53-68`). See section 6 |
| Revocation from another device | Server only | No session list or revoke route |
| Profile editing | Partial | Name and time zone only, and only during onboarding. Settings says to change it on the website |
| Account settings | Partial | See M |
| Delete account | Complete | `settings/delete.tsx`, typed `DELETE` confirmation, cascades all user data |

### B. First-run onboarding

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Persisted and resumable | Complete | Step saved in SecureStore (`lib/session.ts:47-50`); `PATCH /api/mobile/me {onboarded:true}` in `first-chat.tsx:40` |
| Skippable | Partial | Only the profile step has Skip. Steps use `router.replace`, so hardware Back exits the app mid-setup |
| Permissions only when needed | Complete | Notifications asked on "Turn on" only; mic and Phone link are explained, not requested (`permissions.tsx`) |
| Privacy and memory explanation | Partial | `privacy.tsx` explains memory, but there is no way to turn automatic memory off, and the "never does anything on its own" claim ignores user automations |
| Preferences | Missing | Only name and time zone. No agent name, tone, or notification choices (no route) |

### C. Home

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Greeting | Complete | `features/home/header.tsx` |
| Quick actions and chat access | Complete | Ask box and orb lead to `chat/new` |
| Voice access | Complete | `chat/new?voice=1` |
| Recent conversations | Missing | Not on Home (available on the Assistant tab) |
| Tasks and reminders | Partial | Top priorities with optimistic tick (`use-complete-task.ts`). `today.review` is returned but never rendered. Reminder times are not in the payload |
| Upcoming meetings | Partial | Today only (`features/home/cards.tsx:77-116`). Events have no id, so they cannot open meeting notes. Sync errors show as an empty calendar (Broken, see section 5) |
| Recent documents and notes | Missing | Data exists (`/api/notes?limit=`, `/api/knowledge/items`) |
| Suggestions | Missing on Home | `/api/chat/suggestions` is shown only in an empty chat |
| Search | Missing | No global search endpoint |
| Mail | Partial | Shown, not tappable |

### D. Assistant chat

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Streaming | Complete | `lib/chat.ts`, `features/chat/use-chat.ts` |
| History and persistence | Complete | `GET /api/chat/conversations?id=` |
| New chat | Complete | `chat/new` |
| Rename | Missing | No route or action anywhere (server or web) |
| Delete with confirmation | Missing | No route or action anywhere |
| Edit message | Missing | Server supports `replaceFromMessageId` (`lib/agent/chat.ts:79-91`) |
| Regenerate | Partial | Retry only on a failed last turn (`features/chat/components.tsx:201`) |
| Copy | Complete | Message and code block copy |
| Markdown | Complete | `features/chat/markdown.tsx`, http(s) links only |
| Code highlighting | Missing | Monospace with language label and Copy, no syntax colors |
| Attachments, document input | Missing on mobile | `/api/chat/attach` exists and accepts bearer; `SendInput` has no attachment field (`lib/chat.ts:7-13`) |
| Image input | Missing | Server rejects images with 415; needs a vision path |
| Stop | Partial | Client stop works. Server loses the reply: the assistant row is inserted only after the stream finishes (`lib/agent/chat.ts:216-235`) |
| Retry | Complete for failures | Replaces the stored user message |
| Network errors | Partial | Offline message exists; raw error codes can leak (`lib/api.ts:32-41`) |
| Search | Complete | Assistant tab uses `?q=` (titles and message content) |
| Model selection and active model | Missing | `done.model` is ignored; no route reads or sets the provider |
| Follow-up suggestions | Missing | No server event for this |
| Server notices and memory-saved lines | Broken | `memory` and `notice` events are not in the `ChatEvent` type (`src/lib/types.ts:73-80`) and are dropped |
| Keyboard-safe multiline composer | Complete, verify on device | `KeyboardAvoidingView` padding plus `adjustResize`; maxLength 8000 matches server |
| Report answer | Complete | `/api/mobile/report` |

### E. Memory

| Item | Status | Evidence and notes |
| --- | --- | --- |
| View, add, edit, delete | Complete | `settings/memory.tsx`, `features/settings/memory-sheet.tsx`; delete behind a confirm sheet |
| Separation from chat history | Partial | Copy explains it (`memory.tsx:60`), but the API does not return `source` or `conversationId`, and chat never shows "saved to memory" |
| Consent toggle | Missing | `settings.agent.capabilities.autoMemory` gates capture (`lib/agent/chat.ts:129`), but nothing anywhere can change it; the web action's zod schema omits it (`app/actions/settings.ts:45-54`) |

### F. Voice

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Permission | Complete | Requested on first use; denial offers Settings (`chat/[id].tsx:220-233`) |
| States | Partial | `voice-overlay.tsx`; the orb's speaking state is not wired to TTS |
| Speech to text | Complete | On-device `expo-speech-recognition`, one shot into the composer |
| Text to speech | Complete | `expo-speech` for voice-triggered replies |
| Interruption | Partial | Only Stop; no barge-in |
| Errors | Complete | Error map in `use-voice.ts` |
| Audio lifecycle | Partial | Stops on unmount and send; not on app background (no AppState) |
| Voice preferences | Missing | `/api/voice/config` exists but is not read |

### G. Coding assistant

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Code chat and explanation | Complete | General chat; `explain code` transform exists server side |
| Highlighting | Missing | See D |
| Code file attachments | Missing on mobile | `/api/chat/attach` supports code files |
| No fake file system access | Complete | No file system tools on the server, no such claims in the app |

### H. Documents and knowledge

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Native picker | Partial | `expo-document-picker`. MIME filter may grey out `.md` files on some Android providers (reported as `application/octet-stream`) |
| Upload progress | Complete | XHR progress (`features/settings/upload.ts`) |
| Validation | Complete | Type and 4 MB client check, matched on the server |
| Retry | Complete | Retryable vs final errors |
| Delete | Complete | Confirm sheet. The list mixes uploads with mirrored notes and synced Gmail/Drive/Slack/GitHub items, so delete can remove a note's search entry while the note stays |
| Preview | Missing | No route returns item text |
| Processing status | Missing | Upload is synchronous; there is no status to show |
| Summaries | Missing | No route |
| Document Q&A | Partial | Works through general chat (planner uses the knowledge source); no entry point from a document |
| Search | Missing in screen | Server supports `?q=` on titles |
| Local cleanup | Broken | Picked files are copied to cache and never deleted (`settings/documents.tsx:84`) |

### I. Projects, tasks, notes, bookmarks

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Tasks CRUD | Complete | `(tabs)/tasks.tsx`, `task/[id].tsx` |
| Priorities, due dates, scheduled time, duration | Complete | |
| Reminders, tags, status | Missing | Mobile PATCH lacks remindAt, tags, status (`app/api/mobile/tasks/[id]/route.ts:43-52`) |
| Search, filter, sort | Missing | No params on `GET /api/mobile/tasks` |
| Group | Complete | Overdue, Today, Upcoming, No date. Uses the device time zone while Home uses the profile time zone |
| Subtasks | Missing | The `[id]` route comment promises subtasks but returns none |
| Completed tasks | Missing | List is open tasks only |
| Task result | Partial | `resultMarkdown` shown as raw text (`task/[id].tsx:259-266`) |
| Notes | Missing | Read routes exist; writes are server only |
| Bookmarks | Missing | Same as notes |
| Projects | Missing | No projects table in `lib/db/schema.ts`. Closest: `tasks.tags`, `memories.kind='project'`, `sprints` |

### J. Planner, meetings, calendar

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Agenda | Missing on mobile | `/api/schedule` supports up to 45 days with status |
| Events | Partial | Today only on Home, read-only Google Calendar |
| Meeting notes | Missing on mobile | Read route exists; save, summarize, delete are server only |
| Meeting prep | Missing | Does not exist on web either |
| Time zones | Partial | Home uses the profile zone; task grouping uses the device zone. `/api/schedule` needs UTC `Z` strings |
| Sync errors | Broken | `/api/mobile/today` hides calendar errors (`route.ts:26-31`); Home says "Nothing on your calendar today" |

### K. Notifications and reminders

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Push registration | Partial | `lib/push.ts` and `/api/mobile/push`. Fails with `not_configured` until `google-services.json` is added (`docs/mobile-app.md:63`) |
| Permission | Complete | Asked only on user action |
| Foreground handling, tap routing, cold start | Missing | No `setNotificationHandler` or response listener. Server sends `data.href` (`lib/fcm.ts:40-47`) that nothing reads |
| Android channel | Partial | App creates `default`; server sends no `channel_id` |
| Local notifications | Missing | No `scheduleNotificationAsync` |
| Reminders | Partial | Server push only. Depends on the dispatch cron, which `vercel.json` runs once a day (section 1) |
| In-app list and mark all read | Complete | `notifications.tsx` |
| Mark one read | Missing | No route |
| Preferences | Missing | On/off only; quiet hours and kinds are server only |
| Copy accuracy | Broken | Settings and Notifications promise approval and reply notifications that the server never sends |

### L. Search and navigation

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Tabs | Partial | Four tabs work. Fixed `height: 64` squeezes them on Android with a nav bar (`(tabs)/_layout.tsx:23`) |
| Back behavior | Partial | Most screens use `canGoBack() ? back() : replace()`. Task modal Close and post-delete call `router.back()` unconditionally (`task/[id].tsx:46,306`) |
| Deep links | Broken | `cowork://chat/new?prompt=` auto-sends (`chat/[id].tsx:58-69`); no not-found screen; notification mapping (`notifications.tsx:14-28`) covers only chat, approvals, tasks and agents |
| Global search | Missing | No endpoint; only per-type `q` filters |

### M. Settings, privacy, accessibility

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Theme | Missing | Dark only (`app.json:9`, `_layout.tsx` DarkTheme) |
| Notifications | Partial | On/off switch only |
| Voice | Missing | No settings |
| Model | Missing | No route |
| Memory | Complete | Settings > Memory (no consent toggle) |
| Integrations | Partial | Read only, by design |
| Export | Partial | Links to the website, where the user has no cookie session (`settings/delete.tsx:81`); `/api/export` works with bearer |
| Delete account | Complete | Does not revoke the Google OAuth grant (section 6) |
| Help | Partial | mailto only |
| Version | Complete | `expo-application` |
| Sessions list | Missing | Server only |
| Phone link | Complete | Disclosure screen, link and unlink |
| Legal | Complete | Opens web pages |

### Cross-cutting

| Item | Status | Evidence and notes |
| --- | --- | --- |
| Offline | Missing | No NetInfo, `onlineManager`, `focusManager`, persisted cache or draft storage |
| Light and dark theme | Missing light | Single static palette in `theme/tokens.ts` |
| Animations | Complete | Restrained; orb follows reduced motion. Stack `fade_from_bottom` and Modal `slide` ignore it |
| Haptics | Complete | Selection haptic on every Button (`components/ui.tsx:47-50`), including Cancel |
| Accessibility | Complete, minor gaps | 48dp targets, labels, roles, live regions, font scale capped at 1.6 |
| Copy rules (characters) | Complete | No em dashes, en dashes, emoji or exclamation marks in mobile source or listing |
| Copy truthfulness | Broken in places | See section 5 |

---

## 5. Broken or incomplete functionality

| # | Problem | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | Web build is broken on master | `components/chat/chat-view.tsx:34` imports `./memory-line`, which was never committed (`git ls-files` returns nothing). Root `tsc --noEmit` fails with TS2307 | Any Vercel deploy from master fails, so no server change can ship until fixed |
| 2 | Reminders run once a day | `vercel.json` dispatch `0 1 * * *`; reminders enqueued only there (`lib/jobs/scheduler.ts:90-93`) | Unless an external scheduler exists, reminders arrive up to 24 hours late |
| 3 | Stop loses the answer on the server | `lib/agent/chat.ts:216-235`; route ignores `req.signal` | Reopening the chat shows the question with no reply |
| 4 | Calendar errors shown as empty | `app/api/mobile/today/route.ts:26-31`, `features/home/cards.tsx:94-95` | Untrue "Nothing on your calendar today" |
| 5 | Chat `memory` and `notice` events dropped | `src/lib/types.ts:73-80` vs `lib/agent/chat.ts:20-29` | Users never see "saved to memory" or "web search not set up" |
| 6 | Tab bar height | `(tabs)/_layout.tsx:23` `height: 64` while the tab bar still adds `insets.bottom` | Clipped icons and labels on 3-button navigation |
| 7 | Task modal Close on deep link | `task/[id].tsx:46,306` | Close does nothing; after delete the user is stuck |
| 8 | Splash hang | `lib/session.ts:35-38` no try/catch; `useFonts` error unchecked (`_layout.tsx`) | Blank splash forever if the Keystore entry is invalid |
| 9 | Raw error codes | `lib/api.ts:32-41`, `features/settings/upload.ts:84` | Users see `rate_limited`, `forbidden` |
| 10 | Quick add double tap | `(tabs)/tasks.tsx:17-28` checks `isPending` (stale until re-render) | Duplicate tasks |
| 11 | Chat stream 401 | `lib/chat.ts:32-35` | Session ended message, but the app stays signed in |
| 12 | Untrue notification copy | `(tabs)/settings.tsx:119`, `notifications.tsx:82`; server notify kinds are reminder, post_reminder, urgent_email, automation, automation_failed, briefing | Promises approval and reply notifications that never come |
| 13 | Store listing and privacy copy | `store/listing.md:18,28`, `onboarding/privacy.tsx`, `settings/phone.tsx:98` | "Retry any answer" (only failed ones); "never acts on its own" (automations run on schedule); Phone link notifications "reach your agent" (nothing in `lib/agent` reads `phone_events`); data-safety rows say Calendar and Files are not shared, but they go to the AI provider |
| 14 | Task detail comment vs code | `app/api/mobile/tasks/[id]/route.ts:16-41` | Doc says subtasks are returned; they are not |
| 15 | Documents list mixes sources | `/api/knowledge/items` unfiltered | Synced mail and mirrored notes appear as "documents" |
| 16 | Onboarding finish timing | `onboarding/first-chat.tsx:24-26` sets the step and replaces in the same tick | Verify on device that the guard does not redirect |

---

## 6. Security and reliability issues

| Severity | Issue | Evidence | Recommended fix |
| --- | --- | --- | --- |
| High | Sign-out, expiry and remote revocation leave Phone link forwarding this phone's notifications to the old account | `src/lib/session.ts:53-68` never calls `PhoneLink.clearLink()`; only `settings/delete.tsx:40` and `settings/phone.tsx:88,118` do. Server `revokeSession` and `signOutEverywhere` (`lib/auth/session.ts:105-118`) do not touch `phone_devices`; `lib/phone-server.ts:15-25` checks only `revokedAt` | Clear the link and `cowork.phoneDeviceId` on every sign-out path, call `DELETE /api/mobile/phone` before remote sign-out. Server: tie phone devices to the creating session and revoke them with it; reject disabled users in `deviceFromRequest` |
| High | Expired or revoked session keeps the FCM registration on the old account | `markExpired` skips `disablePush`; `cowork.pushToken` survives (`src/lib/push.ts:7,46-49`); push rows are not tied to sessions | Clear the local key and unregister the device token on every sign-out; re-register after sign-in. Server: store sessionId on push subscriptions and delete with the session. Delete the local key only after the server DELETE succeeds |
| High | `cowork://chat/new?prompt=` sends a turn as the user with no tap; `?voice=1` starts the mic | `src/app/chat/[id].tsx:58-69`; BROWSABLE `cowork` scheme | Prefill the composer for external links; pass in-app prompts through memory, not the URL |
| Medium | Phone link forwards every app's notifications, including OTP and bank codes | `NotifyService.kt:168-201` skips only own package, group summaries and ongoing; stored up to 1000 chars for 3 days (`app/api/phone/events/route.ts:40-58`) | Default to calls, SMS and WhatsApp; opt-in allowlist; skip secret visibility; mask code patterns. Align copy and Data safety form |
| Medium | Account deletion does not revoke Google OAuth grant and needs no fresh check; the audit entry is cascaded away | `app/api/mobile/me/route.ts:66-75`; revoke only in `app/actions/integrations.ts:111` | Shared delete helper that revokes Google tokens, requires a fresh code or recent session, and logs to a non-cascading place |
| Medium | OTP rate limits fall back to per-instance memory when Upstash is missing or errors | `lib/security/ratelimit.ts:79-89,126-136`; `lib/env.ts:26-27` | Fail closed for OTP limits in production; add a daily per-email verify cap |
| Medium | `OTP_TEST_MODE` honoured on Vercel previews | `lib/env.ts:133-137`, fixed code in `lib/auth/otp-core.ts:9` | Require a non-production database or explicit localhost allowlist; confirm Vercel Preview env (not checkable from the repo) |
| Medium | Knowledge upload has no cost-aware limit, parses form before size check, no secret-file check | `app/api/knowledge/upload/route.ts:12-28` vs `app/api/chat/attach/route.ts:18-24`; `SIGNUP_MODE` defaults to open (`lib/env.ts:14`) | Dedicated upload rate limit, early content-length reject, reuse `isSecretFile` |
| Medium | Sessions expire after a fixed 30 days | `lib/auth/session.ts:12,72` | Slide `expiresAt` when `lastSeenAt` updates, capped (for example 90 days from creation) |
| Low | Phone device tokens never expire, ignore disabled accounts | `lib/phone-server.ts:15-25` | Join users; idle expiry |
| Low | Phone link accepts `http://` server URLs | `PhoneLinkModule.kt:50-53` (blocked today by `usesCleartextTraffic: false`) | https only outside debug |
| Low | Report endpoint can flood the admin Telegram chat | `app/api/mobile/report/route.ts:21-40` | Per-user limit and dedupe |
| Low | IP-level verify limit (10 per 15 min) can lock out shared networks; request step reveals disabled accounts | `lib/auth/otp.ts:45-46,81` | Separate IP verify limit; decide on disclosure |
| Low | Picked documents stay in the app cache | `settings/documents.tsx:84` | Delete the copy after upload |
| Low | No idempotency keys on POST routes | quick add, memories, chat | Needed before any offline write queue |
| Info | Per-user isolation | Every reviewed query filters by `g.user.id`; no IDOR found | None |
| Info | Token handling | SecureStore, `allowBackup: false`, no logging, server stores hashes, logger redacts Bearer | None |

---

## 7. Performance and accessibility issues

### Performance

| Issue | Evidence | Note |
| --- | --- | --- |
| No persisted query cache | `src/lib/queries.ts:19-27` | Every cold start refetches; offline cold start shows errors everywhere |
| No refetch on foreground | No AppState in `src` except `settings/phone.tsx:64` | Home and badges go stale until pull to refresh |
| Unused native packages in the APK | `@expo/ui`, `expo-image`, `expo-linear-gradient` ship Android code (section 8) | Larger APK and longer builds |
| Synchronous document upload | `lib/knowledge/ingest.ts:31-68`, `maxDuration 120` | Long requests on mobile networks; no background status |
| Lists | Chat, tasks and memory screens | Not measured on a device; check long conversations for render cost |

### Accessibility

| Issue | Evidence |
| --- | --- |
| Strong baseline | 48dp `TOUCH` targets, labels, switch and radio roles, live regions, font scale cap 1.6, orb follows reduced motion (`components/orb.tsx:21-32`) |
| Sheet backdrop has a label but no role | `components/sheet.tsx` |
| Stack and Modal transitions ignore reduced motion | `_layout.tsx` `animation: "fade_from_bottom"` |
| Tab bar clipping on 3-button navigation | `(tabs)/_layout.tsx:23` |
| No light theme | Users who need a light background have no option |
| Haptic on every Button including Cancel | `components/ui.tsx:47-50`; consider limiting to primary actions |

---

## 8. Dead code and cleanup candidates

Nothing listed here has been removed. Verdicts: Delete (safe), Keep, Uncertain (owner decision).

### Web

| Path | Evidence | Verdict |
| --- | --- | --- |
| `components/layout/launch-intro.tsx` | No importers; no `.pa-intro` styles in `app/globals.css` | Delete (keep `components/layout/mark.tsx`, still used) |
| `components/layout/smooth-scroll.tsx` | Orphan; only `lenis` import (line 17) | Delete |
| `components/ui/count-up.tsx` | Orphan; also conflicts with the no-animated-metrics rule | Delete |
| `lenis` dependency (`package.json:57`) | Only used by smooth-scroll | Delete after the file; `data-lenis-prevent` attributes become harmless no-ops |
| 8 Radix packages: alert-dialog, label, popover, radio-group, select, separator, slider, tabs (`package.json:25,30-35,38`) | No imports outside package files | Delete |
| `simple-icons` (`package.json:70`) | Only `scripts/brands.mjs:6` | Keep, move to devDependencies |
| `public/brand/cowork-logo-120.png` | No references in history or source | Delete |
| 20 unused SVGs in `public/brands` | Not referenced by any logo id | Uncertain (tiny; remove with manifest entry and SLUG together if at all) |
| `android/phone-link`, `public/downloads/cowork-phone-link.apk` | Linked from `app/(app)/phone/page.tsx:11` | Keep until the Play Store app replaces it |
| `scripts/*` diagnostics | Imports still resolve. `verify-phone-link.mjs` runs against production | Keep |
| `gsap` | Used by `components/flow/link-panel.tsx`, `components/today/news-ribbon.tsx` | Keep |
| `types/` (root, empty) | No files, not in tsconfig | Delete |

### Mobile

| Path | Evidence | Verdict |
| --- | --- | --- |
| `@expo/ui`, `expo-image`, `expo-linear-gradient`, `expo-symbols`, `expo-glass-effect` (`apps/mobile/package.json`) | No imports in `src`, `modules`, `plugins` or `app.json`. Optional peers of expo-router only | Delete, then `expo prebuild --clean` |
| `react-native-web` and the `web` script | Android-only app | Uncertain (owner) |
| `react-dom`, `expo-system-ui`, `expo-constants`, `expo-linking`, `react-native-screens`, `react-native-worklets`, `expo-build-properties`, `expo-web-browser` | Required peers or plugins, or imported | Keep |
| `reset-project` script (`package.json:57`) and empty `apps/mobile/scripts/` | Points to a missing file | Delete |
| `apps/mobile/README.md` | create-expo-app boilerplate with an emoji and a broken instruction | Delete or replace with a pointer to `docs/mobile-app.md` |
| `apps/mobile/LICENSE` | Expo's template MIT licence | Uncertain (owner) |
| `assets/images/favicon.png`, `assets/images/android-icon-background.png` | Not referenced in `app.json` or source | Delete |
| `modules/phone-link/android/.gradle/`, `.../build/` | Untracked and not git-ignored | Delete locally and add to `apps/mobile/.gitignore` |
| `apps/mobile/android/` | Generated by prebuild, git-ignored | Delete when no build is running (never delete `apps/mobile/credentials/`) |

### Generated and untracked at repo root

| Path | Evidence | Verdict |
| --- | --- | --- |
| `.next-devtest` (966 MB), `.next-e2e` (983 MB), `tsconfig.tsbuildinfo`, `test-results/` | Git-ignored build and test output | Delete (regenerated) |
| `.pglite-dev`, `.pglite-e2e` | PGlite no longer used | Delete; fix the comment at `playwright.config.ts:7-8` |
| `.vscode/` | Personal editor config, untracked | Keep locally; add to `.gitignore` |
| `media/showreel` | Appeared during the audit; work in progress | Keep, do not touch |
| `apps/mobile/plugins/`, `docs/mobile-app.md`, `apps/mobile/store/listing.md`, `.gitignore` change | Required by the modified `app.json` or the only mobile docs | Keep and commit with the `app.json` and `package.json` changes |

### Docs and config to edit (not delete)

- `docs/design.md:53-61` describes count-ups, intro timelines and Lenis.
- `README.md:5` lists Lenis; README links only `docs/design.md`.
- `README.md:126` says dispatch runs every 5 minutes; `vercel.json` says daily.
- `docs/feature-audit.md:17` omits the Expo phone-link module.
- `pnpm-workspace.yaml` has unanswered `allowBuilds` placeholders for `@firebase/util` and `protobufjs`.

---

## 9. Build and test status before modifications

What the readers actually ran, and what was not run:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` in `apps/mobile` | Pass, exit 0, no diagnostics (TypeScript ~6.0.3, strict) |
| `npx tsc --noEmit` at the repo root | Fail: `components/chat/chat-view.tsx(34,28): error TS2307: Cannot find module './memory-line'` |
| `npm audit --json` in `apps/mobile` | 28 issues: 20 high, 8 moderate, 0 critical. Three root advisories: braces GHSA-vfj7-8cjw-p6xm, node-forge GHSA-86w9-cpqp-85rv, uuid GHSA-w5hq-g745-h8pq. All in build-time tooling (Metro, Expo CLI, config plugins), none in the APK. Do not run `npm audit fix --force` (it downgrades to Expo 44 and RN 0.72) |
| Web `next build` | Not run (audit was read-only). Expected to fail because of the missing module above |
| Web unit tests (`vitest run`) and e2e (`playwright test`) | Not run |
| Mobile lint (`expo lint`) | Not run |
| Native Android build (`expo run:android`, Gradle, release AAB) | Not run. Status unknown at audit time. Untracked Gradle output exists under `modules/phone-link/android/build/`, which suggests a build was attempted earlier, but its result is unknown |
| Push | Cannot work in any build until `google-services.json` and the google-services Gradle plugin are added (`docs/mobile-app.md:63`) |
| CI | None in the repo |

---

## 10. Recommended implementation sequence

Each step is small enough to ship and verify on its own. Server steps must deploy before the mobile steps that use them.

1. **Unblock the web build.** Commit `components/chat/memory-line.tsx` or remove the import, confirm root `tsc` and `next build` pass. Commit the untracked mobile plugin, docs and listing alongside the `app.json` change. Confirm how `/api/cron/dispatch` is scheduled in production.
2. **Session-end safety (mobile and server).** One `signOut` cleanup path for remote, local and expired cases: clear Phone link, push token, device id. Server: revoke phone devices and push rows with their session; reject disabled users for device tokens. Call `markExpired` on chat 401. Guard `restore()`.
3. **Deep link safety.** External `?prompt=` only prefills; `?voice=1` only from inside the app. Add a `+not-found` screen. Fix task modal Close and post-delete navigation.
4. **Truthful copy and error display.** Calendar error state from `/api/mobile/today`; notification copy; store listing and privacy wording; Phone link wording; map error codes to sentences.
5. **Quick layout fixes.** Tab bar height with insets; quick add ref guard; delete picked file copies; `resultMarkdown` through the Markdown renderer.
6. **Chat completeness.** Server: persist partial answer on Stop; conversation rename and delete routes (with proposal cleanup). Mobile: handle `memory`, `notice` and `done.model`; rename and delete with confirmation; edit and regenerate via `replaceFromMessageId`; document and code attachments via `/api/chat/attach`; syntax highlighting.
7. **Settings routes.** `GET/PATCH /api/mobile/settings` (agent settings incl. `autoMemory`, `searchWeb`, voice, preferences, quiet hours) with zod schemas shared with the web actions; extend `/api/mobile/me` profile fields; sessions list and revoke; AI provider read route. Mobile: profile, notification preferences, memory consent toggle, voice settings, active model, in-app export through the share sheet.
8. **Push end to end.** Firebase config, foreground handler, tap routing shared with `appRoute()`, cold start, `channel_id` on the server, per-item read route.
9. **Tasks and planner.** Extend task routes (remindAt, tags, status, done list, search, sort, subtasks). Agenda screen on `/api/schedule`; event ids on Home; meeting notes write routes and screen.
10. **Notes and bookmarks.** Write routes reusing `lib/notes/service.ts`; mobile list, editor, bookmark save.
11. **Documents.** Sources route to filter uploads, preview route, in-screen search, optional summaries.
12. **Global search.** `GET /api/mobile/search?q=` fanning out to conversations, tasks, notes, documents and memories, with typed deep links.
13. **Offline and freshness.** NetInfo `onlineManager`, AppState `focusManager`, persisted read cache, per-conversation drafts. Idempotency keys before any offline write queue.
14. **Light theme.** Hook-based tokens and a theme setting.
15. **Hardening.** OTP limits fail closed, preview test-mode guard, upload rate limit, account deletion revokes Google, report limit, Phone link package filtering.
16. **Cleanup.** Remove dead files and dependencies from section 8, then `expo prebuild --clean` and a release build.

Projects (spec I) and meeting prep (spec J) need a product decision first: there is no projects table and no prep feature on the web. The app should not show either until they are backed by real data.
