-- Row-level security on every remaining table (B1). No policies: Cowork connects as the table
-- owner, which RLS does not restrict, so the app is unaffected. It closes Supabase's public Data
-- API (anon and authenticated roles) to these tables, as 0010 to 0013 did for theirs.

ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_connectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "briefings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ideas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "news_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pair_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_pair_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trace_spans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Realtime (B2): a signed-in person may only receive Broadcast messages on their own private
-- channel "user:<their id>". The token's `sub` is set by Cowork's server (lib/realtime/token.ts).
-- Nobody may send on a channel from a device; only the server publishes.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS cowork_own_user_channel ON realtime.messages';
    EXECUTE $p$CREATE POLICY cowork_own_user_channel ON realtime.messages FOR SELECT TO authenticated
      USING (realtime.messages.extension = 'broadcast' AND realtime.topic() = 'user:' || (auth.jwt() ->> 'sub'))$p$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  -- Supabase may reserve realtime.messages for its own admin role; then create this policy once in
  -- the dashboard's SQL editor (same statement). Everything above still applies.
  RAISE NOTICE 'cowork_own_user_channel policy not created: %', SQLERRM;
END $$;
