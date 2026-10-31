-- Kwota netto zamówienia w planie zakupów (decyzja Admina 31.10.2026, wyjątek od spec. §1).
-- Widoczność i edycja: nowe uprawnienie purchasesCost — Admin i Envcheck wewnętrzny, bez ról zewnętrznych.
ALTER TABLE "purchase_items" ADD COLUMN "net_amount" numeric(14,2);
--> statement-breakpoint
INSERT INTO permissions (role, module, action, allowed) VALUES
  ('Admin', 'purchasesCost', 'view', true),
  ('Admin', 'purchasesCost', 'create', true),
  ('Admin', 'purchasesCost', 'edit', true),
  ('Admin', 'purchasesCost', 'delete', true),
  ('Admin', 'purchasesCost', 'approve', true),
  ('Admin', 'purchasesCost', 'export', true),
  ('EnvcheckInternal', 'purchasesCost', 'view', true),
  ('EnvcheckInternal', 'purchasesCost', 'create', true),
  ('EnvcheckInternal', 'purchasesCost', 'edit', true),
  ('EnvcheckInternal', 'purchasesCost', 'delete', false),
  ('EnvcheckInternal', 'purchasesCost', 'approve', false),
  ('EnvcheckInternal', 'purchasesCost', 'export', true),
  ('Arsanit', 'purchasesCost', 'view', false),
  ('Arsanit', 'purchasesCost', 'create', false),
  ('Arsanit', 'purchasesCost', 'edit', false),
  ('Arsanit', 'purchasesCost', 'delete', false),
  ('Arsanit', 'purchasesCost', 'approve', false),
  ('Arsanit', 'purchasesCost', 'export', false),
  ('Client', 'purchasesCost', 'view', false),
  ('Client', 'purchasesCost', 'create', false),
  ('Client', 'purchasesCost', 'edit', false),
  ('Client', 'purchasesCost', 'delete', false),
  ('Client', 'purchasesCost', 'approve', false),
  ('Client', 'purchasesCost', 'export', false),
  ('Subcontractor', 'purchasesCost', 'view', false),
  ('Subcontractor', 'purchasesCost', 'create', false),
  ('Subcontractor', 'purchasesCost', 'edit', false),
  ('Subcontractor', 'purchasesCost', 'delete', false),
  ('Subcontractor', 'purchasesCost', 'approve', false),
  ('Subcontractor', 'purchasesCost', 'export', false)
ON CONFLICT (role, module, action) DO NOTHING;
