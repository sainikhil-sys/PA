CREATE TABLE "connect_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_room_presence" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_room_presence_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid,
	"timer_status" text DEFAULT 'idle' NOT NULL,
	"duration_sec" integer DEFAULT 1500 NOT NULL,
	"ends_at" timestamp with time zone,
	"remaining_sec" integer,
	"media_url" text,
	"media_kind" text,
	"media_start_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connect_keys" ADD CONSTRAINT "connect_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_notes" ADD CONSTRAINT "space_notes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_notes" ADD CONSTRAINT "space_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_notes" ADD CONSTRAINT "space_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_room_presence" ADD CONSTRAINT "space_room_presence_room_id_space_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."space_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_room_presence" ADD CONSTRAINT "space_room_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_rooms" ADD CONSTRAINT "space_rooms_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_rooms" ADD CONSTRAINT "space_rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_rooms" ADD CONSTRAINT "space_rooms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connect_keys_key_idx" ON "connect_keys" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "connect_keys_user_idx" ON "connect_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "space_notes_space_idx" ON "space_notes" USING btree ("space_id","updated_at");--> statement-breakpoint
CREATE INDEX "space_room_presence_seen_idx" ON "space_room_presence" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "space_rooms_space_idx" ON "space_rooms" USING btree ("space_id","updated_at");--> statement-breakpoint
-- Hand-written tail of the connect_on_spaces migration (connect_keys, space_notes, space_rooms,
-- space_room_presence). After regenerating the migration, add "--> statement-breakpoint" to the end
-- of its last generated line, then append this file unchanged.
-- Row-level security on the new tables, like every other table since 0015.
ALTER TABLE "connect_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_room_presence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase's API roles get no grants at all on these tables (skipped where the roles don't exist, e.g. local Postgres).
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['connect_keys', 'space_notes', 'space_rooms', 'space_room_presence'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
