CREATE TABLE "anon_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anon_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "anon_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "email_domain" text;--> statement-breakpoint
ALTER TABLE "anon_identities" ADD CONSTRAINT "anon_identities_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anon_identities" ADD CONSTRAINT "anon_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anon_identities_member_idx" ON "anon_identities" USING btree ("space_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anon_identities_alias_idx" ON "anon_identities" USING btree ("space_id","alias");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_anon_identity_id_anon_identities_id_fk" FOREIGN KEY ("anon_identity_id") REFERENCES "public"."anon_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_anon_identity_id_anon_identities_id_fk" FOREIGN KEY ("anon_identity_id") REFERENCES "public"."anon_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Row-level security, like every other table since 0015.
ALTER TABLE "anon_identities" ENABLE ROW LEVEL SECURITY;
