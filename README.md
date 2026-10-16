# PA — personal assistant

A single-user command center: a daily **Today** dashboard, chat and voice with your agent, inbox triage with Gmail **drafts** (never sends), tasks and schedule, automations that actually run, a knowledge base the agent answers from with citations, LinkedIn drafting, and a remote **MCP server** so Claude can work on your tasks.

**Stack:** Next.js 15 (App Router) · React 19 · Tailwind v4 + shadcn-style components · Phosphor icons · Motion · GSAP · Lenis · Postgres + pgvector (Neon/Supabase) with Drizzle · Vercel AI SDK (OpenAI-compatible, open-weight models) · Upstash rate limiting · Vitest + Playwright · Vercel (serverless, Vercel Cron).

Design rules live in [`docs/design.md`](docs/design.md).

---

## Human in the loop (non-negotiable)

- No code path sends email, posts publicly, pays, or deletes on your behalf. Gmail access is `gmail.readonly` + `gmail.compose` (drafts). There is no send function in the codebase.
- The agent, voice and automations can only **propose** actions. Proposals appear as cards (Approve / Edit / Dismiss) and run only after you click Approve.
- Email, news, web pages and synced documents are **untrusted data**: they're wrapped in `<email_content>` / `<source_content>` tags, stripped of invisible characters, and the models that read them have **no tools**. They only return validated JSON or text.
- Claude's MCP tools are least-privilege and scoped, with no send or delete. Every call is logged.

---

## Setup

### 1. Install

```bash
pnpm install
cp .env.example .env.local
```

For local development you can skip a hosted database and use embedded Postgres by setting `DATABASE_URL=pglite:./.pglite-dev` in `.env.local`:

```bash
pnpm db:migrate
pnpm dev
```

With no `RESEND_API_KEY`, the sign-in code is printed in the dev server console.

### 2. Postgres with pgvector (Neon or Supabase)

**Neon**
1. Create a project at neon.tech, then copy both connection strings: the **pooled** one (host contains `-pooler`) → `DATABASE_URL`, and the **direct** one → `DATABASE_URL_UNPOOLED`.
2. pgvector is available on Neon. The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`.

**Supabase**
1. Create a project, then go to Database → Extensions and enable **vector**.
2. Settings → Database: the *Transaction pooler* URI (port 6543) → `DATABASE_URL`, and the *Direct connection* URI → `DATABASE_URL_UNPOOLED`.

Then run the migrations (uses the direct URL):

```bash
pnpm db:migrate
```

### 3. Sign-in email (Resend)

1. Create an account at resend.com, verify your sending domain, and create an API key → `RESEND_API_KEY`.
2. Set `MAIL_FROM="PA <login@your-domain.com>"` and `ALLOWED_EMAILS=you@example.com`.
3. `AUTH_SECRET=$(openssl rand -base64 48)`.

Codes are 6 digits from a CSPRNG and stored only as an HMAC bound to your email. They expire in 10 minutes, allow at most 5 attempts, are single use, and are rate limited per email and per IP. Responses never reveal whether an email is allowed.

### 4. Google Cloud (Gmail, Calendar, Drive)

1. console.cloud.google.com → create a project.
2. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API** and **Google Drive API**.
3. **OAuth consent screen**: External, add yourself as a test user. Add the scopes `gmail.readonly`, `gmail.compose`, `calendar.readonly` and `drive.readonly`.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URI: `https://YOUR-DOMAIN/api/integrations/google/callback` (add `http://localhost:3000/api/integrations/google/callback` for dev).
5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. `ENCRYPTION_KEY=$(openssl rand -base64 32)`. Google tokens are stored with AES-256-GCM.

Connect Google from **Integrations** (or during onboarding). Google is an integration, not your login.

### 5. Choose an open-weight model provider

Any OpenAI-compatible endpoint works:

| Provider | `AI_BASE_URL` | Example `FAST_MODEL` / `SMART_MODEL` |
|---|---|---|
| Together AI | `https://api.together.xyz/v1` | `meta-llama/Llama-3.1-8B-Instruct-Turbo` / `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` / `llama-3.3-70b-versatile` |
| Fireworks | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p1-8b-instruct` / `…llama-v3p3-70b-instruct` |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.1-8b-instruct` / `qwen/qwen-2.5-72b-instruct` |

- `EMBEDDING_MODEL` must return **1024 dimensions** (e.g. `BAAI/bge-large-en-v1.5` on Together). Without it, search falls back to Postgres full-text.
- `AI_FALLBACK_*` adds a second provider that's tried automatically when the first fails or times out. `OLLAMA_BASE_URL` is a third, local-dev-only option (ignored on Vercel).
- Structured output is zod-validated with up to 2 retries that feed the validation error back to the model. `ai_runs` logs which provider and model handled each task, never content.
- Test each provider from **Settings → Agent → Models**.

### 6. Upstash (rate limiting)

Create a Redis database at upstash.com and copy the REST URL and token into `UPSTASH_REDIS_REST_*`. Without it, each serverless instance falls back to an in-memory limiter (fine for dev, weak in production).

### 7. Optional services

