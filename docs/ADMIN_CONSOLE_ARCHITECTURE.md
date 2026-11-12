# Cowork Super Admin Console: security audit and architecture proposal

Date: 2026-11-12. Status: **proposal for review**. No application file was changed for this document.

Follows the Cowork V2 decision already recorded: the Next.js API on Vercel is the backend, Postgres is hosted on Supabase, and authorization is enforced in server code. Supabase Auth and supabase-js are not used.

---

## 1. Audit: what exists today

| Area | Today | Assessment |
|---|---|---|
| Admin identity | `isAdmin(email)` in `lib/auth/policy.ts`, from the `ADMIN_EMAILS` env var (3 addresses on Vercel) | Server-side and correct. **Weakness:** if `ADMIN_EMAILS` is unset, `adminEmails()` falls back to the sign-in allowlist (`lib/env.ts:124`), which can make every allowed user an admin. Must be closed first. |
| Web console | `/console` (Overview, Users, Broadcast, AI and tokens, System). `requireAdmin()` returns 404 to everyone else. Every admin action re-checks the role. | Good base. No roles below "admin", no second factor, no audit table. |
| Sessions | Email one-time code, 30-day sessions (sliding), stored hashed in `sessions`, revocable, Bearer for the mobile app | Fine for users. Too weak for owner controls: one stolen session token is full admin. |
| Audit trail | `activity_log` (user actions, including `admin.*` tools), `trace_spans`, `ai_runs` | Not append-only, cascades with the user, no before and after values. |
| Configuration | Env vars on Vercel plus per-user `user_settings` | No app-wide configuration, no history, no rollback. |
| Feature flags | None | New. |
| Versions and updates | None: no `expo-updates`, the app sends no version header | New. Over-the-air updates need `expo-updates` plus an update host. |
| Database security | 47 tables, RLS enabled on some, **no policies**; the server connects as the owner role, so RLS never applies | Defense in depth only; the real boundary is server code. |
| Mobile admin UI | None | New. |

---

## 2. Authorization architecture

### 2.1 Roles and the owner

- **Owner** (exactly one): the designated account. Set by a trusted server-side bootstrap only: a script run by you with database access (`scripts/admin-bootstrap.mjs`), using a verified account email from an `OWNER_EMAIL` env var. There is no API that creates or transfers the owner. Transferring ownership is the same script with `--transfer`, run deliberately; the previous owner becomes an admin.
- **Roles** below the owner: `admin`, `moderator`, `support`, `analyst`. Only the owner can grant or revoke them, and roles live in `admin_role_assignments`.
- **Permissions are defined in code**, not in the database (`lib/admin/permissions.ts`: role to permission set). A database change can never grant a permission the code does not define. Owner-only permissions include roles, security policy, mandatory updates, maintenance mode, user deletion, configuration rollback and secrets metadata.
- `ADMIN_EMAILS` becomes the bootstrap allowlist only, and the fallback to the sign-in allowlist is removed.

### 2.2 Step-up admin sessions (multi-factor)

A normal session never reaches admin APIs. Admin work needs a short **admin session**:

1. The signed-in person opens the console.
2. They enter a TOTP code from an authenticator app (RFC 6238, 30-second steps, plus or minus one step).
3. The server creates an `admin_sessions` row bound to the user session. It lasts 15 minutes idle and 2 hours at most, and it is stored hashed.
4. Every `/api/admin/*` request needs both the user session and the admin session header. The server rechecks the role on every call.

- TOTP secrets are encrypted at rest with the existing AES-256-GCM token encryption (`lib/security/crypto`). Ten recovery codes are stored hashed. Enrolment needs a fresh email code.
- Optional later: passkeys (WebAuthn) as a stronger second factor on the web.
- **Biometric reauthentication** on the phone (`expo-local-authentication`) locks the admin area on the device. The UI must say it is a local convenience: the server still requires the TOTP step-up, because a fingerprint check cannot be verified by the server.
- Failed step-ups are rate limited and logged. Five failures lock admin access for 15 minutes and alert the owner by email and Telegram.

### 2.3 Request pipeline (every admin operation)

```
request -> user session valid? -> admin session valid and bound? -> role has permission (code map)?
        -> zod validation -> confirmation token for destructive actions -> perform in a transaction
        -> write admin_audit_logs (actor, action, resource, before, after, ip prefix, user agent)
        -> response
```

Destructive operations use two calls: `prepare` returns a summary and a one-time confirmation token valid for 2 minutes, then `commit` with that token. The UI shows the summary and requires typing the resource name for the most dangerous actions.

### 2.4 Database protection

