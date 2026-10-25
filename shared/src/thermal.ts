import { z } from 'zod'

/**
 * Kalkulator mocy chłodniczej / grzewczej wg arkusza OF022 „Ciepło właściwe V2”.
 * Masa termiczna: P [W] = c [J/(kg·K)] × m [kg] × tempo [K/min] / 60 (w arkuszu kolumna „kW” zawiera W).
 * Do tego obciążenia stałe [W] i przenikanie przez ściany U × A × ΔT (decyzja E1) z możliwością nadpisania.
 */
export const CALC_MODES = ['cooling', 'heating'] as const
export type CalcMode = (typeof CALC_MODES)[number]

/** Ciepło właściwe [J/(kg·K)] — słownik z arkusza OF022, rozszerzalny w wierszu („własne c”). */
export const SPECIFIC_HEAT = {
  aluminium: 920,
  steel: 460,
  stainless: 482,
  water: 4200,
  wool: 1300,
  glass: 600,
} as const
export type MaterialKey = keyof typeof SPECIFIC_HEAT

/** Gęstość [kg/m³] do szacowania mas z wymiarów (uzupełnianie z checklisty). */
export const DENSITY = { stainless: 7900, steel: 7850, aluminium: 2700, wool: 100 } as const

const num = (max = 1e9) => z.number().min(0).max(max)

export const massRowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  material: z.enum(Object.keys(SPECIFIC_HEAT) as [MaterialKey, ...MaterialKey[]]).nullable(),
  /** Własne ciepło właściwe; gdy podane — ma pierwszeństwo przed materiałem. */
  specificHeat: num(1e5).nullable(),
  massKg: num(1e6),
  /** Tempo zmian [K/min]; null = tempo globalne kalkulacji. */
  rateKpm: num(100).nullable(),
})
export type MassRow = z.infer<typeof massRowSchema>

export const loadRowSchema = z.object({ name: z.string().trim().min(1).max(100), watts: num(1e7) })
export type LoadRow = z.infer<typeof loadRowSchema>

export const calcInputSchema = z.object({
  mode: z.enum(CALC_MODES),
  /** Tempo zmian temperatury [K/min] (globalne). */
  rateKpm: num(100),
  masses: z.array(massRowSchema).max(50),
  loads: z.array(loadRowSchema).max(50),
  transmission: z.object({
    /** Współczynnik przenikania U [W/(m²·K)]. */
    uValue: num(100).nullable(),
    /** Powierzchnia przegród [m²]; null = z wymiarów zewnętrznych. */
    areaM2: num(1e4).nullable(),
    /** Wymiary wewnętrzne [mm] — do powierzchni (2 × (wh + wd + hd)). */
    dimsMm: z.object({ w: num(1e5), h: num(1e5), d: num(1e5) }).nullable(),
    /** ΔT [K] między wnętrzem (temp. skrajna) a otoczeniem. */
    deltaT: num(500).nullable(),
    /** Nadpisanie wyniku przenikania [W] (np. wartość z arkusza). */
    overrideW: num(1e7).nullable(),
  }),
  /** Współczynnik zapasu dla doboru (E2 — reguła do potwierdzenia przez Kamila); 1 = bez zapasu. */
  safetyFactor: z.number().min(1).max(5),
  notes: z.string().max(5000).nullable(),
})
export type CalcInput = z.infer<typeof calcInputSchema>