- **Voice:** browser speech works out of the box. For browsers without SpeechRecognition, set `STT_BASE_URL` / `STT_API_KEY` / `STT_MODEL` (e.g. Groq `whisper-large-v3`). For open-source TTS, run Kokoro-FastAPI (or similar) and set `TTS_BASE_URL`, then pick a "server" voice in Settings → Agent. Recordings are capped at about 45s / 3MB to stay under Vercel's body limit.
- **News:** default RSS/Atom feeds (BBC, Guardian, Al Jazeera, The Verge, Ars Technica, Hacker News…). Override with `NEWS_FEEDS`, and add `NEWS_API_KEY` for NewsAPI.org. Only titles and one-line feed summaries are stored, with source attribution and a link out.
- **Telegram:** message @BotFather → `/newbot` → token into `TELEGRAM_BOT_TOKEN`. Send your bot a message, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, and copy `chat.id` into `TELEGRAM_CHAT_ID`. It's notifications only, to your own chat.
- **Notion / Slack / GitHub knowledge:** connect with read-only tokens on the Integrations page (instructions are in each panel).

### 8. Deploy to Vercel

1. Push the repo and import it in Vercel (framework: Next.js).
2. Add every variable from `.env.example` in Project → Settings → Environment Variables. Set `APP_URL` to your production domain.
3. Deploy. `next build` needs no secrets.
4. Run `pnpm db:migrate` locally against the production `DATABASE_URL_UNPOOLED` (or add it as a deploy step).
5. Crons in `vercel.json`, all protected by `CRON_SECRET`:
   - `/api/cron/dispatch` every 5 min: enqueues due work (inbox sync, briefing, news, idea suggestions, reminders, scheduled and calendar-triggered automations, knowledge sync) and drains the job queue in small batches.
   - `/api/cron/sync-email` every 15 min, `/api/cron/briefing` hourly (idempotent: one briefing per local day).
   - **Hobby plan:** Vercel Hobby only allows daily crons. Use Pro, or change the schedules to daily and use "Sync now" in Inbox.

### 9. Connect Claude

1. Open **Settings → Connect Claude** and copy the MCP URL: `https://YOUR-DOMAIN/api/mcp`.
2. In Claude: **Settings → Connectors → Add custom connector**. Name it "PA", paste the URL, and leave the OAuth fields empty.
3. Claude discovers PA's OAuth 2.1 server (`/.well-known/oauth-protected-resource` → `/.well-known/oauth-authorization-server`), registers dynamically (DCR, or a Client ID Metadata Document), and sends you to PA's consent screen. Approve the scopes you want.
4. For clients that send headers (Claude Code, scripts), create a token on the same page and send `Authorization: Bearer <token>`.

Tools: `list_tasks`, `get_task`, `create_task`, `claim_task`, `complete_task`, `get_daily_briefing`, `list_important_emails`, `search_memory`, `save_note`, `search_knowledge`. There is no send or delete tool. Results submitted with `complete_task` land in **Needs review**, where you Approve (→ Done) or Request changes (→ To do; your comment is visible to Claude via `get_task`).

Security: PKCE S256 only. Redirect URIs are allowlisted to Claude's hosts (`MCP_OAUTH_ALLOWED_REDIRECT_HOSTS`). Access tokens last 1h and refresh tokens rotate. Every token is stored hashed and checked on every request, and the endpoint is rate limited per token.

---

## Development

```bash
pnpm dev          # local server
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
pnpm test         # Vitest unit tests
pnpm build        # production build
pnpm test:e2e     # Playwright smoke (run `pnpm build` first)
```

The Playwright smoke flow starts `next start` on a fresh embedded PGlite database with `OTP_TEST_MODE=true` (fixed code `424242`) and points the AI router at a deterministic, test-mode-only mock endpoint (`/api/dev/mock-ai/v1`, which returns 404 otherwise). To reuse an installed browser instead of downloading Playwright's Chromium: `PW_CHANNEL=msedge pnpm test:e2e`.

### Layout

```
app/(app)/       Today, chat, inbox, tasks, automations, knowledge, content, integrations, settings
app/api/         chat (NDJSON stream), mcp, oauth, cron, voice, knowledge, tokens, export, health…
app/actions/     server actions (zod-validated, owner-only, rate limited)
components/      ui (tokens), layout (shell), chat, voice, tasks, automations, knowledge, integrations, settings
lib/ai/          router (fallback + streaming), providers, structured output, prompts/*.md
lib/agent/       planner, read-only context gathering, chat orchestration, approval queue
lib/agents/      email classifier/drafter, daily briefing
lib/automations/ engine, triggers/conditions, schedules, templates, validation
lib/knowledge/   ingest (clean → chunk → embed), hybrid search (FTS + pgvector, RRF), adapters
lib/jobs/        queue (FOR UPDATE SKIP LOCKED), handlers, dispatcher
lib/mcp/         MCP server + tools, OAuth 2.1 server
lib/security/    crypto, tokens, scopes, sanitize, rate limit, cron auth
lib/trace.ts     run tracing (trace_spans) shared by chat, voice, automations, MCP, jobs
```

---

## Verification checklist

