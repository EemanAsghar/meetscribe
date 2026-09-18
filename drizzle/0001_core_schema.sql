CREATE TYPE "public"."action_item_origin" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ask_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."chunk_kind" AS ENUM('transcript', 'note');--> statement-breakpoint
CREATE TYPE "public"."meeting_source" AS ENUM('scheduled', 'instant', 'upload', 'paste');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'recording', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"text" text NOT NULL,
	"assignee_name" text,
	"assignee_user_id" uuid,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"source_ms" integer,
	"origin" "action_item_origin" DEFAULT 'ai' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "ask_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"start_ms" integer NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"source" "meeting_source" NOT NULL,
	"status" "meeting_status" DEFAULT 'processing' NOT NULL,
	"error" text,
	"audio_url" text,
	"timestamps_estimated" boolean DEFAULT false NOT NULL,
	"active_template_id" uuid,
	"share_slug" text NOT NULL,
	"share_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_share_slug_unique" UNIQUE("share_slug")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"meeting_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	CONSTRAINT "participants_meeting_id_name_pk" PRIMARY KEY("meeting_id","name")
);
--> statement-breakpoint
CREATE TABLE "scratchpads" (
	"meeting_id" uuid PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"notes_version_used" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sections" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transcript_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" "chunk_kind" DEFAULT 'transcript' NOT NULL,
	"seg_from" integer,
	"seg_to" integer,
	"start_ms" integer,
	"end_ms" integer,
	"speaker_label" text,
	"text" text NOT NULL,
	"embedding" vector(768),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"speaker" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"avatar_color" text DEFAULT '#0F766E' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_thread_id_ask_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ask_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_threads" ADD CONSTRAINT "ask_threads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_active_template_id_templates_id_fk" FOREIGN KEY ("active_template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scratchpads" ADD CONSTRAINT "scratchpads_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_meeting_idx" ON "action_items" USING btree ("meeting_id","sort_order");--> statement-breakpoint
CREATE INDEX "ask_messages_thread_idx" ON "ask_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "highlights_meeting_idx" ON "highlights" USING btree ("meeting_id","start_ms");--> statement-breakpoint
CREATE INDEX "meetings_owner_started_idx" ON "meetings" USING btree ("owner_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "summaries_current_idx" ON "summaries" USING btree ("meeting_id","template_id") WHERE "summaries"."is_current";--> statement-breakpoint
CREATE INDEX "summaries_meeting_idx" ON "summaries" USING btree ("meeting_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transcript_chunks_meeting_idx" ON "transcript_chunks" USING btree ("meeting_id","kind");--> statement-breakpoint
CREATE INDEX "transcript_chunks_embedding_idx" ON "transcript_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "transcript_chunks_tsv_idx" ON "transcript_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_meeting_idx" ON "transcript_segments" USING btree ("meeting_id","idx");