CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "agent" SET DEFAULT '{"name":"Ada","avatar":"orb","personality":"concise","customInstructions":"","language":"en","responseLength":"short","voice":"","speechRate":1,"proactivity":"nudge","capabilities":{"readEmail":true,"createDrafts":true,"manageTasks":true,"runAutomations":true,"searchKnowledge":true,"searchWeb":true,"autoMemory":true}}'::jsonb;--> statement-breakpoint
CREATE INDEX "rate_limits_reset_idx" ON "rate_limits" USING btree ("reset_at");--> statement-breakpoint
-- Not reachable through Supabase's Data API; the app connects as the table owner, which RLS does not restrict.
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
