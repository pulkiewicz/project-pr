CREATE TYPE "ai_job_kind" AS ENUM('extract_checklist', 'propose_lines', 'reestimate_line', 'questions');--> statement-breakpoint
CREATE TYPE "ai_job_status" AS ENUM('queued', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "quote_input_kind" AS ENUM('file', 'text');--> statement-breakpoint
CREATE TYPE "question_audience" AS ENUM('internal', 'client');--> statement-breakpoint
CREATE TYPE "question_status" AS ENUM('open', 'answered', 'dismissed');--> statement-breakpoint
CREATE TYPE "ai_suggestion_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid,
	"quote_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12,4),
	"duration_ms" integer,
	"stop_reason" text,
	"error" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"kind" "ai_job_kind" NOT NULL,
	"status" "ai_job_status" DEFAULT 'queued'::"ai_job_status" NOT NULL,
	"params" jsonb DEFAULT '{}' NOT NULL,
	"token_hash" text NOT NULL,
	"summary" text,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"job_id" uuid,
	"section_id" uuid NOT NULL,
	"line_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'pending'::"ai_suggestion_status" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"kind" "quote_input_kind" NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"drive_file_id" text,
	"upload_session_hash" text,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "quote_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"audience" "question_audience" NOT NULL,
	"text" text NOT NULL,
	"context" text,
	"checklist_key" text,
	"status" "question_status" DEFAULT 'open'::"question_status" NOT NULL,
	"answer" text,
	"assignee_id" uuid,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "drive_folder_id" text;--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" ("created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_quote_idx" ON "ai_calls" ("quote_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_quote_idx" ON "ai_jobs" ("quote_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_suggestions_quote_idx" ON "ai_suggestions" ("quote_id","status");--> statement-breakpoint
CREATE INDEX "quote_inputs_quote_idx" ON "quote_inputs" ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_questions_quote_idx" ON "quote_questions" ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_questions_assignee_idx" ON "quote_questions" ("assignee_id","status");--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_job_id_ai_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_job_id_ai_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_section_id_quote_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "quote_sections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_line_id_quote_lines_id_fkey" FOREIGN KEY ("line_id") REFERENCES "quote_lines"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_decided_by_users_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "quote_inputs" ADD CONSTRAINT "quote_inputs_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote_questions" ADD CONSTRAINT "quote_questions_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote_questions" ADD CONSTRAINT "quote_questions_assignee_id_users_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "quote_questions" ADD CONSTRAINT "quote_questions_answered_by_users_id_fkey" FOREIGN KEY ("answered_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "quote_questions" ADD CONSTRAINT "quote_questions_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");