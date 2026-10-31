-- Ewidencja czasu pracy przeniesiona z workload-calendar (plan docs/PLAN_CZAS_PRACY.md, etap T1).
-- Uprawnienie `timesheets`: rola (Admin, Envcheck wewnętrzny) otwiera możliwość, o dostępie decyduje lista `timesheets.access`.
CREATE TABLE "timesheet_employees" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"employee_id" text,
	"work_date" date,
	"mode" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"break_min" integer DEFAULT 0 NOT NULL,
	"hours" numeric(5,2) DEFAULT '0' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY("employee_id","work_date")
);
--> statement-breakpoint
CREATE INDEX "timesheet_entries_date_idx" ON "timesheet_entries" ("work_date");--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_employee_id_timesheet_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "timesheet_employees"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO permissions (role, module, action, allowed) VALUES
  ('Admin', 'timesheets', 'view', true),
  ('Admin', 'timesheets', 'create', true),
  ('Admin', 'timesheets', 'edit', true),
  ('Admin', 'timesheets', 'delete', true),
  ('Admin', 'timesheets', 'approve', true),
  ('Admin', 'timesheets', 'export', true),
  ('EnvcheckInternal', 'timesheets', 'view', true),
  ('EnvcheckInternal', 'timesheets', 'create', true),
  ('EnvcheckInternal', 'timesheets', 'edit', true),
  ('EnvcheckInternal', 'timesheets', 'delete', true),
  ('EnvcheckInternal', 'timesheets', 'approve', true),
  ('EnvcheckInternal', 'timesheets', 'export', true),
  ('Arsanit', 'timesheets', 'view', false),
  ('Arsanit', 'timesheets', 'create', false),
  ('Arsanit', 'timesheets', 'edit', false),
  ('Arsanit', 'timesheets', 'delete', false),
  ('Arsanit', 'timesheets', 'approve', false),
  ('Arsanit', 'timesheets', 'export', false),
  ('Client', 'timesheets', 'view', false),
  ('Client', 'timesheets', 'create', false),
  ('Client', 'timesheets', 'edit', false),
  ('Client', 'timesheets', 'delete', false),
  ('Client', 'timesheets', 'approve', false),
  ('Client', 'timesheets', 'export', false),
  ('Subcontractor', 'timesheets', 'view', false),
  ('Subcontractor', 'timesheets', 'create', false),
  ('Subcontractor', 'timesheets', 'edit', false),
  ('Subcontractor', 'timesheets', 'delete', false),
  ('Subcontractor', 'timesheets', 'approve', false),
  ('Subcontractor', 'timesheets', 'export', false)
ON CONFLICT (role, module, action) DO NOTHING;
