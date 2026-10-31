-- Zarząd (31.10.2026): ewidencja pojazdów i lista pracowników. Dostęp: rola + lista osób w ustawieniu management.access.
CREATE TABLE "employee_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"valid_until" date,
	"document_url" text,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"position" text,
	"email" text,
	"phone" text,
	"birth_date" date,
	"pesel_enc" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"contract_type" text,
	"contract_start" date,
	"contract_end" date,
	"medical_exam_valid_until" date,
	"bhp_training_valid_until" date,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "fleet_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"vehicle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"performed_date" date,
	"valid_until" date,
	"document_url" text,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_insurances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"vehicle_id" uuid NOT NULL,
	"type" text NOT NULL,
	"insurer" text,
	"policy_number" text,
	"valid_from" date,
	"valid_to" date NOT NULL,
	"policy_url" text,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"registration_number" text NOT NULL,
	"make" text,
	"model" text,
	"kind" text NOT NULL,
	"vin" text,
	"production_year" integer,
	"ownership" text DEFAULT 'owned' NOT NULL,
	"financing_company" text,
	"financing_end_date" date,
	"assigned_employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "employee_qualifications_employee_idx" ON "employee_qualifications" ("employee_id");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "fleet_inspections_vehicle_idx" ON "fleet_inspections" ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fleet_insurances_vehicle_idx" ON "fleet_insurances" ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_vehicles_registration_uq" ON "fleet_vehicles" ("registration_number") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "fleet_inspections" ADD CONSTRAINT "fleet_inspections_vehicle_id_fleet_vehicles_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fleet_insurances" ADD CONSTRAINT "fleet_insurances_vehicle_id_fleet_vehicles_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "fleet_vehicles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_assigned_employee_id_employees_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "employees"("id");
--> statement-breakpoint
INSERT INTO permissions (role, module, action, allowed) VALUES
  ('Admin', 'fleet', 'view', true),
  ('Admin', 'fleet', 'create', true),
  ('Admin', 'fleet', 'edit', true),
  ('Admin', 'fleet', 'delete', true),
  ('Admin', 'fleet', 'approve', true),
  ('Admin', 'fleet', 'export', true),
  ('EnvcheckInternal', 'fleet', 'view', true),
  ('EnvcheckInternal', 'fleet', 'create', true),
  ('EnvcheckInternal', 'fleet', 'edit', true),
  ('EnvcheckInternal', 'fleet', 'delete', true),
  ('EnvcheckInternal', 'fleet', 'approve', true),
  ('EnvcheckInternal', 'fleet', 'export', true),
  ('Arsanit', 'fleet', 'view', false),
  ('Arsanit', 'fleet', 'create', false),
  ('Arsanit', 'fleet', 'edit', false),
  ('Arsanit', 'fleet', 'delete', false),
  ('Arsanit', 'fleet', 'approve', false),
  ('Arsanit', 'fleet', 'export', false),
  ('Client', 'fleet', 'view', false),
  ('Client', 'fleet', 'create', false),
  ('Client', 'fleet', 'edit', false),
  ('Client', 'fleet', 'delete', false),
  ('Client', 'fleet', 'approve', false),
  ('Client', 'fleet', 'export', false),
  ('Subcontractor', 'fleet', 'view', false),
  ('Subcontractor', 'fleet', 'create', false),
  ('Subcontractor', 'fleet', 'edit', false),
  ('Subcontractor', 'fleet', 'delete', false),
  ('Subcontractor', 'fleet', 'approve', false),
  ('Subcontractor', 'fleet', 'export', false),
  ('Admin', 'employees', 'view', true),
  ('Admin', 'employees', 'create', true),
  ('Admin', 'employees', 'edit', true),
  ('Admin', 'employees', 'delete', true),
  ('Admin', 'employees', 'approve', true),
  ('Admin', 'employees', 'export', true),
  ('EnvcheckInternal', 'employees', 'view', true),
  ('EnvcheckInternal', 'employees', 'create', true),
  ('EnvcheckInternal', 'employees', 'edit', true),
  ('EnvcheckInternal', 'employees', 'delete', true),
  ('EnvcheckInternal', 'employees', 'approve', true),
  ('EnvcheckInternal', 'employees', 'export', true),
  ('Arsanit', 'employees', 'view', false),
  ('Arsanit', 'employees', 'create', false),
  ('Arsanit', 'employees', 'edit', false),
  ('Arsanit', 'employees', 'delete', false),
  ('Arsanit', 'employees', 'approve', false),
  ('Arsanit', 'employees', 'export', false),
  ('Client', 'employees', 'view', false),
  ('Client', 'employees', 'create', false),
  ('Client', 'employees', 'edit', false),
  ('Client', 'employees', 'delete', false),
  ('Client', 'employees', 'approve', false),
  ('Client', 'employees', 'export', false),
  ('Subcontractor', 'employees', 'view', false),
  ('Subcontractor', 'employees', 'create', false),
  ('Subcontractor', 'employees', 'edit', false),
  ('Subcontractor', 'employees', 'delete', false),
  ('Subcontractor', 'employees', 'approve', false),
  ('Subcontractor', 'employees', 'export', false)
ON CONFLICT (role, module, action) DO NOTHING;
