-- Nowa rola „Accounting”. Netlify uruchamia oczekujące migracje w jednej transakcji, a wartości dodanej przez
-- ALTER TYPE … ADD VALUE nie można użyć przed jej zatwierdzeniem („unsafe use of new value”) — dlatego enum jest
-- odtwarzany: wartości typu utworzonego przez CREATE TYPE są dostępne od razu w tej samej transakcji.
ALTER TYPE "role" RENAME TO "role_old";--> statement-breakpoint
CREATE TYPE "role" AS ENUM('Admin', 'EnvcheckInternal', 'Arsanit', 'Client', 'Subcontractor', 'Accounting');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" TYPE "role" USING "role"::text::"role";--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "role" TYPE "role" USING "role"::text::"role";--> statement-breakpoint
DROP TYPE "role_old";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_basis" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_amount" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_student" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "student_until" date;