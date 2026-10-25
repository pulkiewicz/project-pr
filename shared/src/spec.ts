import { z } from 'zod'

/** Typ wartości pozycji listy specyfikacyjnej (krok 3 wyceny). */
export const SPEC_TYPES = ['text', 'number', 'range', 'dims', 'choice', 'bool'] as const
export type SpecType = (typeof SPEC_TYPES)[number]

export const specItemDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
  group: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  type: z.enum(SPEC_TYPES),
  unit: z.string().max(20).nullable().optional(),
  options: z.array(z.string().max(100)).max(30).nullable().optional(),
  help: z.string().max(500).nullable().optional(),
})
export type SpecItemDef = z.infer<typeof specItemDefSchema>

export const specListInput = z.object({ items: z.array(specItemDefSchema).min(1).max(300), notes: z.string().max(2000).nullable().optional() }).refine(
  (v) => new Set(v.items.map((i) => i.key)).size === v.items.length,
  { message: 'validation.specKeysUnique', path: ['items'] },
)

/** Wartość zależnie od typu: tekst, liczba, zakres, wymiary [mm], wybór, tak/nie. */
export const specValueSchema = z.union([
  z.object({ t: z.string().max(5000) }),
  z.object({ n: z.number() }),
  z.object({ min: z.number().nullable(), max: z.number().nullable() }),
  z.object({ w: z.number().min(0), h: z.number().min(0), d: z.number().min(0) }),
  z.object({ v: z.string().max(100) }),
  z.object({ b: z.boolean() }),
])
export type SpecValue = z.infer<typeof specValueSchema>

/**
 * pending — do uzupełnienia / potwierdzenia; confirmed — potwierdzone (OK);
 * missing — brak w materiałach (trafi do pytań w R4); na — nie dotyczy.
 */
export const CHECKLIST_STATUSES = ['pending', 'confirmed', 'missing', 'na'] as const
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number]

export const checklistItemInput = z.object({
  value: specValueSchema.nullable().optional(),
  status: z.enum(CHECKLIST_STATUSES).optional(),
  note: z.string().max(2000).nullable().optional(),
  /** Cytat / miejsce w SIWZ (w R4 wypełnia AI). */
  sourceRef: z.string().max(2000).nullable().optional(),
})
export type ChecklistItemInput = z.input<typeof checklistItemInput>

export const customRequirementInput = z.object({
  label: z.string().trim().min(1).max(500),
  group: z.string().trim().max(100).nullable().optional(),
  value: z.string().max(5000).nullable().optional(),
})

export interface ChecklistItemDto {
  key: string
  group: string
  label: string
  type: SpecType
  unit: string | null
  options: string[] | null
  help: string | null
  /** Wymaganie spoza listy standardowej (dopisane do wyceny). */
  custom: boolean
  value: SpecValue | null
  status: ChecklistStatus
  note: string | null
  sourceRef: string | null
  updatedAt: string | null
  updatedByName: string | null
}

export interface ChecklistDto {
  specVersion: number
  items: ChecklistItemDto[]
  progress: { confirmed: number; missing: number; na: number; pending: number; total: number }
}

export interface SpecListDto {
  id: string
  version: number
  items: SpecItemDef[]
  notes: string | null
  createdAt: string
  createdByName: string | null
}

export function formatSpecValue(v: SpecValue | null, unit?: string | null): string {
  if (!v) return ''
  const u = unit ? ` ${unit}` : ''
  if ('t' in v) return v.t
  if ('n' in v) return `${v.n}${u}`
  if ('min' in v) return `${v.min ?? '…'} … ${v.max ?? '…'}${u}`
  if ('w' in v) return `${v.w} × ${v.h} × ${v.d} mm`
  if ('v' in v) return v.v
  return v.b ? 'tak' : 'nie'
}

const i = (group: string, key: string, label: string, type: SpecType, extra: Partial<SpecItemDef> = {}): SpecItemDef => ({ key, group, label, type, unit: null, options: null, help: null, ...extra })

