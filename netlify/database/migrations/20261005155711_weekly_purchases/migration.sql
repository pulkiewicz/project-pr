CREATE TYPE "purchase_status" AS ENUM('to_inquire', 'inquiry_sent', 'offer', 'ordered', 'confirmed', 'in_transit', 'delivered', 'quality_accepted', 'complaint');--> statement-breakpoint
CREATE TYPE "weekly_status" AS ENUM('plan', 'in_progress', 'done', 'moved', 'cancelled');--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"manufacturer" text,
	"part_no" text,
	"quantity" numeric(14,3),
	"unit" text,
	"supplier_name" text,
	"supplier_contact" text,
	"party" text NOT NULL,
	"hrf_task_id" uuid,
	"buffer_days" integer,
	"lead_time_weeks" numeric(6,1),
	"inquiry_date" date,
	"order_date_planned" date,
	"order_date_actual" date,
	"order_ref" text,
	"confirmed_delivery_date" date,
	"actual_delivery_date" date,
	"status" "purchase_status" DEFAULT 'to_inquire'::"purchase_status" NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"delivery_location" text,
	"requires_avization" boolean DEFAULT false NOT NULL,
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
CREATE TABLE "weekly_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"iso_week" text NOT NULL,
	"hrf_task_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"party" text NOT NULL,
	"assignee_user_id" uuid,
	"assignee_subcontractor_id" uuid,
	"planned_days" smallint DEFAULT 0 NOT NULL,
	"status" "weekly_status" DEFAULT 'plan'::"weekly_status" NOT NULL,
	"carry_over_from_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "purchase_items_project_idx" ON "purchase_items" ("project_id");--> statement-breakpoint
CREATE INDEX "purchase_items_task_idx" ON "purchase_items" ("hrf_task_id");--> statement-breakpoint
CREATE INDEX "weekly_items_week_idx" ON "weekly_items" ("project_id","iso_week");--> statement-breakpoint
CREATE INDEX "weekly_items_assignee_idx" ON "weekly_items" ("assignee_user_id");--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_hrf_task_id_hrf_tasks_id_fkey" FOREIGN KEY ("hrf_task_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
ALTER TABLE "weekly_items" ADD CONSTRAINT "weekly_items_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "weekly_items" ADD CONSTRAINT "weekly_items_hrf_task_id_hrf_tasks_id_fkey" FOREIGN KEY ("hrf_task_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
ALTER TABLE "weekly_items" ADD CONSTRAINT "weekly_items_assignee_user_id_users_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id");