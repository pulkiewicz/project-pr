ALTER TYPE "ai_job_kind" ADD VALUE 'draft_doc';--> statement-breakpoint
ALTER TABLE "quote_required_docs" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "quote_required_docs" ADD COLUMN "drive_file_id" text;