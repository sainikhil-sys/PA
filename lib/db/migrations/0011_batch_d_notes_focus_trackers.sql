CREATE TABLE "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'txt' NOT NULL,
	"text" text NOT NULL,
	"chars" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"monthly_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"spent_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"planned_minutes" integer NOT NULL,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'course' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"url" text,
	"notes" text DEFAULT '' NOT NULL,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"logged_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_title" text DEFAULT '' NOT NULL,
	"event_start" timestamp with time zone NOT NULL,
	"event_end" timestamp with time zone,
	"attendee_count" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"summary" text,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"summarized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "source" text DEFAULT 'settings' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "link_description" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "link_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_items" ADD CONSTRAINT "learning_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_logs" ADD CONSTRAINT "learning_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_logs" ADD CONSTRAINT "learning_logs_item_id_learning_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."learning_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_attachments_conv_idx" ON "chat_attachments" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_attachments_message_idx" ON "chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_budgets_user_category_idx" ON "expense_budgets" USING btree ("user_id","category","currency");--> statement-breakpoint
CREATE INDEX "expenses_user_date_idx" ON "expenses" USING btree ("user_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_user_category_idx" ON "expenses" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_started_idx" ON "focus_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "focus_sessions_task_idx" ON "focus_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "learning_items_user_idx" ON "learning_items" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "learning_logs_user_date_idx" ON "learning_logs" USING btree ("user_id","logged_on");--> statement-breakpoint
CREATE INDEX "learning_logs_item_idx" ON "learning_logs" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_notes_user_event_idx" ON "meeting_notes" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "meeting_notes_user_start_idx" ON "meeting_notes" USING btree ("user_id","event_start");--> statement-breakpoint
CREATE INDEX "notes_user_pinned_idx" ON "notes" USING btree ("user_id","pinned","updated_at");--> statement-breakpoint
CREATE INDEX "notes_user_url_idx" ON "notes" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "notes_tags_idx" ON "notes" USING gin ("tags");--> statement-breakpoint
UPDATE "notes" SET "updated_at" = "created_at";--> statement-breakpoint
ALTER TABLE "chat_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "focus_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learning_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learning_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_notes" ENABLE ROW LEVEL SECURITY;