**Auth & security**
- [ ] `/` redirects to `/login` when signed out. A non-allowlisted email gets the same "If that email can sign in…" message, and no code works for it.
- [ ] Code arrives by email. A wrong code 5× invalidates it. A used code can't be reused. "Resend" unlocks after 30s.
- [ ] Settings → Account lists sessions. Revoking one works, and "Sign out everywhere" ends all of them.
- [ ] Response headers include CSP with a nonce, HSTS, `X-Frame-Options: DENY`, `nosniff`. API responses have `default-src 'none'`.
- [ ] `/api/cron/*` returns 401 without `Authorization: Bearer $CRON_SECRET`. `/api/mcp` returns 401 with a `WWW-Authenticate … resource_metadata` header.
- [ ] Logs contain no email bodies, tokens or keys (grep the Vercel logs for `pa_`, `ya29.`, `Bearer`).

**Today**
- [ ] News ribbon scrolls in two opposite rows on wide screens. It pauses on hover/focus and the Pause button, drag scrubs it, and clicking a card opens the drawer with summary, source link, "Ask agent" and "Turn into LinkedIn idea".
- [ ] With OS "reduce motion" (or Settings → Appearance), the ribbon is a static scrollable list and smooth scrolling is off.
- [ ] Mail, schedule, tasks, ideas, agent and integrations cards each show a skeleton, then data or a helpful empty/error state.
- [ ] "Draft reply" creates a Gmail **draft** (check Gmail Drafts). Nothing is sent.

**Chat & voice**
- [ ] Answers stream. "Used: …" chips expand. Citations link to sources, and "General knowledge" is labeled when the KB lacks the answer.
- [ ] Copy, Regenerate, Edit-and-resend, attach a PDF/DOCX/TXT, search conversations, ⌘J opens the panel from any page.
- [ ] "Add a task to call Ravi tomorrow at 5" shows an approval card. Nothing happens until Approve, and then the task appears at 17:00 tomorrow.
- [ ] Voice: push-to-talk and hands-free work. A "Mic on" indicator shows while recording. The answer is spoken briefly with full text on screen. Action intents ask for a spoken and on-screen "yes". Tapping the orb stops speech.

**Tasks & schedule**
- [ ] Quick add understands "every Monday 9am review inbox", "#tags" and "!high". The list, board (drag and drop, including keyboard Space/arrows) and drawer (subtasks, comments, Claude results with Approve / Request changes) all work.
- [ ] Schedule shows day/week/month with Google events (read-only). Dragging a task reschedules it. Dashed focus suggestions only create a task when you click Add.

**Automations**
- [ ] Create from each template. **Dry run** logs "Would: …" steps with no side effects. **Test run** executes and shows step outputs.
- [ ] Unchecked permissions skip that action with a clear message. "Pause all" stops scheduled runs.
- [ ] A failing action retries with backoff, then lands in "Needs attention" with a human message and a notification. "Re-run" works.
- [ ] Webhook trigger: POST with `x-pa-webhook-secret` runs once per `x-idempotency-key`.

**Knowledge**
- [ ] Upload a PDF and add pasted text and a URL. Items appear and chat cites them.
- [ ] Connect Drive (folder IDs), Notion, Slack or GitHub. Sync now works, counts and last-sync update, the include toggle removes a source from answers, and "Delete data" clears its items.
- [ ] Claude's `search_knowledge` returns excerpts with links.

**Integrations & settings**
- [ ] Logos appear in original colors. Hover lift, staggered entrance and the connect check animation play. Errors shake once.
- [ ] Token connect validates against the provider before saving. Disconnect forgets the tokens (and revokes the Google grant).
- [ ] Agent settings change the live preview. Capabilities switch off the matching sources/actions. Memory items can be added, edited and forgotten.
- [ ] Export JSON/Markdown downloads with no tokens or hashes. "Where my data goes" matches your configured providers.

**Claude**
- [ ] Adding the connector in Claude opens PA's consent screen. After Allow, "List my PA tasks" works.
- [ ] `claim_task` shows "In progress by Claude". `complete_task` moves the task to Needs review, and Approve / Request changes behave as described.
- [ ] Every call appears in the Connect Claude activity feed, and revoking the credential stops access immediately.

**Build & tests**
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` all pass.

---

## Known gaps and next steps

- **Live Link panel** (queued next): it will read `trace_spans`, which chat, voice, automations, MCP calls and knowledge syncs already write. It needs `/api/flow/events` and `/api/flow/status`, plus a Flow page. Neither exists yet.
- Asana, Linear, HubSpot, Stripe, Zoom, YouTube, Canva, Figma and LinkedIn publishing are listed as "coming soon" (no fake connections). LinkedIn uses copy + open, with no automation.
- Model choice is environment-driven (keys never live in the database). The Agent page shows the configuration and tests it but doesn't edit it.
- Slack and LinkedIn logos aren't in Simple Icons, so they show a neutral monogram until official assets are added to `/public/brands` per each brand's guidelines.
- Dark mode is token-ready (redefine variables under `[data-theme="dark"]`) but not designed yet.
- Lighthouse wasn't run in this environment. The checklist above includes the a11y behaviors to verify by hand.