/** Lista specyfikacyjna v1 — z planu §5 (na podstawie OF033 i OF036). Edytowalna w Bazie wiedzy (nowa wersja). */
export const DEFAULT_SPEC_ITEMS: SpecItemDef[] = [
  i('Ogólne', 'devices_count', 'Liczba urządzeń', 'number', { unit: 'szt.' }),
  i('Ogólne', 'chamber_type', 'Typ urządzenia', 'choice', { options: ['komora klimatyczna', 'komora temperaturowa', 'komora grzewcza', 'walk-in', 'szok termiczny', 'inne'] }),
  i('Ogólne', 'delivery_place', 'Miejsce dostawy', 'text'),
  i('Ogólne', 'delivery_term', 'Termin dostawy', 'text'),
  i('Ogólne', 'warranty_months', 'Okres gwarancji', 'number', { unit: 'mies.' }),
  i('Ogólne', 'participation', 'Warunki udziału', 'text'),
  i('Ogólne', 'criteria', 'Kryteria oceny i wagi', 'text'),
  i('Ogólne', 'budget', 'Budżet zamawiającego', 'number', { unit: 'PLN' }),
  i('Przestrzeń robocza', 'inner_dims', 'Wymiary wewnętrzne (min.)', 'dims', { help: 'szerokość × wysokość × głębokość' }),
  i('Przestrzeń robocza', 'inner_dims_rec', 'Wymiary wewnętrzne (rekomendowane)', 'dims'),
  i('Przestrzeń robocza', 'volume', 'Objętość robocza', 'number', { unit: 'l' }),
  i('Przestrzeń robocza', 'floor_load', 'Nośność podłogi', 'number', { unit: 'kg/m²' }),
  i('Przestrzeń robocza', 'sample_mass', 'Masa próbki (z uchwytem)', 'number', { unit: 'kg' }),
  i('Przestrzeń robocza', 'sample_material', 'Materiał próbki', 'choice', { options: ['aluminium', 'stal', 'stal nierdzewna', 'tworzywo', 'elektronika', 'inne'] }),
  i('Przestrzeń robocza', 'mounting', 'Mocowania / stelaż', 'text'),
  i('Temperatura', 'temp_range', 'Zakres temperatur', 'range', { unit: '°C' }),
  i('Temperatura', 'rate', 'Prędkość zmian temperatury', 'number', { unit: 'K/min' }),
  i('Temperatura', 'rate_standard', 'Norma (np. PN-EN IEC 60068-3-5)', 'text'),
  i('Temperatura', 'temp_stability', 'Stabilność czasowa', 'number', { unit: '±K' }),
  i('Temperatura', 'temp_uniformity', 'Jednorodność przestrzenna', 'number', { unit: '±K' }),
  i('Temperatura', 'temp_resolution', 'Rozdzielczość', 'number', { unit: 'K' }),
  i('Temperatura', 'heat_compensation', 'Kompensacja cieplna próbki', 'text', { help: 'np. 5 kW @ −20 °C; 1,5 kW @ −50 °C' }),
  i('Wilgotność', 'humidity_range', 'Zakres wilgotności', 'range', { unit: '%RH' }),
  i('Wilgotność', 'humidity_temp_range', 'Zakres temperatur dla wilgotności', 'range', { unit: '°C' }),
  i('Wilgotność', 'humidity_stability', 'Stabilność wilgotności', 'text', { unit: '%RH' }),
  i('Wilgotność', 'humidity_uniformity', 'Jednorodność wilgotności', 'number', { unit: '±%RH' }),
  i('Wilgotność', 'humidification', 'Nawilżanie (typ)', 'text'),
  i('Wilgotność', 'dehumidification', 'Osuszanie', 'text'),
  i('Wilgotność', 'demineralization', 'Demineralizacja (typ, autonomia)', 'text'),
  i('Wilgotność', 'humidity_sensor', 'Czujnik wilgotności (klasa)', 'text'),
  i('Obudowa', 'material_inner', 'Materiał wnętrza', 'choice', { options: ['stal nierdzewna 304', 'stal nierdzewna 316', 'inne'] }),
  i('Obudowa', 'material_outer', 'Materiał obudowy zewnętrznej', 'choice', { options: ['stal nierdzewna 304', 'stal malowana', 'inne'] }),
  i('Obudowa', 'insulation', 'Izolacja (typ, wymienność)', 'text'),
  i('Obudowa', 'panels', 'Panele', 'choice', { options: ['spawane', 'prefabrykowane', 'inne'] }),
  i('Obudowa', 'onsite_assembly', 'Montaż na miejscu (prefabrykaty)', 'bool'),
  i('Obudowa', 'door', 'Drzwi (typ, światło)', 'text'),
  i('Obudowa', 'window', 'Okno (wielkość, ogrzewane)', 'text'),
  i('Obudowa', 'ports', 'Przepusty (liczba × średnica)', 'text'),
  i('Obudowa', 'seals', 'Uszczelnienia', 'text'),
  i('Obudowa', 'decompression', 'Kanał dekompresyjny / klapa', 'bool'),
  i('Obudowa', 'base_wheels', 'Podstawa i koła', 'bool'),
  i('Układ chłodzenia', 'cooling_type', 'Typ układu', 'choice', { options: ['bezpośrednie odparowanie', 'kaskada', 'chiller', 'glikol', 'inne'] }),
  i('Układ chłodzenia', 'refrigerants', 'Czynniki chłodnicze', 'text'),
  i('Układ chłodzenia', 'flammable_refrigerants', 'Czynniki palne dopuszczalne', 'bool'),
  i('Układ chłodzenia', 'modulation', 'Modulacja 0–100% / inwerter', 'bool'),
  i('Układ chłodzenia', 'heat_rejection', 'Zrzut ciepła', 'choice', { options: ['powietrze', 'woda', 'zewnętrzny (chiller)', 'inne'] }),
  i('Układ chłodzenia', 'machine_room', 'Maszynownia', 'text'),
  i('Układ chłodzenia', 'leak_detection', 'Detekcja ulotu czynnika', 'bool'),
  i('Grzanie i przepływ', 'heating_modulation', 'Modulacja grzania 0–100%', 'bool'),
  i('Grzanie i przepływ', 'fans', 'Wentylatory (inwerter, prędkość)', 'text'),
  i('Grzanie i przepływ', 'laminar_flow', 'Przepływ laminarny', 'bool'),
  i('Grzanie i przepływ', 'condensation_protection', 'Ochrona przed kondensacją', 'bool'),
  i('Automatyka', 'plc_hmi', 'PLC + HMI (przekątna, IP)', 'text'),
  i('Automatyka', 'programs', 'Programy (liczba × kroki)', 'text'),
  i('Automatyka', 'protocols', 'Protokoły (Modbus, OPC UA, MQTT, SQL, REST…)', 'text'),
  i('Automatyka', 'remote_access', 'Dostęp zdalny', 'text'),
  i('Automatyka', 'cybersecurity', 'Cyberbezpieczeństwo (CRA, ISO 27001…)', 'text'),
  i('Automatyka', 'language', 'Język obsługi', 'text'),
  i('Automatyka', 'independent_protection', 'Niezależne zabezpieczenie temperatury', 'bool'),
  i('Automatyka', 'ups', 'Zasilanie buforowe (UPS)', 'text'),
  i('Automatyka', 'hour_counters', 'Liczniki godzin pracy', 'bool'),
  i('Bezpieczeństwo', 'li_ion', 'Praca z ogniwami Li-ion / LiPo', 'bool'),
  i('Bezpieczeństwo', 'fire_detection', 'Detekcja pożaru', 'bool'),
  i('Bezpieczeństwo', 'extinguishing', 'Gaszenie (typ)', 'text'),
  i('Bezpieczeństwo', 'emergency_ventilation', 'Awaryjne przewietrzanie', 'bool'),
  i('Bezpieczeństwo', 'gas_measurement', 'Pomiar CO₂ / LZO / PM', 'text'),
  i('Bezpieczeństwo', 'led_lighting', 'Oświetlenie LED', 'bool'),
  i('Pomiary i rejestracja', 'sample_sensors', 'Czujniki próbki (liczba, klasa)', 'text'),
  i('Pomiary i rejestracja', 'cameras', 'Kamery', 'number', { unit: 'szt.' }),
  i('Pomiary i rejestracja', 'thrust_measurement', 'Pomiar ciągu / siły', 'text'),
  i('Pomiary i rejestracja', 'recording', 'Rejestracja parametrów', 'text'),
  i('Usługi', 'transport', 'Transport', 'bool'),
  i('Usługi', 'installation', 'Instalacja', 'bool'),
  i('Usługi', 'commissioning', 'Uruchomienie', 'bool'),
  i('Usługi', 'training', 'Szkolenie (zakres, godziny)', 'text'),
  i('Usługi', 'calibration', 'Kalibracja / wzorcowanie', 'text'),
  i('Usługi', 'accredited_calibration', 'Wzorcowanie akredytowane', 'bool'),
  i('Usługi', 'documentation', 'Dokumentacja (DTR, F-gaz, UDT…)', 'text'),
  i('Usługi', 'post_warranty_service', 'Serwis pogwarancyjny i części', 'text'),
  i('Usługi', 'inspections', 'Przeglądy okresowe (koszt)', 'text'),
]
