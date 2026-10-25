import { z } from 'zod'

/** Kategorie katalogu komponentów (D4: budowany w aplikacji — z wycen i ręcznie). */
export const COMPONENT_CATEGORIES = ['compressor', 'evaporator', 'condenser', 'heat_exchanger', 'valve', 'controller', 'sensor', 'door_window', 'humidification', 'fan', 'heater', 'other'] as const
export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number]

const optText = (max: number) => z.string().trim().max(max).nullable().optional()

export const componentInput = z.object({
  category: z.enum(COMPONENT_CATEGORIES),
  name: z.string().trim().min(1).max(300),
  manufacturer: optText(200),
  partNo: optText(100),
  supplier: optText(200),
  unit: optText(20),
  /** Cena netto PLN; wymaga `quotesCost:edit`. */
  price: z.number().min(0).max(1e10).nullable().optional(),
  priceDate: z.iso.date().nullable().optional(),
  /** Wydajność [W] — dla sprężarek/parowników/skraplaczy (dobór z kalkulatora). */
  capacityW: z.number().min(0).max(1e8).nullable().optional(),
  /** Temperatura odparowania [°C], przy której podano wydajność. */
  evapTempC: z.number().min(-150).max(100).nullable().optional(),
  refrigerant: optText(50),
  notes: optText(5000),
})
export type ComponentInput = z.input<typeof componentInput>
export const componentPatch = componentInput.partial().extend({ version: z.number().int() })

export interface ComponentDto {
  id: string
  category: ComponentCategory
  name: string
  manufacturer: string | null
  partNo: string | null
  supplier: string | null
  unit: string | null
  /** Null bez `quotesCost:view`. */
  price: number | null
  priceDate: string | null
  /** Cena starsza niż próg z ustawień wycen (miesiące). */
  priceStale: boolean
  capacityW: number | null
  evapTempC: number | null
  refrigerant: string | null
  notes: string | null
  version: number
  updatedAt: string
}

/** Domyślny próg „cena nieaktualna” (miesiące). */
export const DEFAULT_PRICE_MAX_AGE_MONTHS = 12

export function isPriceStale(priceDate: string | null, today: string, maxAgeMonths: number): boolean {
  if (!priceDate) return true
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const limit = new Date(Date.UTC(y, m - 1 - maxAgeMonths, d)).toISOString().slice(0, 10)
  return priceDate < limit
}
