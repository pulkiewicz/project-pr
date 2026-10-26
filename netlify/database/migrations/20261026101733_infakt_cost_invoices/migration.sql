CREATE TYPE "cost_invoice_event_kind" AS ENUM('imported', 'edited', 'allocated', 'submitted', 'approved', 'rejected', 'reopened', 'changed_in_infakt');--> statement-breakpoint
CREATE TYPE "cost_invoice_status" AS ENUM('new', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "cost_invoice_allocations" (
	"invoice_id" uuid,
	"project_id" uuid,
	"share" numeric(5,2) NOT NULL,
	CONSTRAINT "cost_invoice_allocations_pkey" PRIMARY KEY("invoice_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "cost_invoice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"invoice_id" uuid NOT NULL,
	"kind" "cost_invoice_event_kind" NOT NULL,
	"comment" text,
	"meta" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"infakt_uuid" text NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"seller_name" text,
	"description" text,
	"category" text,
	"issue_date" date,
	"due_date" date,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"net_price" bigint,
	"gross_price" bigint,
	"tax_price" bigint,
	"payment_status" text,
	"accounting_status" text,
	"infakt_created_at" timestamp with time zone,
	"manual" jsonb DEFAULT '{}' NOT NULL,
	"status" "cost_invoice_status" DEFAULT 'new'::"cost_invoice_status" NOT NULL,
	"note" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX "cost_invoice_allocations_project_idx" ON "cost_invoice_allocations" ("project_id");--> statement-breakpoint
CREATE INDEX "cost_invoice_events_invoice_idx" ON "cost_invoice_events" ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_invoices_infakt_uuid_uq" ON "cost_invoices" ("infakt_uuid");--> statement-breakpoint
CREATE INDEX "cost_invoices_status_idx" ON "cost_invoices" ("status");--> statement-breakpoint
CREATE INDEX "cost_invoices_issue_date_idx" ON "cost_invoices" ("issue_date");--> statement-breakpoint
CREATE INDEX "cost_invoices_infakt_created_idx" ON "cost_invoices" ("infakt_created_at");--> statement-breakpoint
ALTER TABLE "cost_invoice_allocations" ADD CONSTRAINT "cost_invoice_allocations_invoice_id_cost_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cost_invoices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cost_invoice_allocations" ADD CONSTRAINT "cost_invoice_allocations_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "cost_invoice_events" ADD CONSTRAINT "cost_invoice_events_invoice_id_cost_invoices_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cost_invoices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cost_invoice_events" ADD CONSTRAINT "cost_invoice_events_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "cost_invoices" ADD CONSTRAINT "cost_invoices_submitted_by_users_id_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "cost_invoices" ADD CONSTRAINT "cost_invoices_decided_by_users_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id");
--> statement-breakpoint
-- Moduł Faktury (inFakt): rola Admin/Envcheck wewnętrzny otwiera możliwość, o dostępie decyduje lista osób (app_settings invoices.access).
INSERT INTO permissions (role, module, action, allowed) VALUES
  ('Admin', 'invoices', 'view', true),
  ('Admin', 'invoices', 'create', true),
  ('Admin', 'invoices', 'edit', true),
  ('Admin', 'invoices', 'delete', true),
  ('Admin', 'invoices', 'approve', true),
  ('Admin', 'invoices', 'export', true),
  ('EnvcheckInternal', 'invoices', 'view', true),
  ('EnvcheckInternal', 'invoices', 'create', true),
  ('EnvcheckInternal', 'invoices', 'edit', true),
  ('EnvcheckInternal', 'invoices', 'delete', true),
  ('EnvcheckInternal', 'invoices', 'approve', true),
  ('EnvcheckInternal', 'invoices', 'export', true),
  ('Arsanit', 'invoices', 'view', false),
  ('Arsanit', 'invoices', 'create', false),
  ('Arsanit', 'invoices', 'edit', false),
  ('Arsanit', 'invoices', 'delete', false),
  ('Arsanit', 'invoices', 'approve', false),
  ('Arsanit', 'invoices', 'export', false),
  ('Client', 'invoices', 'view', false),
  ('Client', 'invoices', 'create', false),
  ('Client', 'invoices', 'edit', false),
  ('Client', 'invoices', 'delete', false),
  ('Client', 'invoices', 'approve', false),
  ('Client', 'invoices', 'export', false),
  ('Subcontractor', 'invoices', 'view', false),
  ('Subcontractor', 'invoices', 'create', false),
  ('Subcontractor', 'invoices', 'edit', false),
  ('Subcontractor', 'invoices', 'delete', false),
  ('Subcontractor', 'invoices', 'approve', false),
  ('Subcontractor', 'invoices', 'export', false)
ON CONFLICT (role, module, action) DO NOTHING;
