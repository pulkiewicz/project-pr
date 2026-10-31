-- Codzienne przypomnienia e-mail o przypisanych zadaniach HRF (decyzja 31.10.2026: Resend, digest 7:00 w dni robocze,
-- włączanie/wyłączanie per osoba wyłącznie przez Admina; domyślnie włączone).
ALTER TABLE "users" ADD COLUMN "task_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "task_reminders_sent_on" date;