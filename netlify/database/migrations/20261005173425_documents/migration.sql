CREATE TYPE "acl_level" AS ENUM('none', 'read', 'write', 'manage');--> statement-breakpoint
CREATE TYPE "doc_status" AS ENUM('draft', 'review', 'approved', 'obsolete');--> statement-breakpoint
CREATE TYPE "link_target" AS ENUM('hrf_task', 'purchase_item', 'avization', 'weekly_item');--> statement-breakpoint
CREATE TABLE "drive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"drive_file_id" text NOT NULL,
	"folder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint,
	"drive_version" text,
	"md5" text,
	"modified_at" timestamp with time zone,
	"web_view_link" text,
	"category" text,
	"status" "doc_status" DEFAULT 'draft'::"doc_status" NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"uploaded_by" uuid,
	"synced_at" timestamp with time zone,
	"trashed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"drive_folder_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_sync_state" (
	"project_id" uuid PRIMARY KEY,
	"page_token" text,
	"last_run_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "folder_acl" (
	"folder_id" uuid,
	"subject" text,
	"level" "acl_level" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "folder_acl_pkey" PRIMARY KEY("folder_id","subject")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"job" text,
	"run_key" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"details" jsonb,
	CONSTRAINT "job_runs_pkey" PRIMARY KEY("job","run_key")
);
--> statement-breakpoint
CREATE TABLE "pending_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"session_uri_hash" text NOT NULL,
	"link" jsonb,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"file_id" uuid NOT NULL,
	"target_type" "link_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drive_files_drive_id_idx" ON "drive_files" ("project_id","drive_file_id");--> statement-breakpoint
CREATE INDEX "drive_files_folder_idx" ON "drive_files" ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_folders_drive_id_idx" ON "drive_folders" ("project_id","drive_folder_id");--> statement-breakpoint
CREATE INDEX "drive_folders_parent_idx" ON "drive_folders" ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_uniq_idx" ON "record_links" ("file_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "record_links_target_idx" ON "record_links" ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_folder_id_drive_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "drive_folders"("id");--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_uploaded_by_users_id_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "drive_sync_state" ADD CONSTRAINT "drive_sync_state_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "folder_acl" ADD CONSTRAINT "folder_acl_folder_id_drive_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "drive_folders"("id");--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_folder_id_drive_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "drive_folders"("id");--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_file_id_drive_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "drive_files"("id");