- `admin_audit_logs` is **append-only**: a Postgres trigger rejects UPDATE and DELETE. Each row stores the previous row's SHA-256 hash, so tampering is detectable. It does not cascade when a user is deleted (the actor is kept as an id plus email hash).
- RLS: enable RLS with no permissive policies on every admin table, and revoke the anon and authenticated roles. That blocks the Supabase REST API, as defense in depth. The server's owner role remains the only path.
- No arbitrary SQL anywhere. Database views are read-only, fixed queries.

---

## 3. Remote configuration and enforcement

- **Configuration registry in code** (`lib/config/registry.ts`): every key has a zod schema, a default, a scope (`public`, `server`, `owner`) and a risk level. Unknown keys are rejected. Values are data, never code, so remote UI injection is impossible.
- **Storage:**
  - `app_configuration` (key, value jsonb, version, updated_by, updated_at)
  - `configuration_history` (append-only: key, version, before, after, actor, reason)
  - Rollback writes a new version with an old value. History is never rewritten.
- **Delivery:**
  - `GET /api/config` returns the public subset, with an ETag and a 60-second cache.
  - The mobile app and the website read it at launch and when they return to the foreground, and keep the last good copy for offline use.
  - The server reads `server` keys through a 60-second in-memory cache.
- **Enforcement on the server** for anything security relevant: upload limits, rate limits, registration open or closed, maintenance mode, AI capability switches and per-user AI limits. The UI hiding a button is never the control.
- **Maintenance mode:** the routing middleware returns 503 with the configured message to everyone except admins. The app and website show a maintenance screen.

Keys at launch, grouped as the console shows them:

| Group | Keys |
|---|---|
| App | app name, registration open, default theme, default preferences, upload limits, rate limits |
| Appearance | accent choice (from the design system palette only), logo reference (an uploaded asset id), announcement banner, onboarding notice, maintenance screen text |
| AI | capability switches (chat, research, voice, agents), fallback policy, per-user daily limits, price table for cost estimates |
| Connect | discovery, messaging, files, walkie, calls (on or off), file and media size limits, group size limit, security policy version |
| Notifications | defaults, quiet hours default |

---

## 4. Feature flags

- `feature_flags` (key, description, enabled, rollout_percent, platforms, min_app_version, max_app_version, segments, starts_at, ends_at, version) plus `feature_flag_history`.
- **Evaluation on the server:** a deterministic bucket, SHA-256 of user id plus flag key, mod 100, compared with `rollout_percent`. Platform and app version come from the request headers, and segments from user attributes (role, signup date, allowlist).
- `GET /api/flags` returns the evaluated flags for that person. Server routes call `requireFlag(key)` so a disabled feature is refused by the API, not just hidden.
- Scheduled activation runs through `starts_at` and `ends_at`, checked at evaluation time with no job needed. Rollback restores a previous version from history.

---

## 5. Versions and releases

- The app sends `X-App-Version`, `X-App-Build`, `X-Platform` and `X-Runtime-Version` on every request. The server records the latest values per session (new columns on `sessions`), which also feeds the version distribution chart.
- Tables:
  - `application_releases`: platform, version, build, runtime version, channel, status (draft, testing, live, halted), notes, release date.
  - `update_policies`: platform, minimum supported version, latest version, recommended or mandatory, message.
- **Enforcement:**
  - Below the minimum, mobile API routes answer `426 Upgrade Required` with the store link. The app then shows a blocking update screen.
  - Below the latest but at or above the minimum, the app shows a dismissible update prompt.
- **Over-the-air updates** (JavaScript and assets only) need `expo-updates` in the app plus an update host.
  - Recommended: EAS Update, which needs an Expo account.
  - Alternative: a self-hosted server implementing the Expo Updates protocol on Vercel.
  - The console then lists update groups per channel, and rollback republishes a previous compatible group.
  - An update only reaches apps with the same `runtimeVersion`. The console shows this and blocks pointing a channel at an incompatible update.
- **Native changes** (new native modules, permissions, SDK upgrades) always need a new store build. The console labels each release "OTA" or "Store build" and never offers an OTA path for a store build.

---

## 6. Modules

