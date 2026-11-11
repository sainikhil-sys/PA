# Cowork for Android

The Android app is an Expo (React Native) client of the existing Cowork backend. It adds no database, auth provider or AI gateway: it signs in with the same email codes, reads and writes the same Postgres data through the same Next.js API routes, and gets real AI answers from the same chat pipeline.

## Where things are

| Path | What |
|---|---|
| `apps/mobile` | The Expo app (SDK 58, React Native 0.88, Expo Router). Own `package-lock.json`; not part of the web build (excluded in `tsconfig.json`, ESLint and `.vercelignore`). |
| `apps/mobile/src/app` | Screens. `(auth)` sign-in, `onboarding/*`, `(tabs)` Home, Assistant, Tasks, Settings, plus `chat/[id]`, `task/[id]`, `notes/*`, `agenda`, `meeting/[id]`, `search`, `approvals`, `notifications`, `settings/*`. |
| `apps/mobile/src/lib` | API client (bearer token), chat stream (`expo/fetch` + NDJSON), TanStack Query hooks, session store (SecureStore), push registration. |
| `apps/mobile/modules/phone-link` | Local Expo module (Kotlin): the notification listener that forwards calls and messages to `/api/phone/events`. Port of `android/phone-link`. |
| `apps/mobile/plugins/with-release-signing.js` | Signs release builds with `credentials/upload.jks` when present. |
| `apps/mobile/store` | Play listing text, data safety answers, icon and feature graphic. |
| `app/api/mobile/*` | Endpoints added for the app (below). |

## Backend changes for the app

All additive. No migrations were needed for the app itself.

- `lib/auth/session.ts`: the session lookup also accepts `Authorization: Bearer <session token>` (cookies stay first). `createSession({ cookie: false })` returns the token instead of setting a cookie.
- `lib/auth/otp.ts`: `verifyOtp(..., { cookie: false })` returns the session token; browser sign-ins never see it.
- New routes under `app/api/mobile/`:
  - `auth/request` and `auth/verify`: email code sign-in, returns `{token, isNew}`
  - `auth/sign-out`
  - `me`: GET; PATCH name, time zone, onboarded; DELETE account
  - `today`: one aggregated request for the Home screen
  - `approvals` and `approvals/[id]`: approve or dismiss proposals
  - `tasks` and `tasks/[id]`: list, quick add, edit, complete, cancel
  - `memories` and `memories/[id]`
  - `documents/[id]`: delete
  - `notifications/read`
  - `integrations`: read-only status
  - `phone`: link this phone without a pairing code, list, unlink (unlink also deletes that phone's events)
  - `push`: register or remove the phone's FCM token as an `fcmapp:` endpoint
  - `report`: report an AI response, as Play's generative-AI policy requires
  - `notes`, `notes/[id]`, `notes/bookmark`, `notes/[id]/refresh`: write, edit, pin and delete notes, save links
  - `meetings` (PUT, DELETE) and `meetings/summarize`: meeting notes and their summary
  - `search`: one keyword search over chats, tasks, notes, documents and memories
- Reused: `/api/chat` (streaming; Stop saves the partial answer), `/api/chat/conversations` (now also PATCH rename and DELETE), `/api/chat/suggestions`, `/api/knowledge/items` (`?type=upload` for Documents), `/api/knowledge/upload`, `/api/notes`, `/api/notes/[id]`, `/api/schedule`, `/api/meetings`, `/api/notifications`, `/api/activity`, `/api/phone/events`.
- Public page `/delete-account` (Play's account deletion requirement); the privacy policy covers the app.
- The cron dispatcher now prunes phone events older than 3 days for every account.

## Build

Requirements: Node 22, JDK 21 (Android Studio's JBR), Android SDK with platform 36. The first build downloads the NDK.

```bash
cd apps/mobile
npx expo prebuild -p android
cd android
./gradlew assembleDebug      # debug APK: app/build/outputs/apk/debug/
./gradlew bundleRelease      # Play bundle: app/build/outputs/bundle/release/app-release.aab
```

Set `JAVA_HOME` to Android Studio's `jbr` folder first.

Release signing uses `apps/mobile/credentials/upload.jks` and `credentials/keystore.properties` (git-ignored). **Back both up somewhere safe, such as a password manager.** With Play App Signing, a lost upload key can be reset through Play support, but it takes days.

## External setup still needed

| Item | Why | Who |
|---|---|---|
| Google Play Console developer account ($25, identity verification) | Required to publish | You |
| Closed test with at least 12 testers for 14 days | Required for new personal developer accounts before production access | You |
| Firebase Android app for `me.antropic.cowork` and its `google-services.json` | Native push notifications. Until then the app says notifications aren't set up, and nothing is faked. | You add the app in Firebase console (project antropic-ee09e) and send me the file |
| Reviewer access | Play reviewers can't receive email codes. Options: a demo account with a fixed review code (env-gated, one address only), or let reviewers request a code at an inbox you monitor. | Your decision |
| Developer name on Play | Use your name or "Cowork". Avoid "Antropic": Play may treat a name close to a well-known company as impersonation. | You |

## Known limits

- Voice input uses the phone's speech recognition service (Google on most Android phones). There is no continuous or background listening.
- Connecting integrations (Google, LinkedIn and others) happens on the website. The app shows their status and links there.
- Notifications that link to web-only pages (inbox, automations, content) open the Notifications list in the app.
- Search matches words in titles and text; it is not semantic search.
