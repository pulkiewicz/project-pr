CREATE TABLE "hrf_internal_task_assignees" (
	"task_id" uuid,
	"user_id" uuid,
	CONSTRAINT "hrf_internal_task_assignees_pkey" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hrf_internal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"parent_task_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"percent_complete" smallint DEFAULT 0 NOT NULL,
	"notes" text,
	"link" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "hrf_internal_task_assignees_user_idx" ON "hrf_internal_task_assignees" ("user_id");--> statement-breakpoint
CREATE INDEX "hrf_internal_tasks_parent_idx" ON "hrf_internal_tasks" ("parent_task_id");--> statement-breakpoint
CREATE INDEX "hrf_internal_tasks_project_idx" ON "hrf_internal_tasks" ("project_id");--> statement-breakpoint
ALTER TABLE "hrf_internal_task_assignees" ADD CONSTRAINT "hrf_internal_task_assignees_task_id_hrf_internal_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "hrf_internal_tasks"("id");--> statement-breakpoint
ALTER TABLE "hrf_internal_task_assignees" ADD CONSTRAINT "hrf_internal_task_assignees_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "hrf_internal_tasks" ADD CONSTRAINT "hrf_internal_tasks_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "hrf_internal_tasks" ADD CONSTRAINT "hrf_internal_tasks_parent_task_id_hrf_tasks_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
-- Uprawnienia nowego modułu hrfInternal (domyślna macierz).
INSERT INTO permissions (role, module, action, allowed) VALUES
  ('Admin', 'hrfInternal', 'view', true),
  ('Admin', 'hrfInternal', 'create', true),
  ('Admin', 'hrfInternal', 'edit', true),
  ('Admin', 'hrfInternal', 'delete', true),
  ('Admin', 'hrfInternal', 'approve', true),
  ('Admin', 'hrfInternal', 'export', true),
  ('EnvcheckInternal', 'hrfInternal', 'view', true),
  ('EnvcheckInternal', 'hrfInternal', 'create', true),
  ('EnvcheckInternal', 'hrfInternal', 'edit', true),
  ('EnvcheckInternal', 'hrfInternal', 'delete', true),
  ('EnvcheckInternal', 'hrfInternal', 'approve', true),
  ('EnvcheckInternal', 'hrfInternal', 'export', true),
  ('Arsanit', 'hrfInternal', 'view', false),
  ('Arsanit', 'hrfInternal', 'create', false),
  ('Arsanit', 'hrfInternal', 'edit', false),
  ('Arsanit', 'hrfInternal', 'delete', false),
  ('Arsanit', 'hrfInternal', 'approve', false),
  ('Arsanit', 'hrfInternal', 'export', false),
  ('Client', 'hrfInternal', 'view', false),
  ('Client', 'hrfInternal', 'create', false),
  ('Client', 'hrfInternal', 'edit', false),
  ('Client', 'hrfInternal', 'delete', false),
  ('Client', 'hrfInternal', 'approve', false),
  ('Client', 'hrfInternal', 'export', false),
  ('Subcontractor', 'hrfInternal', 'view', false),
  ('Subcontractor', 'hrfInternal', 'create', false),
  ('Subcontractor', 'hrfInternal', 'edit', false),
  ('Subcontractor', 'hrfInternal', 'delete', false),
  ('Subcontractor', 'hrfInternal', 'approve', false),
  ('Subcontractor', 'hrfInternal', 'export', false)
ON CONFLICT (role, module, action) DO NOTHING;
