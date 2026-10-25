-- Moduł „Dokumenty” (repozytorium Google Shared Drive) wycofany 25.10.2026 — pliki podpina się linkiem w zadaniach HRF.
-- Usuwane są tylko wpisy macierzy uprawnień; tabele drive_*, folder_acl, record_links, pending_uploads,
-- drive_sync_state i job_runs zostają z ewentualnymi danymi (bez użycia przez aplikację).
DELETE FROM permissions WHERE module = 'documents';
