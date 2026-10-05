CREATE TYPE "hrf_dependency_type" AS ENUM('FS', 'SS', 'FF');--> statement-breakpoint
CREATE TYPE "hrf_status" AS ENUM('not_started', 'in_progress', 'at_risk', 'delayed', 'ready_for_acceptance', 'accepted');--> statement-breakpoint
CREATE TABLE "hrf_baseline_tasks" (
	"baseline_id" uuid,
	"task_id" uuid,
	"start" date,
	"end" date,
	CONSTRAINT "hrf_baseline_tasks_pkey" PRIMARY KEY("baseline_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "hrf_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"day_zero_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "hrf_dependencies" (
	"task_id" uuid,
	"predecessor_id" uuid,
	"type" "hrf_dependency_type" DEFAULT 'FS'::"hrf_dependency_type" NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "hrf_dependencies_pkey" PRIMARY KEY("task_id","predecessor_id")
);
--> statement-breakpoint
CREATE TABLE "hrf_import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "hrf_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"party" text NOT NULL,
	"responsible_user_id" uuid,
	"start_offset_days" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"actual_start" date,
	"actual_end" date,
	"forecast_end" date,
	"percent_complete" numeric(5,2) DEFAULT '0' NOT NULL,
	"status" "hrf_status" DEFAULT 'not_started'::"hrf_status" NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"is_acceptance_point" boolean DEFAULT false NOT NULL,
	"post_acceptance_allowed" boolean DEFAULT false NOT NULL,
	"contract_value" numeric(14,2),
	"is_critical_path" boolean DEFAULT false NOT NULL,
	"total_float_days" integer,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "hrf_dependencies_pred_idx" ON "hrf_dependencies" ("predecessor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hrf_tasks_project_code_idx" ON "hrf_tasks" ("project_id","code") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "hrf_tasks_parent_idx" ON "hrf_tasks" ("parent_id");--> statement-breakpoint
ALTER TABLE "hrf_baseline_tasks" ADD CONSTRAINT "hrf_baseline_tasks_baseline_id_hrf_baselines_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "hrf_baselines"("id");--> statement-breakpoint
ALTER TABLE "hrf_baseline_tasks" ADD CONSTRAINT "hrf_baseline_tasks_task_id_hrf_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
ALTER TABLE "hrf_baselines" ADD CONSTRAINT "hrf_baselines_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "hrf_dependencies" ADD CONSTRAINT "hrf_dependencies_task_id_hrf_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
ALTER TABLE "hrf_dependencies" ADD CONSTRAINT "hrf_dependencies_predecessor_id_hrf_tasks_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
ALTER TABLE "hrf_import_profiles" ADD CONSTRAINT "hrf_import_profiles_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "hrf_tasks" ADD CONSTRAINT "hrf_tasks_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "hrf_tasks" ADD CONSTRAINT "hrf_tasks_responsible_user_id_users_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id");