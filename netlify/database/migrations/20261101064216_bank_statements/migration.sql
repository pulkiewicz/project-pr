-- Wyciągi bankowe PKO BP (PDF): nagłówki wyciągów i operacje, pod rekoncyliację z fakturami kosztowymi (decyzja 01.11.2026).
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bank" text NOT NULL,
	"account_number" text NOT NULL,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"number" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"opening_balance" bigint NOT NULL,
	"closing_balance" bigint NOT NULL,
	"credit_turnover" bigint NOT NULL,
	"debit_turnover" bigint NOT NULL,
	"file_name" text NOT NULL,
	"sha256" text NOT NULL,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"statement_id" uuid NOT NULL,
	"account_number" text NOT NULL,
	"operation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance" bigint NOT NULL,
	"description" text NOT NULL,
	"title" text,
	"counterparty_name" text,
	"counterparty_account" text,
	"invoice_ref" text,
	"vat_amount" bigint,
	"supplier_nip" text,
	"card_holder" text,
	"merchant" text,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statements_sha256_uq" ON "bank_statements" ("sha256");--> statement-breakpoint
CREATE INDEX "bank_statements_account_period_idx" ON "bank_statements" ("account_number","period_from");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_natural_uq" ON "bank_transactions" ("account_number","operation_id","type","amount");--> statement-breakpoint
CREATE INDEX "bank_transactions_statement_idx" ON "bank_transactions" ("statement_id","seq");--> statement-breakpoint
CREATE INDEX "bank_transactions_booking_idx" ON "bank_transactions" ("booking_date");--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_imported_by_users_id_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_bank_statements_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE;