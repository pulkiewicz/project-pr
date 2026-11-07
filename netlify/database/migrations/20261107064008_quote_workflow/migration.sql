-- Przepływ wyceny (8 kroków): wymagane dokumenty oferty (krok 3) i zadanie AI „extract_formal”.
-- ADD VALUE jest tu bezpieczne: nowa wartość enuma nie jest używana w tej samej transakcji migracji.
ALTER TYPE "ai_job_kind" ADD VALUE 'extract_formal';--> statement-breakpoint
CREATE TABLE "quote_required_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "quote_required_docs_status_chk" CHECK ("status" IN ('todo', 'ready', 'na'))
);
--> statement-breakpoint
CREATE INDEX "quote_required_docs_quote_idx" ON "quote_required_docs" ("quote_id");--> statement-breakpoint
ALTER TABLE "quote_required_docs" ADD CONSTRAINT "quote_required_docs_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote_required_docs" ADD CONSTRAINT "quote_required_docs_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id");