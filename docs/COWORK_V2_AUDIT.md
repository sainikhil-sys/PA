# Cowork V2: Phase 0 technical audit

Date: 2026-11-12. Commit: `3eac0c9` (master). Read-only: no application file was changed for this audit.

This builds on `docs/MOBILE_APPLICATION_AUDIT.md` (2026-10-21) and `docs/mobile-app.md`. Where those are now out of date, this document wins.

---

## 0. Decisions needed before Phase 1

The V2 brief assumes several things that are not true of this codebase. Each changes the plan, so they need your call first.

| # | Brief says | Reality | Options |
|---|---|---|---|
| D1 | "Retain Supabase as the primary backend": Auth, RLS, Storage, Realtime, Edge Functions | Supabase only **hosts Postgres**. The server (Next.js on Vercel) connects to it as the owner role through Drizzle and `postgres.js`. Auth is Cowork's own email-code sign-in. There is no supabase-js, no Supabase Storage, Realtime or Edge Functions. RLS is enabled on 8 tables with **zero policies** (it has no effect for the owner role). Isolation is enforced in server code (`where user_id = …`) on every query | **(a) Keep the current architecture** (recommended): Next.js API is the backend, Postgres on Supabase, add RLS policies only as defence in depth. **(b) Migrate to Supabase Auth/RLS/Realtime**: a rewrite of auth, sessions, every route and the web app; contradicts "do not rebuild" and "preserve existing authentication" |
| D2 | Light theme, warm ivory, emerald primary, vermillion secondary | App is dark-only (`userInterfaceStyle: "dark"`), near-black with an orange accent; the website and marketing share the orange identity | Confirm the new palette applies to **mobile only** or to **web too** |
| D3 | 5 tabs: Home, Chat, Create, Workspace, Profile | 4 tabs: Home, Assistant, Tasks, Settings, plus pushed screens (Notes, Next 7 days, Search, Approvals, Notifications) | Confirm where Tasks, Notes, Agenda, Documents and Approvals live (proposed: Workspace holds Tasks, Notes, Agenda, Documents; Create holds agents and automations) |
| D4 | Modes "Cowork Auto, Quick, Deep Think, Research, Creative" | Two internal tiers only (`fast`, `smart`), chosen per call site; web search exists (Tavily) | Confirm the five modes; "Research" needs web search configured in production (`TAVILY_API_KEY` is not set today) |
| D5 | "Agent system: create agents, tools, multi-step" | No tool calling anywhere; "agents" today are internal pipelines plus single-shot external BYO-key completions | Phase 7 is net-new server work (schema, tool loop, worker). Needs a reliable background worker (see W6) |
| D6 | Image uploads and vision | The AI layer is OpenAI-compatible text only; the server rejects images (415) | Needs a vision-capable model configured; confirm it is acceptable to require one |

---

## 1. Current architecture

```
Android app (Expo SDK 58, RN 0.88.1, Expo Router)      Website (Next.js 15, App Router)
        |  Bearer session token                                |  session cookie
        +---------------------> Next.js API on Vercel <--------+
                                   |   app/api/**, server actions
                                   |   lib/agent (chat pipeline, planner, proposals)
                                   |   lib/ai (router: providers, fallback, streaming)
                                   |   lib/jobs (queue), cron routes
                                   v
                     Postgres on Supabase (owner role, pooler)
                     47 tables, pgvector (1024 dims), 12 migrations
```

