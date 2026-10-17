ALTER TABLE "ai_runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "key_source" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "ai_provider" jsonb;--> statement-breakpoint
CREATE INDEX "ai_runs_user_idx" ON "ai_runs" USING btree ("user_id","created_at");