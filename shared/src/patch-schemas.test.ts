import { describe, expect, it } from 'vitest'
import { purchaseItemInput, purchaseItemPatch } from './purchases.ts'
import { vehicleInput, vehiclePatch } from './avizations.ts'
import { weeklyItemInput, weeklyItemPatch } from './weekly.ts'

// Zod 4: `.partial()` zachowuje `.default()` — PATCH nie może wstrzykiwać wartości domyślnych.
describe('schematy PATCH bez wartości domyślnych', () => {
  it.each([
    ['purchaseItemPatch', purchaseItemPatch],
    ['vehiclePatch', vehiclePatch],
    ['weeklyItemPatch', weeklyItemPatch],
  ])('%s: { version } → { version }', (_, schema) => {
    expect(schema.parse({ version: 1 })).toEqual({ version: 1 })
  })

  it('schematy tworzenia nadal uzupełniają domyślne', () => {
    expect(purchaseItemInput.parse({ name: 'X', party: 'Envcheck' })).toMatchObject({ status: 'to_inquire', isCritical: false, requiresAvization: false })
    expect(vehicleInput.parse({ registrationNumber: 'WW1', company: 'E' })).toMatchObject({ vehicleType: 'car' })
    expect(weeklyItemInput.parse({ isoWeek: '2026-W41', title: 'X', party: 'Envcheck' })).toMatchObject({ status: 'plan', plannedDays: 0 })
  })
})
