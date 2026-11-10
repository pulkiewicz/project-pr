ALTER TABLE "employees" ADD COLUMN "billing_name" text;--> statement-breakpoint
-- Nowy wiersz macierzy uprawnień „Koszty pracownicze” (staffCosts): wynagrodzenia imiennie, więc dostęp tylko tam,
-- gdzie rola ma jednocześnie Plan finansowy i Pracowników (z ewentualnymi zmianami Admina).
INSERT INTO permissions (role, module, action, allowed)
SELECT f.role, 'staffCosts', f.action, f.allowed AND e.allowed
FROM permissions f JOIN permissions e ON e.role = f.role AND e.action = f.action AND e.module = 'employees'
WHERE f.module = 'financePlan'
ON CONFLICT (role, module, action) DO NOTHING;
