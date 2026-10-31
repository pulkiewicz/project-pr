-- Wycofanie przypomnień e-mail (decyzja 31.10.2026). Migracja 20261031104239_task_reminders zostaje w repozytorium,
-- bo mogła już zostać zastosowana — usunięcie zastosowanej migracji blokuje wdrożenia.
ALTER TABLE "users" DROP COLUMN "task_reminders";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "task_reminders_sent_on";