| Module | Built on | Notes |
|---|---|---|
| Overview | Existing single-query KPIs in `lib/admin/stats.ts`, plus health snapshots | Real data only; "unavailable" when a source fails |
| Users | `users`, `sessions`, `activity_log` | Search, status, signup date, app version, suspend (existing `disabledAt`), restore, restrict (per-feature blocks in `user_restrictions`), revoke sessions, process deletion requests (prepare and commit). Never shows tokens or codes. |
| App Config | Section 3 | With history and diff |
| AI Control | `lib/ai/router.ts`, `ai_runs` | Capability switches, routing and fallback policy, limits, token and cost charts, error rates, provider availability (existing provider test). **Secrets stay in Vercel env vars.** The console shows only which secret is set and when it was last rotated; rotation is a guided manual step, or uses the Vercel API if you add a scoped Vercel token server-side. Model and provider names appear only here, never in user screens. |
| Connect | Config keys plus flags | Honest limit: offline phones apply changes only after their next config fetch; the console says so |
| Features | Section 4 | |
| Versions | Section 5 | Confirmation for every release operation |
| Appearance | Config keys | Only validated values from the design system |
| Notifications | Existing broadcast system (in-app, push, email) | Adds scheduling through the existing job queue, targeting by segment, history and delivery counts (already recorded per broadcast) |
| Community | Reports from Connect social (C7) | Review queue, actions recorded in `moderation_actions` |
| Security | `admin_sessions`, audit, sign-in records | Admin login history, sessions, roles, failed step-ups, rate limit settings, policy |
| Infrastructure | `system_health_snapshots` from a 5-minute cron | Database latency and connections, job backlog and failures, API error rates from `trace_spans`, integration errors, storage use. No credentials shown. Supabase dashboard metrics need a Supabase management token (optional). |
| Analytics | Aggregates over existing tables | Daily and weekly active users (session `last_seen_at`), signups, conversations, AI use, feature adoption (activity tools), release adoption. Counts only, no message content. **Crash reports do not exist today**: they need a crash reporter (for example Sentry) or a small error endpoint. Decision D5. |
| Audit Logs | `admin_audit_logs` | Filter by actor, action and date; export CSV |
| Maintenance | Config keys | Owner only |

---

## 7. Interfaces

- **Web:** extend the existing `/console`. It stays unlinked and 404 for everyone else, with a sidebar of the 15 modules listed in your brief.
- **Mobile:** Profile > Admin Console appears only when `GET /api/admin/me` says the account has a role. The app never decides this itself. The area is a separate stack (`apps/mobile/src/app/admin/**`) with tablet two-pane layouts, behind the step-up screen and optional biometric lock.
- **Design:** the V2 dark charcoal palette with the emerald accent, data tables with search and filters, and empty, loading and error states. No admin controls in normal user screens.

---

## 8. New tables (one additive migration)

`admin_role_assignments`, `admin_mfa` (encrypted TOTP secret, recovery code hashes), `admin_sessions`, `admin_audit_logs` (append-only trigger, hash chain), `app_configuration`, `configuration_history`, `feature_flags`, `feature_flag_history`, `application_releases`, `update_policies`, `system_announcements`, `system_health_snapshots`, `user_restrictions`, `moderation_actions`. Plus new columns on `sessions`: `app_version`, `platform`, `runtime_version`.

Tables from the brief that are not needed: `admin_roles` and `admin_permissions` (roles and permissions are fixed in code, which is safer than editable rows), `feature_rollouts` (rollout fields live on the flag), `administrative_sessions` (this is `admin_sessions`).

---

## 9. Tests

- Authorization boundary tests for every admin route:
  - no session gives 401
  - a normal user gives 404
  - a role without permission gives 403
  - no admin session gives 401
  - an expired admin session gives 401
- TOTP against the RFC 6238 test vectors; the confirmation-token flow; flag bucketing (stable, correct percentages); version comparison; config schema validation and rollback.
- Database tests for the audit trigger: UPDATE and DELETE must fail.

---

## 10. Phases

| Phase | Scope |
|---|---|
| A | Close the `ADMIN_EMAILS` fallback; owner bootstrap script; roles and permissions in code |
| B | TOTP enrolment and step-up admin sessions; audit log with the append-only trigger |
| C | Admin API skeleton with the request pipeline; migration; RLS hardening |
| D | Overview and Infrastructure (health snapshots cron) |
| E | Configuration registry, `/api/config`, history and rollback, maintenance mode |
| F | Feature flags and server enforcement |
| G | Version headers, update policies, 426 enforcement, update screens; OTA after decision D3 |
| H | Users: restrict, revoke, deletion queue, moderation |
| I | AI Control and Connect Control |
| J | Analytics and System Logs; crash reporting after decision D5 |
| K | Mobile admin area, security test pass, production verification |

---

## 11. Decisions needed

| # | Decision |
|---|---|
| D1 | Which one email is the **owner**? Should the other two `ADMIN_EMAILS` addresses become `admin` role holders, or lose access? |
| D2 | Second factor: TOTP authenticator app (recommended to start), passkeys, or both? |
| D3 | Over-the-air updates: EAS Update (needs an Expo account), a self-hosted update server, or store builds only for now? |
| D4 | Secret rotation: manual with a guided checklist (recommended), or add a scoped Vercel API token so the console can rotate env vars? |
| D5 | Crash reporting: add a provider such as Sentry, a minimal own endpoint, or none yet? |
| D6 | Build the mobile admin area in the same phase as the web, or web first? |
