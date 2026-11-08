CREATE TABLE "finance_fixed_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"start_month" text NOT NULL,
	"end_month" text,
	"project_id" uuid,
	"cost_category_id" uuid,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "finance_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"project_id" uuid,
	"cost_category_id" uuid,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "finance_plan_items_month_idx" ON "finance_plan_items" ("month");--> statement-breakpoint
ALTER TABLE "finance_fixed_costs" ADD CONSTRAINT "finance_fixed_costs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "finance_fixed_costs" ADD CONSTRAINT "finance_fixed_costs_cost_category_id_cost_categories_id_fkey" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "finance_plan_items" ADD CONSTRAINT "finance_plan_items_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "finance_plan_items" ADD CONSTRAINT "finance_plan_items_cost_category_id_cost_categories_id_fkey" FOREIGN KEY ("cost_category_id") REFERENCES "cost_categories"("id") ON DELETE SET NULL;