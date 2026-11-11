ALTER TYPE "ai_job_kind" ADD VALUE 'competition';--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "competition" jsonb;