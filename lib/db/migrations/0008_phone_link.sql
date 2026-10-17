CREATE TABLE "phone_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"token_hash" text NOT NULL,
	"battery" integer,
	"charging" boolean,
	"paused" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_devices_token_hash_unique" UNIQUE("token_hash")
	
);

--> statement-breakpoint
CREATE TABLE "phone_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"app_package" text NOT NULL,
	"app_name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"external_key" text,
	"posted_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_pair_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_pair_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "phone_devices" ADD CONSTRAINT "phone_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_events" ADD CONSTRAINT "phone_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_events" ADD CONSTRAINT "phone_events_device_id_phone_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."phone_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_pair_codes" ADD CONSTRAINT "phone_pair_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_devices_user_idx" ON "phone_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "phone_events_user_idx" ON "phone_events" USING btree ("user_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_events_dedupe_idx" ON "phone_events" USING btree ("device_id","external_key");