- **Mobile** (`apps/mobile`): Expo Router screens in `src/app`, feature code in `src/features`, API client and query hooks in `src/lib`, one local Expo module (`modules/phone-link`, Kotlin notification listener). Session token in SecureStore. TanStack Query for server state, Zustand for the session. React Compiler on.
- **Server**: all business logic. Mobile-specific routes under `app/api/mobile/*`; shared routes (`/api/chat`, `/api/notes`, `/api/schedule`, `/api/meetings`, `/api/knowledge/*`) accept the Bearer token.
- **AI**: every call goes through `lib/ai/router.ts`, with OpenAI-compatible providers (primary, fallback, optional local), the user's own key tried first, `maxRetries: 1`, fallback before first token on streams, an `ai_runs` row per call (tokens, duration, provider, model).
- **Background work**: a `jobs` table with `FOR UPDATE SKIP LOCKED`, dedupe and backoff, drained by `/api/cron/dispatch`. Vercel runs the three crons **once a day** each.

## 2. Feature inventory (mobile)

Working end to end against production (verified on a CPH2763 phone on 2026-11-12 for launch, sign-in state and tabs; screens marked * were built in this cycle and are typechecked but not yet tapped through on a device):

| Area | Screens | Status |
|---|---|---|
| Sign-in | Welcome, email, code | Working |
| Onboarding | Profile, Privacy, Permissions, First chat | Working |
| Home | Briefing, today's schedule (tappable to meeting notes*), top tasks, important mail, approvals count, voice orb, Search*, Notes*, Next 7 days* | Working |
| Assistant | Conversation list and search; chat with streaming, sources, proposal cards, Stop (partial answer saved), Retry, Ask again*, edit a sent message*, rename and delete*, memory and notice lines*, voice input, read replies aloud, Report | Working |
| Tasks | Quick add in plain words, grouped list, task detail editor, complete, delete | Working |
| Notes* | List, search, filter, editor, pin, delete, save a link | Built |
| Next 7 days* / Meeting notes* | Agenda; notes, summary, action items as approvals | Built |
| Search* | Chats, tasks, notes, documents, memories | Built |
| Approvals, Notifications | Approve or dismiss; list, mark read, open target | Working |
| Settings | Memory (CRUD), Documents (upload, delete), Connected services (read-only), Phone link, Activity, Delete account, Sign out | Working |
| Push | Registration, tap routing, foreground banners | Code complete; **not set up** (no `google-services.json`) |

## 3. Broken or incomplete

| # | Problem | Evidence |
|---|---|---|
| B1 | **Model names reach users** (violates the V2 branding rule). Added to mobile chat in this cycle | `apps/mobile/src/features/chat/components.tsx:261`; stream `done.model` `lib/agent/chat.ts:240`; `messages.meta.model`; web Settings shows "Fast: x · Smart: y" (`components/settings/ai-key-section.tsx:46`); agents board `components/agents/agents-board.tsx:94`; agent results "**ChatGPT** (gpt-4.1)" `lib/agents/run-task.ts:54`; export includes `model` |
| B2 | Error copy points to "Settings > Agent", which the app does not have | `lib/agent/chat.ts:196`, `app/api/mobile/meetings/summarize/route.ts`, `app/actions/{briefing,content,meetings}.ts`, `lib/agent/memory.ts:69` |
| B3 | Memory consent switch and web-search switch cannot be changed by anyone | `app/actions/settings.ts:45-52` zod schema omits `autoMemory`, `searchWeb` |
| B4 | Reminders and dispatch run once a day; code and README assume every 5 minutes | `vercel.json` (3 daily crons), `lib/jobs/scheduler.ts:96`, `README.md:126` |
| B5 | Manual memory adds skip dedupe, the 300 cap and the secret check | `app/actions/settings.ts:104`, `app/api/mobile/memories/route.ts:28` |
| B6 | Push notifications not configured | Missing Firebase Android app and `google-services.json` |
| B7 | `MessageMeta.steps` defined but never written; the step timeline is always empty | `lib/db/schema.ts:809`, `lib/agent/chat.ts` |

## 4. UI and UX weaknesses (mobile)