export interface CalcResult {
  masses: { name: string; specificHeat: number; watts: number }[]
  massesW: number
  loadsW: number
  areaM2: number | null
  transmissionW: number
  totalW: number
  totalKw: number
  /** Z zapasem: total × safetyFactor. */
  requiredKw: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function surfaceAreaM2(d: { w: number; h: number; d: number }): number {
  const w = d.w / 1000
  const h = d.h / 1000
  const dd = d.d / 1000
  return Math.round(2 * (w * h + w * dd + h * dd) * 100) / 100
}

export function computeCalc(input: CalcInput): CalcResult {
  const masses = input.masses.map((m) => {
    const c = m.specificHeat ?? (m.material ? SPECIFIC_HEAT[m.material] : 0)
    return { name: m.name, specificHeat: c, watts: r1((c * m.massKg * (m.rateKpm ?? input.rateKpm)) / 60) }
  })
  const massesW = r1(masses.reduce((a, m) => a + m.watts, 0))
  const loadsW = r1(input.loads.reduce((a, l) => a + l.watts, 0))
  const t = input.transmission
  const areaM2 = t.areaM2 ?? (t.dimsMm ? surfaceAreaM2(t.dimsMm) : null)
  const transmissionW = t.overrideW ?? (t.uValue != null && areaM2 != null && t.deltaT != null ? r1(t.uValue * areaM2 * t.deltaT) : 0)
  const totalW = r1(massesW + loadsW + transmissionW)
  return { masses, massesW, loadsW, areaM2, transmissionW, totalW, totalKw: Math.round(totalW) / 1000, requiredKw: Math.round(totalW * input.safetyFactor) / 1000 }
}

/** Przykład z arkusza OF022 (nagrzewnica EP TECH) — 12 870 W; używany jako szablon nowej kalkulacji. */
export const OF022_EXAMPLE: CalcInput = {
  mode: 'heating',
  rateKpm: 3,
  masses: [
    { name: 'Wsad', material: 'steel', specificHeat: null, massKg: 10, rateKpm: null },
    { name: 'Wymienniki i aluminium', material: 'aluminium', specificHeat: null, massKg: 30, rateKpm: null },
    { name: 'Woda', material: 'water', specificHeat: null, massKg: 2, rateKpm: null },
    { name: 'Izolacja (PIR)', material: 'wool', specificHeat: null, massKg: 15, rateKpm: null },
    { name: 'Szkło', material: 'glass', specificHeat: null, massKg: 20, rateKpm: null },
    { name: 'Obudowa ściany', material: 'stainless', specificHeat: null, massKg: 150, rateKpm: null },
  ],
  loads: [
    { name: 'Grzałki', watts: 150 },
    { name: 'Wsad (moc własna próbki)', watts: 0 },
    { name: 'Wentylacja', watts: 3000 },
    { name: 'Mostki cieplne', watts: 1000 },
    { name: 'Wyposażenie', watts: 0 },
    { name: 'Rezerwa', watts: 1000 },
  ],
  transmission: { uValue: null, areaM2: null, dimsMm: null, deltaT: null, overrideW: 500 },
  safetyFactor: 1,
  notes: 'Przykład z arkusza OF022 (nagrzewnica dla EP TECH). W arkuszu wynik zaokrąglony do „14 kW”.',
}

export const EMPTY_CALC: CalcInput = {
  mode: 'cooling',
  rateKpm: 1,
  masses: [
    { name: 'Wsad (próbka)', material: 'aluminium', specificHeat: null, massKg: 0, rateKpm: null },
    { name: 'Obudowa wewnętrzna', material: 'stainless', specificHeat: null, massKg: 0, rateKpm: null },
    { name: 'Wymienniki', material: 'aluminium', specificHeat: null, massKg: 0, rateKpm: null },
  ],
  loads: [
    { name: 'Moc własna próbki (kompensacja)', watts: 0 },
    { name: 'Wentylacja', watts: 0 },
    { name: 'Mostki cieplne', watts: 0 },
    { name: 'Rezerwa', watts: 0 },
  ],
  transmission: { uValue: 0.3, areaM2: null, dimsMm: null, deltaT: null, overrideW: null },
  safetyFactor: 1,
  notes: null,
}

export const calcSaveInput = z.object({ name: z.string().trim().min(1).max(200), deviceId: z.uuid().nullable().optional(), input: calcInputSchema })

export interface QuoteCalcDto {
  id: string
  name: string
  deviceId: string | null
  input: CalcInput
  result: CalcResult
  updatedAt: string
  updatedByName: string | null
}
