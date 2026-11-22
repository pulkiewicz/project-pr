-- Kosztorys: komentarze do pozycji (historia z autorem i datą).
CREATE TABLE "cost_estimate_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "cost_estimate_comments_item_idx" ON "cost_estimate_comments" ("item_id");--> statement-breakpoint
ALTER TABLE "cost_estimate_comments" ADD CONSTRAINT "cost_estimate_comments_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "cost_estimate_comments" ADD CONSTRAINT "cost_estimate_comments_item_id_cost_estimate_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cost_estimate_items"("id");