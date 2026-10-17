ALTER TABLE "tasks" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_external_idx" ON "tasks" USING btree ("user_id","external_ref");