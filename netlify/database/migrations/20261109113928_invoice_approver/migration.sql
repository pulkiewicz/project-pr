ALTER TABLE "cost_invoices" ADD COLUMN "approver_id" uuid;--> statement-breakpoint
CREATE INDEX "cost_invoices_approver_idx" ON "cost_invoices" ("approver_id","status");--> statement-breakpoint
ALTER TABLE "cost_invoices" ADD CONSTRAINT "cost_invoices_approver_id_users_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id");