CREATE TABLE "broadcast_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid,
	"uploaded_by" uuid,
	"role" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "email" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast_files" ADD CONSTRAINT "broadcast_files_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_files" ADD CONSTRAINT "broadcast_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_files_broadcast_idx" ON "broadcast_files" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "broadcast_files_uploader_idx" ON "broadcast_files" USING btree ("uploaded_by","created_at");--> statement-breakpoint
ALTER TABLE "broadcast_files" ENABLE ROW LEVEL SECURITY;