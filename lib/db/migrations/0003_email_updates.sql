ALTER TABLE "user_settings" ALTER COLUMN "notify_email_digest" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "user_settings" SET "notify_email_digest" = true;