- Single dark palette in `theme/tokens.ts` (static object, not a hook): no light theme, no accent choice, no reduced-motion handling.
- Animation is nearly absent: Reanimated is used only by the voice orb; no list item, sheet or tab transitions; haptics in 2 files.
- Installed but unused: `expo-glass-effect`, `@expo/ui`, `expo-symbols`, `expo-image`, `expo-linear-gradient`, `expo-sharing`, `@react-native-community/netinfo`, `@tanstack/query-async-storage-persister`.
- Not installed (brief wants them): `expo-blur`, `@shopify/flash-list`, `moti`, `lottie-react-native`.
- No personalization screen; Settings has no route to read or change agent name, tone, instructions, language, response length, voice, quiet hours or notification kinds.
- No offline handling (no NetInfo, no persisted cache, no drafts).
- Code blocks have no syntax colours; no attachments or images in chat.

## 5. AI integration weaknesses

- **Routing**: two tiers hard-coded per call site; no task classifier, capability registry, cost or latency policy. The fast "planner" chooses data sources and actions, with a regex fallback.
- **User key fallthrough**: a failing personal key silently falls back to the server key.
- **No tool calling or agent loop**: structured output is prompt-and-parse with zod retry; the model cannot call tools or iterate.
- **Two BYO-key systems** with overlapping presets (`lib/agents/connectors.ts`, `lib/ai/presets.ts`); external agent runs bypass the router and its usage logging (`lib/agents/run-task.ts:48`).
- **Usage**: tokens per call recorded, **no cost**, no per-user budget; visible only in the admin console.
- **No vision**, no image input.

## 6. Memory weaknesses

- `memories` has **no embedding column**; retrieval is keyword IDF over at most 300 rows, top 10 plus 5 newest (`lib/agent/memory.ts:110`). Notes and knowledge chunks do have pgvector (HNSW) indexes.
- Flat text in 4 kinds; no confidence, provenance score or recency decay.
- List sizes differ: web shows 100, mobile 200, retrieval reads 300.

## 7. Backend weaknesses

- Background reliability depends on daily crons (B4); no worker for long agent runs.
- No retention or pruning for `ai_runs`, `trace_spans`, `jobs`, `activity_log`, `otp_codes`.
- No settings API for mobile (only `/api/mobile/me` for name and time zone).
- 47 tables; several feature areas (expenses, learning, sprints, ideas, content drafts, broadcasts) are web-only.

## 8. Performance bottlenecks (mobile)

- Chat streaming calls `setItems` with a full-array map **per token** (`use-chat.ts:136`); long chats re-render every row per delta. Needs a separate streaming item or batching (every ~50 ms).
- Chat is an inverted `FlatList`; no `getItemLayout`, no memoized rows (React Compiler helps but `renderItem` closures still change per token).
- Startup: four font files and session restore gate the splash; no persisted query cache, so Home always waits on the network.
- First Metro bundle on this PC took 90 to 170 s (5,300 modules); not a device issue, but slows development.

## 9. Security concerns

| Severity | Issue | Evidence |
|---|---|---|
| High | Rate limits are effectively off: Upstash env vars are empty in production, so limits fall back to per-instance memory; Redis errors fail open | `lib/security/ratelimit.ts:33-38,82-85`; production env `UPSTASH_*` empty |
| High | Automation `call_webhook` uses plain `fetch` (https check only), not `safeFetch`: SSRF to internal addresses | `lib/automations/engine.ts:132-140`, `validate.ts:26` |
| Medium | Data export includes `user_settings` rows with the encrypted AI key and note embeddings | `app/api/export/route.ts:34,39` |
| Medium | Isolation relies only on application `user_id` filters; RLS enabled on 8 tables with no policies, owner role bypasses it anyway | migrations `0010`, `0011` |
| Medium | Sign-up defaults to open | `lib/env.ts:14` |
| Low | No encryption key versioning for stored tokens | `lib/security/crypto.ts` |
| Low | Vercel Authentication protects deployments; fine for production domain, but preview testing needs a bypass | Project settings |

## 10. Dependencies

