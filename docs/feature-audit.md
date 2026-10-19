# Cowork feature audit

Audit of the existing codebase against the requested feature list. Each feature was traced from its UI through server code to the database by reading the code; "Working" means a real end-to-end path exists with no mocks. Live verification results are recorded per feature where they were run.

Status key: **Working** · **Partial** (pieces exist, gaps listed) · **Broken** · **Missing** · **Blocked** (needs credentials or native access a web app doesn't have).

Last updated: 2026-10-19. "Changes" columns are filled in as work lands; (A), (B)… refer to batches in the implementation log.

## Architecture (for context)

- Next.js 15 App Router on Vercel (syd1); React 19; Tailwind v4 design tokens.
- Supabase Postgres via Drizzle ORM (`lib/db/schema.ts`, migrations in `lib/db/migrations`), pgvector.
- Auth: email one-time codes + DB sessions (`lib/auth`). Admin role via `ADMIN_EMAILS`.
- AI: OpenAI-compatible router with fast/smart tiers and fallback (`lib/ai/router.ts`), per-user own keys (`lib/ai/user-provider.ts`). Server provider: Groq.
- Jobs: Postgres queue with SKIP LOCKED, dedupe, backoff (`lib/jobs`), triggered every 5 min by Supabase `pg_cron` → `/api/cron/*`.
- Integrations: Google (Gmail/Calendar/Drive), token and OAuth providers (`lib/integrations`), MCP server for Claude (`lib/mcp`).
- Phone link: Android companion app (`android/phone-link`) → `/api/phone/*`.

## AI and intelligence

| Feature | Status | Evidence | Gaps / notes | Changes |
|---|---|---|---|---|
| Smart chat + streaming | Working | `components/chat/use-chat.ts` (NDJSON stream) → `app/api/chat/route.ts` → `lib/agent/chat.ts` | Only last 10 messages as history; model errors were stored as assistant messages (bug) | Fixed (A): failed model turns are flagged `meta.error` and kept out of history |
| Persistent personal memory | Partial | Read: `lib/agent/chat.ts` (30 rows into prompt). Write: manual only (Settings → Agent) | No automatic "remember this"; no ordering/relevance; three separate stores (`memories`, `notes`, knowledge "Notes") | (A) memories reach the prompt newest-first |
| Conversation search | Partial | `app/api/chat/conversations/route.ts` → `lib/agent/chat.ts` | JS substring match over newest 100 chats / 500 messages only | (C) Searches all history in SQL (titles and message text) |
| Voice conversations | Working (browser) | `components/voice/voice-overlay.tsx`, `app/api/voice/*` | Server STT/TTS blocked: `STT_BASE_URL`/`TTS_BASE_URL` unset → no voice input in Firefox | |
| Multiple AI providers | Working | `lib/ai/providers.ts`, `lib/ai/presets.ts`, `lib/ai/user-provider.ts`, `lib/agents/connectors.ts` | Embeddings ignore the user's own key | |
| Automatic model routing | Partial | Fixed tiers per task + provider fallback (`lib/ai/router.ts`) | No complexity/cost-based routing | |
| Context-aware suggestions | Partial | `lib/agent/suggestions.ts`, Today `AgentCard` | Rule-based; "nudge" and "proactive" behave the same | |
| Web research with citations | Missing → Blocked | No web search anywhere | Needs a search API key (e.g. Tavily/Brave). Code can be built; live use blocked until a key is set | |
| Document intelligence | Partial | Chat attachments + knowledge upload (`lib/knowledge/extract.ts`, `ingest.ts`, `search.ts`) | Attachment text not kept for follow-ups; no OCR; keyword-only search (`EMBEDDING_MODEL` unset; Groq has no embeddings) | |
| Project-specific knowledge | Missing | No project/collection entity | Search supports `sourceTypes` but nothing passes it | |

## Productivity

| Feature | Status | Evidence | Gaps / notes | Changes |
|---|---|---|---|---|
| Daily planner | Partial | `components/tasks/schedule-view.tsx`, `app/api/schedule/route.ts`, `lib/agents/briefingAgent.ts` | **Briefing is generated but never shown on the web**; no "plan my day"; task duration can't be set | (B) Briefing card on Today: headline, priorities, meetings, mail, deadlines; Build / Refresh runs the briefing agent now |
| Meeting assistant | Partial | Prep button + calendar context; meeting templates | Nothing after meetings (notes, summary, action items) | |
| Google Calendar | Working (read-only) | `lib/integrations/calendar.ts` | No write; primary calendar only; 50-event cap without paging | |
| Reminders + notifications | Partial | `deliverReminders` → `notify` → in-app, web push, FCM, email, Telegram | No UI to set a reminder time; **reschedule doesn't move the reminder** (bug) | Fixed (A): rescheduling moves the reminder and re-arms it |
| Tasks + project management | Partial | List/board/drawer, subtasks, comments, sprints, agent hand-off | No projects; no tag filter; **recurring tasks end when completed via board or approval** (bug) | Fixed (A): completing a recurring task from list, board or approval spawns the next occurrence |
| Notes + bookmarks | Partial | `notes` table (MCP only); knowledge "Add URL" | No notes UI; no bookmarks | |
| Focus mode | Partial | `FocusCard` (client timer) | No saved sessions/history, no link to a task, no do-not-disturb | |
| Scheduled background jobs | Working | `lib/jobs/*`, pg_cron every 5 min (verified: HTTP 200 runs) | **Stale-job recovery ignores max attempts** (bug); succeeded jobs never pruned | Fixed (A): stale jobs past max attempts are marked failed instead of retried forever |

## Voice and desktop

| Feature | Status | Evidence | Gaps / notes | Changes |
|---|---|---|---|---|
| Hands-free mode | Partial | Voice overlay "Hands-free" toggle | No wake word; **a silent turn ends the loop** (bug) | Fixed (A): listening restarts after a silent turn |
| Desktop commands | Blocked | — | A website can't run commands on your computer. Needs a native helper app with an allowlist | |
| Screen understanding | Missing | — | Possible in-browser with screen-share permission + a vision model; no vision model configured | |
| Clipboard assistant | Missing | Only copy buttons | Paste-and-transform is feasible in the browser | |

## Developer tools

| Feature | Status | Evidence | Gaps / notes | Changes |
|---|---|---|---|---|
| Coding assistant | Partial | Chat allows coding; markdown code blocks | No syntax highlight, no per-block copy; **citation stripper corrupts code like `arr[1]`** (bug); code files rejected as attachments | Fixed (A): citation stripping and citation links skip inline and fenced code |
| Project context / architecture memory | Missing | — | No projects | |
| GitHub integration | Working (narrow) | Token connect; README + top-level `docs/*.md` per repo | Only 5 repos synced (bug); no code/issues/PRs | Fixed (A): up to 25 repos (and 25 Slack channels) |
| Repository search + analysis | Missing | — | No code indexed | |

## Personal management

| Feature | Status | Evidence | Gaps / notes | Changes |
|---|---|---|---|---|
| Expense tracker | Missing | — | | |
| Learning tracker | Missing | — | | |
| Email assistant | Partial | Inbox triage, summaries, reply drafts (never sends); `write_email` automation action | No compose screen; no full email view | |
| Personal document vault | Missing | Uploads are text-indexed only; files not kept | Needs file storage (Supabase Storage) | |

## Automation and integrations

| Feature | Status | Evidence | Gaps / notes | Changes |
|---|---|---|---|---|
| Custom workflows | Working | Builder → `lib/automations/*`; 7 triggers, 10 actions. **Live-verified 2026-10-17: all 10 actions ran on the real engine + AI** (create_draft correctly refuses without an email trigger) | AND-only conditions | |
| Execution history | Working | `app/(app)/automations/[id]`, `run-history.tsx` | Re-run only on failed runs; no cross-automation history | |
| Gmail + Calendar connections | Working | Google OAuth start/callback, encrypted tokens, refresh, revoke | One shared Google connection; dead refresh token retried forever | |
| MCP connections | Partial | Cowork **is** an MCP server for Claude (10 tools, OAuth 2.1) | Cowork can't act as an MCP **client** | |
| Permission-controlled tools | Working | Scopes enforced per MCP call; capabilities in planner; per-automation permissions | Draft actions in automations ignore Settings → Agent switches | |
| Approval flows | Working | Proposals approve/edit/dismiss (atomic) | **No approval queue page: automation-created proposals are orphaned**; `notify` proposal kind unsupported (bug) | (B) New `/approvals` page: every pending proposal with its source (chat, voice, named automation) and links, approve / edit / dismiss, recent decisions; pending-count badge in the sidebar and mobile menu. Fixed (A): `notify` proposals run |

## Security findings

- `fetchPageText` (`lib/knowledge/extract.ts`) and the news fetcher follow redirects after a hostname-only private-address check → SSRF via redirect or DNS rebinding. **Fixed (A):** `lib/security/safe-fetch.ts` resolves every address of the host, rejects private, loopback, link-local, CGNAT, reserved and IPv6-mapped ranges, and follows redirects manually, checking each hop. Used by knowledge URL import, news feeds, image backfill and the news image proxy. Unit tests in `tests/unit/safe-fetch.test.ts`.

## Blockers needing configuration

| Need | For | Env / action |
|---|---|---|
| Web search API key | Web research with citations | `TAVILY_API_KEY` (or similar) |
| Speech server | Voice input in Firefox/Safari fallback | `STT_BASE_URL`, `STT_API_KEY`; `TTS_BASE_URL` |
| Embedding provider | Semantic search | `EMBEDDING_MODEL` on a provider that offers embeddings |
| Vision model | Screen understanding | A vision-capable model on the AI provider |
| Spotify Premium (app owner) | Spotify now-playing/controls | Spotify policy since 2025 |
| Native helper app | Desktop commands | Out of scope for a web app |

## Implementation log

Recorded as work lands (newest first).

### (C) 2026-10-19 · Conversation search (in progress, not deployed yet)

- `listConversations` (`lib/agent/chat.ts`) now searches every chat in SQL: title or any message `ILIKE` the query (`%` and `_` matched literally via `likePattern`), using the existing `messages_conv_idx`. Before, it matched only the newest 100 chats and 500 messages in JavaScript. Test: `tests/unit/conversation-search.test.ts`. Query ran cleanly against the production database.

### (B) 2026-10-19 · Approvals page and daily briefing on Today

Two existing features produced results nobody could see.

- **Approvals** (`app/(app)/approvals/page.tsx`, `components/approvals/approval-list.tsx`): lists pending proposals (reusing `pendingProposals` and the chat `ProposalCard`, so approve / edit / dismiss behave exactly as in chat), names the automation behind automation-created ones and links to it or the source chat, and shows the last 15 decisions. Nothing runs until you approve.
- **Nav badge**: `pendingProposalCount` (`lib/agent/proposals.ts`, uses the existing `proposals_user_status_idx`) feeds a count on Approvals in the sidebar and a dot on the mobile "More" tab (`components/layout/{nav.ts,sidebar.tsx,mobile-nav.tsx,app-shell.tsx}`, `app/(app)/layout.tsx`).
- **Briefing card** (`components/today/briefing-card.tsx`, `briefing-button.tsx`, `app/actions/briefing.ts`): shows the latest briefing (marked with its date if not today's) and builds one on demand through the existing `generateDailyBriefing`. It is a draggable Today card; accounts with a saved layout get it at the end.
- No migrations. Typecheck, lint and 103 unit tests pass.
- **Verified on production 2026-10-19** (test account, re-disabled afterwards): `/approvals` lists a pending proposal; approving a `notify` proposal through `executeProposal` created the notification and the pending count went 1 → 0; Today showed the empty briefing state, then after `generateDailyBriefing` (gpt-oss-120b, 1.3 s) rendered the headline and the meetings / mail / deadlines summary.

### (A) 2026-10-19 · Bug fixes and draggable Today

- SSRF guard `safeFetch` (see Security findings).
- Chat: failed model turns flagged and excluded from history; memories ordered newest-first.
- Citations: `mapOutsideCode` in `lib/knowledge/rank.ts`; used by `stripInvalidCitations` and the markdown renderer.
- Tasks: `spawnNextOccurrence` on every completion path; `updateTask` moves `remindAt` with `scheduledAt`.
- Jobs: `recoverStaleJobs` respects `maxAttempts`.
- Proposals: `notify` kind executes (in-app notification, deduped per proposal).
- Knowledge adapters: GitHub repos and Slack channels capped at 25 instead of 5.
- Voice: hands-free restarts listening after a silent turn.
- Today: cards rearrange by drag (mouse, touch, keyboard) with dnd-kit; order saved per account in `user_settings.today_layout` (migration `0009_today_layout`, additive).
- Deployed to production 2026-10-19 (READY).
