CREATE TYPE "crm_activity_kind" AS ENUM('note', 'call', 'email', 'meeting', 'stage_change');--> statement-breakpoint
CREATE TYPE "opportunity_stage" AS ENUM('new', 'quoting', 'submitted', 'won', 'lost', 'on_hold');--> statement-breakpoint
CREATE TYPE "opportunity_type" AS ENUM('public_tender', 'private_inquiry', 'modernization', 'service', 'other');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"nip" text,
	"regon" text,
	"address" text,
	"website" text,
	"industry" text,
	"notes" text,
	"owner_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"email" text,
	"phone" text,
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
CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"opportunity_id" uuid NOT NULL,
	"kind" "crm_activity_kind" NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stage" "opportunity_stage" DEFAULT 'new'::"opportunity_stage" NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"owner_id" uuid,
	"type" "opportunity_type",
	"source" text,
	"value" numeric(14,2),
	"submission_deadline" date,
	"decision_date" date,
	"next_step" text,
	"next_step_date" date,
	"link" text,
	"notes" text,
	"loss_reason" text,
	"project_id" uuid,
	"stage_changed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "opportunity_code_seq" (
	"prefix" text PRIMARY KEY,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_nip_uq" ON "companies" ("nip") WHERE "deleted_at" IS NULL AND "nip" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" (lower("name"));--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" ("company_id");--> statement-breakpoint
CREATE INDEX "crm_activities_opportunity_idx" ON "crm_activities" ("opportunity_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_code_uq" ON "opportunities" (lower("code"));--> statement-breakpoint
CREATE INDEX "opportunities_stage_idx" ON "opportunities" ("stage");--> statement-breakpoint
CREATE INDEX "opportunities_company_idx" ON "opportunities" ("company_id");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id");--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_opportunity_id_opportunities_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id");--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");