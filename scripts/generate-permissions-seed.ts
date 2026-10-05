/**
 * Generuje SQL seeda (projekt z sekcji 2 specyfikacji + domyślna macierz uprawnień z shared/permissions.ts).
 * Użycie: npm run db:seed-permissions -- <ścieżka migration.sql>
 * Test `seed.test.ts` pilnuje, by zapisana migracja była zgodna z bieżącą macierzą.
 */
import { writeFileSync } from 'node:fs'
import { buildSeedSql } from '../server/db/seed-sql.ts'

const target = process.argv[2]
if (!target) {
  console.error('Podaj ścieżkę pliku migracji')
  process.exit(1)
}
writeFileSync(target, buildSeedSql())
console.log(`Zapisano ${target}`)
