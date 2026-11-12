CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin', 'moderator', 'support', 'analyst');--> statement-breakpoint
CREATE TABLE "admin_role_assignments" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "admin_role" NOT NULL,
	"granted_by" uuid,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_one_owner_idx" ON "admin_role_assignments" USING btree ("role") WHERE role = 'owner';--> statement-breakpoint
-- Not reachable through Supabase's Data API; the app connects as the table owner, which RLS does not restrict.
ALTER TABLE "admin_role_assignments" ENABLE ROW LEVEL SECURITY;
