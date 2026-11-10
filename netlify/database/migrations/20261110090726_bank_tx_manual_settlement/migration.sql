ALTER TABLE "bank_transactions" ADD COLUMN "settlement_note" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "settled_by" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_settled_by_users_id_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id");