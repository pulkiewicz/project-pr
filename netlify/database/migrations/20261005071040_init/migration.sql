CREATE TYPE "role" AS ENUM('Admin', 'EnvcheckInternal', 'Arsanit', 'Client', 'Subcontractor');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"ip" text,
	"user_agent" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"changes" jsonb,
	"project_id" uuid
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" bigserial PRIMARY KEY,
	"user_id" uuid,
	"kind" text NOT NULL,
	"success" boolean NOT NULL,
	"ip" inet,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"role" "role",
	"module" text,
	"action" text,
	"allowed" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "permissions_pkey" PRIMARY KEY("role","module","action")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"client" text NOT NULL,
	"contract_no" text NOT NULL,
	"procurement_no" text NOT NULL,
	"contract_value" numeric(14,2),
	"contract_end_date" date NOT NULL,
	"day_zero_date" date,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identity_sub" text UNIQUE,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"party" text NOT NULL,
	"role" "role" NOT NULL,
	"subcontractor_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"totp_secret_enc" text,
	"totp_pending_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"recovery_codes_hash" jsonb,
	"invited_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX "audit_log_ts_idx" ON "audit_log" ("ts");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" ("user_id","ts");--> statement-breakpoint
CREATE INDEX "auth_attempts_user_kind_idx" ON "auth_attempts" ("user_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));