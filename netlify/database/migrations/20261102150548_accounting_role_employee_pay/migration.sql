ALTER TYPE "role" ADD VALUE 'Accounting';--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_basis" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_amount" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_student" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "student_until" date;