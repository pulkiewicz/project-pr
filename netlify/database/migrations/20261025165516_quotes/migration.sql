CREATE TYPE "confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "quote_kind" AS ENUM('quote', 'profile');--> statement-breakpoint
CREATE TYPE "quote_line_source" AS ENUM('manual', 'profile', 'previous', 'calculator', 'ai', 'import');--> statement-breakpoint
CREATE TYPE "quote_status" AS ENUM('draft', 'approved', 'sent', 'imported');--> statement-breakpoint
CREATE TABLE "quote_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"quote_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_option" boolean DEFAULT false NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"section_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group" text,
	"quantity" numeric(14,3) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_cost" numeric(14,2),
	"labor_hours" numeric(10,2),
	"labor_rate" numeric(10,2),
	"justification" text,
	"source" "quote_line_source" DEFAULT 'manual'::"quote_line_source" NOT NULL,
	"confidence" "confidence",
	"approved" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" "quote_kind" DEFAULT 'quote'::"quote_kind" NOT NULL,
	"opportunity_id" uuid,
	"revision" text,
	"name" text,
	"description" text,
	"status" "quote_status" DEFAULT 'draft'::"quote_status" NOT NULL,
	"based_on_id" uuid,
	"based_on_label" text,
	"params" jsonb NOT NULL,
	"info" jsonb DEFAULT '{}' NOT NULL,
	"notes" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "quote_devices_quote_idx" ON "quote_devices" ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_lines_section_idx" ON "quote_lines" ("section_id");--> statement-breakpoint
CREATE INDEX "quote_sections_device_idx" ON "quote_sections" ("device_id");--> statement-breakpoint
CREATE INDEX "quotes_opportunity_idx" ON "quotes" ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_revision_uq" ON "quotes" ("opportunity_id","revision") WHERE "deleted_at" IS NULL AND "kind" = 'quote';--> statement-breakpoint
ALTER TABLE "quote_devices" ADD CONSTRAINT "quote_devices_quote_id_quotes_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_section_id_quote_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "quote_sections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_device_id_quote_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "quote_devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_opportunities_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_users_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id");