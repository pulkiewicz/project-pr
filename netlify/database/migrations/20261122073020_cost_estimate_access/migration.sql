-- Kosztorys: dostęp tylko dla osób z listy `costEstimate.access` (jak Plan finansowy; decyzja 22.11.2026).
-- Lista startowa = osoby z dostępem do Finansów (`invoices.access`) o roli Admin / Envcheck wewnętrzny,
-- żeby po wdrożeniu nikt z nich nie stracił dostępu. Dalej zmienia ją Admin w Ustawieniach.
INSERT INTO app_settings (key, value)
SELECT 'costEstimate.access', jsonb_build_object('userIds', coalesce((
  SELECT jsonb_agg(u.id ORDER BY u.name)
  FROM users u
  WHERE u.deleted_at IS NULL AND u.role IN ('Admin', 'EnvcheckInternal')
    AND u.id::text IN (SELECT jsonb_array_elements_text(s.value -> 'userIds') FROM app_settings s WHERE s.key = 'invoices.access')
), '[]'::jsonb))
ON CONFLICT (key) DO NOTHING;
