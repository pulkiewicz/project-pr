-- Osobne wiersze macierzy uprawnień: „Do akceptacji” (invoiceApprovals) i „Plan finansowy” (financePlan).
-- Wcześniej obie zakładki miały uprawnienia modułu Koszty (invoices) — kopiujemy aktualne wpisy każdej roli
-- (z ewentualnymi zmianami Admina), więc po wdrożeniu dostęp się nie zmienia.
INSERT INTO permissions (role, module, action, allowed)
SELECT role, 'invoiceApprovals', action, allowed FROM permissions WHERE module = 'invoices'
ON CONFLICT (role, module, action) DO NOTHING;--> statement-breakpoint
INSERT INTO permissions (role, module, action, allowed)
SELECT role, 'financePlan', action, allowed FROM permissions WHERE module = 'invoices'
ON CONFLICT (role, module, action) DO NOTHING;
