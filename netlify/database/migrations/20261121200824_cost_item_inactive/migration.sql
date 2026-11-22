-- Kosztorys: dezaktywacja pozycji (zostaje na liście, prognoza 0, obowiązkowy powód).
ALTER TABLE "cost_estimate_items" ADD COLUMN "inactive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_estimate_items" ADD COLUMN "inactive_reason" text;