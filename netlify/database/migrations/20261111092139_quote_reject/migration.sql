ALTER TYPE "opportunity_stage" ADD VALUE 'abandoned' BEFORE 'on_hold';--> statement-breakpoint
ALTER TYPE "quote_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rejected_by_users_id_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id");