**Retain**: expo-router, @tanstack/react-query, zustand, react-hook-form + zod, react-native-reanimated, react-native-gesture-handler, expo-secure-store, expo-notifications, expo-speech-recognition, phosphor-react-native, expo-haptics; server: drizzle-orm, postgres, ai + @ai-sdk/openai-compatible, zod.

**Start using (already installed)**: expo-image (avatars, link previews), @react-native-community/netinfo + query persister (offline), expo-glass-effect (iOS glass; Android falls back), expo-sharing (export).

**Add only when the phase needs it**: expo-blur (Phase 3, nav bar), @shopify/flash-list (Phase 4, chat and long lists). Moti and Lottie are not needed: Reanimated covers the brief's animations.

**Remove after confirming unused**: `@expo/ui`, `expo-symbols`, `expo-linear-gradient` (no imports; `expo-glass-effect` decided in Phase 3).

## 11. Files to refactor

- `apps/mobile/src/theme/tokens.ts` → hook-based theme (`useTheme`) with light, dark, accent.
- `apps/mobile/src/app/(tabs)/_layout.tsx` → custom tab bar component (glass), 5 destinations.
- `apps/mobile/src/features/chat/use-chat.ts` and `components.tsx` → streaming state outside the list; memoized rows; drop model display.
- `lib/ai/router.ts`, `providers.ts` → capability registry, mode → tier mapping, cost table, user-key failure surfaced.
- `lib/agent/memory.ts` + schema → `memories.embedding` with HNSW index; hybrid retrieval.
- `app/actions/settings.ts` → shared zod schemas reused by a new `/api/mobile/settings`.
- `lib/agents/run-task.ts` → through the router; no provider names in output.

## 12. Safe to remove (after the owning phase, each with a check)

| Item | Why | Check before removing |
|---|---|---|
| `AI_MOCK` in `lib/env.ts:44` | Never read | grep |
| Mock AI `"intent"` branch in `app/api/dev/mock-ai` | Classifier it served was removed | e2e still passes |
| Duplicate "ping provider" code (`router.ts:186`, `actions/ai-key.ts:31`, `actions/agents.ts:28`) | Same logic three times | Replace with one helper |
| Root `android/phone-link` | Superseded by `apps/mobile/modules/phone-link` | Confirm no one installs the old APK |
| Unused mobile deps listed in section 10 | No imports | `expo-doctor`, build |

## 13. Recommended sequence (maps to the brief's phases)

1. **Phase 1, stabilize V1**: remove model and provider names everywhere (B1, B2); fix consent switches (B3); route manual memory adds through `saveMemory` (B5); 5-minute dispatch via Supabase `pg_cron` or an external scheduler (B4); Upstash for rate limits; `safeFetch` for webhooks; trim the export. Tap through every V1 screen on the phone.
2. **Phase 2, design system**: theme hook, tokens (colour, type, spacing, radius, elevation, motion), light and dark, accent; restyle shared components first, then screens.
3. **Phase 3, personalization and glass nav**: `/api/mobile/settings` (shared schemas with web); Personalization screens; custom tab bar (expo-blur on iOS and capable Android, solid fallback).
4. **Phase 4, chat**: streaming performance, syntax highlighting, attachments (`/api/chat/attach`), images (after D6), conversation organization.
5. **Phase 5, orchestration**: modes → capability registry → router; cost table and per-user budgets; no names leave the server.
6. **Phase 6, memory**: embeddings on memories, hybrid retrieval, privacy controls.
7. **Phase 7, agents**: `agents`, `agent_runs`, `agent_steps` tables; tool registry with permissions; job-backed runs with approvals.
8. **Phases 8 to 10**: integrations UI, performance pass on device, security and regression tests, release build.

Tests today: 21 Vitest files (about 220 cases) and 1 Playwright smoke file on the server; **none on mobile**. Each phase should add tests for what it touches.
