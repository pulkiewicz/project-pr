CREATE TYPE "avization_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "id_doc_type" AS ENUM('id_card', 'passport');--> statement-breakpoint
CREATE TYPE "vehicle_type" AS ENUM('car', 'van', 'truck', 'hds', 'crane');--> statement-breakpoint
CREATE TABLE "avization_persons" (
	"avization_id" uuid,
	"person_id" uuid,
	CONSTRAINT "avization_persons_pkey" PRIMARY KEY("avization_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "avization_vehicles" (
	"avization_id" uuid,
	"vehicle_id" uuid,
	"driver_person_id" uuid,
	CONSTRAINT "avization_vehicles_pkey" PRIMARY KEY("avization_id","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "avizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"entry_point_id" uuid,
	"purpose" text NOT NULL,
	"hrf_task_id" uuid,
	"weekly_item_id" uuid,
	"status" "avization_status" DEFAULT 'draft'::"avization_status" NOT NULL,
	"party" text NOT NULL,
	"requested_by" uuid,
	"sent_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"external_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "entry_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"id_doc_type" "id_doc_type" NOT NULL,
	"id_doc_number_enc" text NOT NULL,
	"id_doc_key_id" text NOT NULL,
	"id_doc_number_hmac" text NOT NULL,
	"company" text NOT NULL,
	"subcontractor_id" uuid,
	"phone" text,
	"role_on_site" text,
	"notes" text,
	"party" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"registration_number_enc" text NOT NULL,
	"registration_number_hmac" text NOT NULL,
	"key_id" text NOT NULL,
	"make_model" text,
	"vehicle_type" "vehicle_type" DEFAULT 'car'::"vehicle_type" NOT NULL,
	"company" text NOT NULL,
	"default_driver_id" uuid,
	"party" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "avization_persons_person_idx" ON "avization_persons" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "avizations_number_idx" ON "avizations" ("project_id","number");--> statement-breakpoint
CREATE INDEX "avizations_dates_idx" ON "avizations" ("project_id","date_from","date_to");--> statement-breakpoint
CREATE INDEX "persons_project_idx" ON "persons" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_doc_hmac_idx" ON "persons" ("project_id","id_doc_number_hmac") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_reg_hmac_idx" ON "vehicles" ("project_id","registration_number_hmac") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "avization_persons" ADD CONSTRAINT "avization_persons_avization_id_avizations_id_fkey" FOREIGN KEY ("avization_id") REFERENCES "avizations"("id");--> statement-breakpoint
ALTER TABLE "avization_persons" ADD CONSTRAINT "avization_persons_person_id_persons_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id");--> statement-breakpoint
ALTER TABLE "avization_vehicles" ADD CONSTRAINT "avization_vehicles_avization_id_avizations_id_fkey" FOREIGN KEY ("avization_id") REFERENCES "avizations"("id");--> statement-breakpoint
ALTER TABLE "avization_vehicles" ADD CONSTRAINT "avization_vehicles_vehicle_id_vehicles_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id");--> statement-breakpoint
ALTER TABLE "avization_vehicles" ADD CONSTRAINT "avization_vehicles_driver_person_id_persons_id_fkey" FOREIGN KEY ("driver_person_id") REFERENCES "persons"("id");--> statement-breakpoint
ALTER TABLE "avizations" ADD CONSTRAINT "avizations_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "avizations" ADD CONSTRAINT "avizations_entry_point_id_entry_points_id_fkey" FOREIGN KEY ("entry_point_id") REFERENCES "entry_points"("id");--> statement-breakpoint
ALTER TABLE "avizations" ADD CONSTRAINT "avizations_hrf_task_id_hrf_tasks_id_fkey" FOREIGN KEY ("hrf_task_id") REFERENCES "hrf_tasks"("id");--> statement-breakpoint
ALTER TABLE "avizations" ADD CONSTRAINT "avizations_weekly_item_id_weekly_items_id_fkey" FOREIGN KEY ("weekly_item_id") REFERENCES "weekly_items"("id");--> statement-breakpoint
ALTER TABLE "avizations" ADD CONSTRAINT "avizations_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "avizations" ADD CONSTRAINT "avizations_decided_by_users_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "entry_points" ADD CONSTRAINT "entry_points_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_default_driver_id_persons_id_fkey" FOREIGN KEY ("default_driver_id") REFERENCES "persons"("id");