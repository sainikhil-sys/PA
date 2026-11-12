CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin', 'moderator', 'support', 'analyst');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email_hash" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"due_by" timestamp with time zone NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_email_hash" text,
	"actor_role" text,
	"admin_session_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"outcome" text NOT NULL,
	"ip_prefix" text,
	"user_agent" text,
	"request_id" text,
	"prev_hash" text,
	"hash" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"action" text NOT NULL,
	"input_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_confirmations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_mfa" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"totp_secret_enc" text NOT NULL,
	"last_used_step" bigint,
	"recovery_code_hashes" text[] NOT NULL,
	"enabled_at" timestamp with time zone,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "admin_role" NOT NULL,
	"granted_by" uuid,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"method" text NOT NULL,
	"platform" text NOT NULL,
	"ip_prefix" text,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "announcement_dismissals" (
	"user_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_dismissals_user_id_announcement_id_pk" PRIMARY KEY("user_id","announcement_id")
);
--> statement-breakpoint
CREATE TABLE "app_configuration" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_configuration_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"previous_value" jsonb,
	"restored_from_version" integer,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"build_number" integer,
	"runtime_version" text,
	"channel" text DEFAULT 'production' NOT NULL,
	"update_group_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"store_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_flag_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"previous_value" jsonb,
	"restored_from_version" integer,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percent" integer DEFAULT 0 NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"placement" text DEFAULT 'banner' NOT NULL,
	"href" text,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dismissible" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "app_build" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "runtime_version" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "update_id" text;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_confirmations" ADD CONSTRAINT "admin_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_mfa" ADD CONSTRAINT "admin_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_session_id_sessions_id_fk" FOREIGN KEY ("user_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."system_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_configuration" ADD CONSTRAINT "app_configuration_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_releases" ADD CONSTRAINT "application_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_announcements" ADD CONSTRAINT "system_announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "admin_audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "admin_audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "admin_confirmations_user_idx" ON "admin_confirmations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_active_user_idx" ON "admin_role_assignments" USING btree ("user_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_one_owner_idx" ON "admin_role_assignments" USING btree ("role") WHERE role = 'owner' and revoked_at is null;--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "config_history_key_version_idx" ON "app_configuration_history" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "release_unique_idx" ON "application_releases" USING btree ("platform","kind","version","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "flag_history_key_version_idx" ON "feature_flag_history" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "user_restrictions_user_idx" ON "user_restrictions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_rollout_range" CHECK ("rollout_percent" between 0 and 100);--> statement-breakpoint
-- Every admin table: RLS on with no policies, so Supabase's public Data API can't reach them.
-- The app connects as the table owner, which RLS does not restrict.
ALTER TABLE "admin_role_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_mfa" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_configuration" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_configuration_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_flag_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application_releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_restrictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase's API roles get no grants at all on these tables (skipped where the roles don't exist, e.g. local Postgres).
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['admin_role_assignments', 'admin_mfa', 'admin_sessions', 'admin_audit_logs', 'admin_confirmations', 'app_configuration',
        'app_configuration_history', 'feature_flags', 'feature_flag_history', 'application_releases', 'system_announcements',
        'announcement_dismissals', 'user_restrictions', 'account_deletion_requests'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON SEQUENCE public.admin_audit_logs_seq_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
-- Audit rows are hash chained. The hash covers the previous hash and every column, in a fixed order.
CREATE OR REPLACE FUNCTION admin_audit_row_hash(prev text, r admin_audit_logs) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce(prev, '') || '|' ||
    jsonb_build_array(
      r.seq, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), r.actor_user_id, r.actor_email_hash, r.actor_role,
      r.admin_session_id, r.action, r.resource_type, r.resource_id, r.before, r.after, r.reason, r.outcome,
      r.ip_prefix, r.user_agent, r.request_id
    )::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint
-- Inserts are serialised by an advisory lock and numbered after taking it, so seq order is chain order.
CREATE OR REPLACE FUNCTION admin_audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('admin_audit_logs'));
  NEW.seq := nextval(pg_get_serial_sequence('admin_audit_logs', 'seq'));
  NEW.created_at := now();
  SELECT hash INTO last_hash FROM admin_audit_logs ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.hash := admin_audit_row_hash(last_hash, NEW);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER admin_audit_chain_trg BEFORE INSERT ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION admin_audit_chain();--> statement-breakpoint
CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END $$;--> statement-breakpoint
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE OR DELETE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();--> statement-breakpoint
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
