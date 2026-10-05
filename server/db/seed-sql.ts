import { ROLES, defaultPermissionEntries } from '#shared'

/** Stały identyfikator projektu PIT-RADWAR (seed). */
export const SEED_PROJECT_ID = '6f1c2a3e-0000-4000-8000-000000000001'

/**
 * Seed: wyłącznie wartości z sekcji 2 specyfikacji. Dzień „0” pozostaje pusty (ustawia Admin).
 */
export function buildSeedSql(): string {
  const project = `INSERT INTO projects (id, name, client, contract_no, procurement_no, contract_value, contract_end_date, day_zero_date, settings)
VALUES ('${SEED_PROJECT_ID}', 'Stacja badań klimatycznych — bud. XIXa, Kobyłka', 'PIT-RADWAR S.A.', '4500010164', 'ZZ-024886', 36062120.00, '2027-11-15', NULL,
  '{"consortium":{"leader":{"name":"Envcheck Sp. z o.o.","nip":"9512591569","krs":"0001098577"},"partner":{"name":"Arsanit Sp. z o.o."}}}'::jsonb)
ON CONFLICT (id) DO NOTHING;`

  const values = defaultPermissionEntries()
    .map((e) => `('${e.role}', '${e.module}', '${e.action}', ${e.allowed})`)
    .join(',\n  ')
  const perms = `INSERT INTO permissions (role, module, action, allowed) VALUES
  ${values}
ON CONFLICT (role, module, action) DO NOTHING;`

  const mfa = `INSERT INTO app_settings (key, value) VALUES ('mfa.requiredRoles', '${JSON.stringify(ROLES)}'::jsonb)
ON CONFLICT (key) DO NOTHING;`

  return `-- Wygenerowane przez scripts/generate-permissions-seed.ts — nie edytować ręcznie.\n${project}--> statement-breakpoint\n${perms}--> statement-breakpoint\n${mfa}\n`
}
