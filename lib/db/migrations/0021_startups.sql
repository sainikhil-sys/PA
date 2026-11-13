CREATE TABLE "pro_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"open_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'everyone' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "startup_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "startup_members" (
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "startup_members_startup_id_user_id_pk" PRIMARY KEY("startup_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "startups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"one_liner" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'idea' NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"looking_for" text[] DEFAULT '{}'::text[] NOT NULL,
	"skills_needed" text[] DEFAULT '{}'::text[] NOT NULL,
	"space_id" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pro_profiles" ADD CONSTRAINT "pro_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_interests" ADD CONSTRAINT "startup_interests_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_interests" ADD CONSTRAINT "startup_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_members" ADD CONSTRAINT "startup_members_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_members" ADD CONSTRAINT "startup_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startups" ADD CONSTRAINT "startups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pro_profiles_skills_idx" ON "pro_profiles" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "pro_profiles_open_idx" ON "pro_profiles" USING gin ("open_to");--> statement-breakpoint
CREATE INDEX "startup_interests_startup_idx" ON "startup_interests" USING btree ("startup_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "startup_interests_open_idx" ON "startup_interests" USING btree ("startup_id","user_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "startup_members_user_idx" ON "startup_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "startups_slug_idx" ON "startups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "startups_owner_idx" ON "startups" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "startups_skills_idx" ON "startups" USING gin ("skills_needed");--> statement-breakpoint
CREATE INDEX "startups_text_idx" ON "startups" USING gin (to_tsvector('simple', "name" || ' ' || "one_liner" || ' ' || "industry"));--> statement-breakpoint
-- Row-level security on the new tables, like every other table since 0015.
ALTER TABLE "pro_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "startups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "startup_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "startup_interests" ENABLE ROW LEVEL SECURITY;
