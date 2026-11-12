# Cowork

Personal AI assistant: a Next.js website and API, and an Expo Android app that uses the same API. Product name is **Cowork**. Never brand anything "Antropic" or anything resembling Anthropic (the domain antropic.me is only a domain).

V2 work runs in phases with approval between phases. Status, decisions and the roadmap: `docs/COWORK_V2_AUDIT.md`. Offline peer-to-peer (Connect): `docs/COWORK_CONNECT_FEASIBILITY.md`.

## Architecture

- **Backend**: Next.js 15 App Router on Vercel (`app/`, `lib/`). API routes in `app/api/**`; app-specific routes in `app/api/mobile/*`; web mutations as server actions in `app/actions/*`.
- **Database**: Postgres hosted on Supabase, reached through Drizzle + `postgres.js` as the owner role. Supabase Auth, Storage, Realtime and Edge Functions are **not** used (decision D1). Every query filters by `userId`; that is the isolation boundary.
- **Auth**: Cowork's own email-code sign-in (`lib/auth/*`). Web uses a session cookie; the app sends `Authorization: Bearer <session token>`.
- **AI**: only through `lib/ai/router.ts` (OpenAI-compatible providers, fallback, streaming, `ai_runs` usage rows). Chat pipeline `lib/agent/chat.ts`. Keys stay on the server.
- **Background work**: `jobs` table queue (`lib/jobs/*`), drained by `/api/cron/dispatch`.
- **Mobile** (`apps/mobile`): Expo SDK 58, React Native 0.88, Expo Router (`src/app` = screens), TanStack Query, Zustand, React Compiler. Read `apps/mobile/AGENTS.md` before touching Expo APIs. `android/` is generated (CNG): change native config through `app.json` and `plugins/*`, never by hand.

## Commands

```bash
pnpm dev                     # website + API on :3000
pnpm typecheck               # web; check tsc's own exit code, not a pipe's
pnpm test                    # vitest unit tests
pnpm lint
pnpm db:generate             # drizzle migration from lib/db/schema.ts
pnpm db:migrate              # applies to the DATABASE in .env.local, which is PRODUCTION: ask first
cd apps/mobile && npx tsc --noEmit
cd apps/mobile && .\run-android.ps1   # build, install on the USB phone, start Metro (one build at a time)
```

Deploys: push to `master`, Vercel builds production. `next build` typechecks, so a type error fails the deploy.

## Rules

- **Never show AI model or provider names** to users (UI, errors, notifications, exports). Use `lib/ai/messages.ts` for AI-unavailable copy.
- **Design**: tokens only. Web: CSS variables in `app/globals.css`. App: `apps/mobile/src/theme/tokens.ts` (`color` and `type` read the active scheme; never copy a colour into module scope). Warm ivory and charcoal, emerald primary, vermillion secondary. No purple, no decorative gradients, no pill buttons, no emoji, no em dashes in copy, no fake metrics or testimonials.
- **No mock data or placeholder features** in shipped code. A screen or button only ships when it does what it says.
- **Security**: validate input with zod; user-supplied URLs go through `safeFetch`; secrets never in the app or in responses; rate-limit public and AI routes (`lib/security/ratelimit.ts`).
- **Data**: Drizzle migrations only (`lib/db/migrations`); new tables get `ENABLE ROW LEVEL SECURITY` (blocks Supabase's public Data API; the owner role is unaffected).
- **Copy**: plain sentences; say what happened and what to do next.
- **Done means verified**: typecheck, lint and tests for what changed, and the feature checked on the phone or in the browser. Report anything not verified as not verified.
- Windows dev machine: paths under OneDrive are long; native builds rely on `plugins/with-short-native-paths.js`.
