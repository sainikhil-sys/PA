ALTER TABLE "news_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "room" jsonb DEFAULT '{}'::jsonb NOT NULL;