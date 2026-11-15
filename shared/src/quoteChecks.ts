import type { BomIssue } from './bom.ts'
import { normalizeText } from './bom.ts'
import type { QuoteInfo, QuoteParams, QuoteSettings, QuoteStep } from './quotes.ts'
import type { SpecValue } from './spec.ts'

/**
 * Wyceny v2 (W1, W2, W4, W5) — walidatory wyceny jako alerty przypisane do kroków: zasilanie, certyfikaty, termin,
 * gwarancja, wymiary, tryb custom, budżet, rynek, bufor kar, krytyczne pytania. Błędy blokują zatwierdzenie
 * (do akceptacji z uzasadnieniem), ostrzeżenia tylko informują.
 */

export interface Dims {
  w: number
  h: number
  d: number
}

const SQRT3 = Math.sqrt(3)
const VOLTAGE = 400
const r1 = (n: number) => Math.round(n * 10) / 10

/** Moc [kW] z prądu 3 × 400 V (cos φ ≈ 1 — jak w ocenie Kamila: 29 A ≈ 20 kW). */
export const ampsToKw = (a: number) => r1((SQRT3 * VOLTAGE * a) / 1000)
export const kwToAmps = (kw: number) => r1((kw * 1000) / (SQRT3 * VOLTAGE))

export interface PowerBalance {
  limitA: number
  limitKw: number
  socketsA: number
  machineKw: number
  machineA: number
  needA: number
  ok: boolean
}

/** Bilans zasilania: przydział ≥ gniazda dodatkowe + moc maszyny (W1). */
export function powerBalance(info: QuoteInfo): PowerBalance | null {
  if (info.powerLimitA == null || info.machinePowerKw == null) return null
  const socketsA = info.socketsCurrentA ?? 0
  const machineA = kwToAmps(info.machinePowerKw)
  const needA = r1(socketsA + machineA)
  return { limitA: info.powerLimitA, limitKw: ampsToKw(info.powerLimitA), socketsA, machineKw: info.machinePowerKw, machineA, needA, ok: info.powerLimitA >= needA }
}

/** Wymagany przekrój przyłącza (najbliższe typowe zabezpieczenie ≥ potrzeba). */
export function suggestedBreakerA(needA: number) {
  return [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250].find((a) => a >= needA) ?? Math.ceil(needA)
}

export type ChecklistMap = Map<string, { label: string; value: SpecValue | null }>

const num = (v: SpecValue | null | undefined) => (v && 'n' in v ? v.n : null)
const range = (v: SpecValue | null | undefined) => (v && 'min' in v ? v : null)
const text = (v: SpecValue | null | undefined) => (!v ? '' : 't' in v ? v.t : 'v' in v ? v.v : 'b' in v ? (v.b ? 'tak' : '') : 'n' in v ? String(v.n) : '')

export const FLAG_IPX = 'Wykonanie zewnętrzne (IPX)'
export const FLAG_SHELTER = 'Shelter / przestrzeń robocza zewnętrzna'

/** W2 — tryb wyceny: custom (inżynieryjna), gdy parametry wychodzą poza standard rynkowy. */
export function quoteMode(checklist: ChecklistMap, flags: string[]): { custom: boolean; reasons: string[] } {
  const reasons: string[] = []
  const f = new Set(flags.map(normalizeText))
  if (f.has(normalizeText(FLAG_IPX))) reasons.push('wykonanie zewnętrzne / IPX')
  if (f.has(normalizeText(FLAG_SHELTER))) reasons.push('shelter / przestrzeń robocza zewnętrzna')
  if (['material_inner', 'material_outer'].some((k) => text(checklist.get(k)?.value).includes('316'))) reasons.push('stal 316')
  const rate = num(checklist.get('rate')?.value)
  if (rate != null && rate > 1) reasons.push(`dynamika ${rate} K/min > 1 K/min`)
  const t = range(checklist.get('temp_range')?.value)
  if (t?.min != null && t.min < -45) reasons.push(`Tmin ${t.min} °C < −45 °C`)
  if (text(checklist.get('heat_compensation')?.value).trim()) reasons.push('kompensacja ciepła próbki')
  return { custom: reasons.length > 0, reasons }
}

export type CoolingTech = 'single' | 'two_stage' | 'cascade'
/** W2 — dobór technologii chłodniczej z dolnej temperatury (drzewo decyzyjne z wytycznych). */
export function suggestTechnology(tMin: number | null | undefined): { primary: CoolingTech; alternative: CoolingTech | null } | null {
  if (tMin == null) return null
  if (tMin > -20) return { primary: 'single', alternative: null }
  if (tMin >= -45) return { primary: 'two_stage', alternative: 'cascade' }
  if (tMin >= -50) return { primary: 'cascade', alternative: 'two_stage' }
  return { primary: 'cascade', alternative: null }
}

export interface LayoutCheck {
  outer: Dims
  limit: Dims | null
  /** Wolne miejsce na chłodnictwo/maszynownię: limit − (wnętrze + 2 × ściana). */
  free: Dims | null
  over: { w: boolean; h: boolean; d: boolean }
}

/** W2 — clash detection: wymiary zewnętrzne z wnętrza, ścian, ramy, maszynowni i agregatu na dachu vs limit z SWZ. */
export function layoutCheck(inner: Dims | null, info: QuoteInfo): LayoutCheck | null {
  const l = info.layout ?? {}
  if (!inner || l.wallMm == null) return null
  const wall = l.wallMm
  const outer = {
    w: inner.w + 2 * wall + (l.serviceMm ?? 0),
    h: inner.h + 2 * wall + (l.frameMm ?? 0) + (l.roofUnitMm ?? 0),
    d: inner.d + 2 * wall + (l.machineRoomMm ?? 0),
  }
  const limit = info.outerMaxMm ?? null
  const free = limit ? { w: limit.w - inner.w - 2 * wall, h: limit.h - inner.h - 2 * wall, d: limit.d - inner.d - 2 * wall } : null
  return { outer, limit, free, over: { w: !!limit && outer.w > limit.w, h: !!limit && outer.h > limit.h, d: !!limit && outer.d > limit.d } }
}

/** W2 — szacunkowa masa blach komory [kg]: wnętrze (nierdzewka 1,5 mm) + poszycie (1,0 mm), gęstość 7900 kg/m³. */
export function shellMassKg(inner: Dims, wallMm = 150): number {
  const area = (d: Dims) => (2 * (d.w * d.h + d.w * d.d + d.h * d.d)) / 1e6
  const outer = { w: inner.w + 2 * wallMm, h: inner.h + 2 * wallMm, d: inner.d + 2 * wallMm }
  return Math.round(area(inner) * 0.0015 * 7900 + area(outer) * 0.001 * 7900)
}

export interface QuoteChecksInput {
  info: QuoteInfo
  params: QuoteParams
  settings: Pick<QuoteSettings, 'blockedCerts' | 'standardLeadDays' | 'customMarginMin'>
  /** Cena końcowa (z ceną ręczną), null gdy brak pozycji. */
  net: number | null
  gross: number | null
  checklist: ChecklistMap
  flags: string[]
  calcs: { name: string; mode: 'cooling' | 'heating'; requiredKw: number; loadsW: number }[]
  inner: Dims | null
  /** Ceny konkurencji w PLN (netto) z kroku 4a. */
  competitionPln: number[]
  criticalOpenQuestions: string[]
}

const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)
const pln = (n: number) => `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(n)} zł`

function issue(id: string, step: QuoteStep, severity: 'error' | 'warning', title: string, description: string, question: string | null = null): BomIssue {
  return { key: `check:${id}`, kind: 'check', ruleId: null, step, severity, title, description, triggers: [], section: null, keywords: [], suggestion: null, exceptionLabel: null, lines: [], question, ack: null }
}

/** Alerty walidatorów wyceny (bez akceptacji — uzupełnia je serwer). */
export function quoteChecks(x: QuoteChecksInput): BomIssue[] {
  const out: BomIssue[] = []
  const { info, params } = x

  // ---- W1: zasilanie ----
  const p = powerBalance(info)
  if (p && !p.ok) {
    const breaker = suggestedBreakerA(p.needA)
    out.push(
      issue(
        'power',
        'formal',
        'error',
        'Zasilanie: przydział mocy za mały',
        `Przydział ${fmt(p.limitA)} A (≈ ${fmt(p.limitKw)} kW) < gniazda ${fmt(p.socketsA)} A + maszyna ${fmt(p.machineKw)} kW (≈ ${fmt(p.machineA)} A) = ${fmt(p.needA)} A. Urządzenia nie da się uruchomić — potrzebne przyłącze min. ${breaker} A.`,
        `Prosimy o wyjaśnienie treści SWZ w zakresie zasilania. Zamawiający wskazuje przydział mocy ${fmt(p.limitA)} A (ok. ${fmt(p.limitKw)} kW przy 3 × 400 V), a jednocześnie wymaga gniazd dodatkowych o łącznym prądzie ${fmt(p.socketsA)} A. Urządzenie spełniające wymagania OPZ (chłodzenie, grzanie, nawilżanie, automatyka) ma szczytowy pobór mocy ok. ${fmt(p.machineKw)} kW. Czy Zamawiający zapewni przyłącze o zabezpieczeniu min. ${breaker} A, czy dopuszcza ograniczenie mocy urządzenia kosztem parametrów dynamicznych?`,
      ),
    )
  } else if (info.powerLimitA != null && info.machinePowerKw == null) {
    out.push(issue('power_unknown', 'formal', 'warning', 'Zasilanie: brak szacunku mocy maszyny', `Podano przydział ${fmt(info.powerLimitA)} A (≈ ${fmt(ampsToKw(info.powerLimitA))} kW) — wpisz szacowaną moc szczytową maszyny, aby sprawdzić bilans.`))
  }

  // ---- W1: certyfikaty ----
  const blocked = new Set(x.settings.blockedCerts.map(normalizeText))
  const bad = (info.requiredCerts ?? []).filter((c) => blocked.has(normalizeText(c)))
  if (bad.length)
    out.push(
      issue('certs', 'formal', 'error', `Wymagany certyfikat poza zakresem firmy: ${bad.join(', ')}`, 'Odrzuć zapytanie albo zleć audyt / certyfikację zewnętrzną i ujmij jej koszt.', `Czy Zamawiający dopuszcza urządzenie bez certyfikatu ${bad.join(', ')} lub z równoważnym potwierdzeniem zgodności?`),
    )

  // ---- W1: termin realizacji ----
  if (info.deliveryDays != null && x.settings.standardLeadDays != null && info.deliveryDays < x.settings.standardLeadDays)
    out.push(issue('lead_time', 'formal', 'warning', 'Termin realizacji krótszy niż standardowy', `SWZ: ${info.deliveryDays} dni, standard Envcheck: ${x.settings.standardLeadDays} dni — sprawdź obciążenie produkcji i ryzyko kar.`))

  // ---- W1/W4: gwarancja ----
  if (info.minWarrantyMonths != null && params.warrantyMonths < info.minWarrantyMonths)
    out.push(issue('warranty_min', 'summary', 'error', 'Gwarancja poniżej minimum z SWZ', `Oferta: ${params.warrantyMonths} mies., SWZ wymaga min. ${info.minWarrantyMonths} mies.`))
  else if (info.scoredWarrantyMonths != null && (info.warrantyWeight ?? 0) > 0 && params.warrantyMonths < info.scoredWarrantyMonths)
    out.push(issue('warranty_points', 'summary', 'warning', 'Gwarancja nie daje maksimum punktów', `Max punktów za ${info.scoredWarrantyMonths} mies. (waga ${info.warrantyWeight}%), oferta: ${params.warrantyMonths} mies. Dłuższa gwarancja podnosi rezerwę gwarancyjną.`))

  // ---- W2: wymiary ----
  const lay = layoutCheck(x.inner, info)
  if (lay && (lay.over.w || lay.over.h || lay.over.d)) {
    const dims = (['w', 'h', 'd'] as const).filter((k) => lay.over[k]).map((k) => `${{ w: 'szerokość', h: 'wysokość', d: 'głębokość' }[k]} ${fmt(lay.outer[k])} > ${fmt(lay.limit![k])} mm`)
    out.push(issue('dims', 'calc', 'error', 'Komora z technologią nie mieści się w limicie wymiarów', dims.join('; '), `Czy Zamawiający dopuszcza posadowienie agregatu / chillera obok lub za komorą (poza obrysem ${fmt(lay.limit!.w)} × ${fmt(lay.limit!.h)} × ${fmt(lay.limit!.d)} mm)?`))
  }

  // ---- W2: twarde wymogi do bilansu cieplnego ----
  if (text(x.checklist.get('heat_compensation')?.value).trim() && !x.calcs.some((c) => c.mode === 'cooling' && c.loadsW > 0))
    out.push(issue('heat_comp', 'calc', 'warning', 'Kompensacja ciepła próbki nie jest w bilansie', `SWZ: „${text(x.checklist.get('heat_compensation')?.value)}” — dodaj w kalkulatorze chłodzenia obciążenie od próbki (ciepło aktywne).`))
  const rate = num(x.checklist.get('rate')?.value)
  if (rate != null && rate > 1 && !text(x.checklist.get('rate_standard')?.value).trim())
    out.push(
      issue(
        'rate_definition',
        'questions',
        'warning',
        'Definicja szybkości zmian temperatury',
        `Wymagane ${fmt(rate)} K/min bez wskazania normy — dla masy wsadu moc chłodnicza rośnie drastycznie.`,
        `Czy wymagana szybkość zmian temperatury ${fmt(rate)} K/min dotyczy powietrza w pustej komorze (wg PN-EN IEC 60068-3-5), czy temperatury wsadu (jakiej masy i z jakiego materiału)?`,
      ),
    )

  // ---- W2: marża dla custom ----
  const mode = quoteMode(x.checklist, x.flags)
  if (mode.custom && params.marginMultiplier < x.settings.customMarginMin)
    out.push(issue('custom_margin', 'pricing', 'warning', 'Marża poniżej minimum dla wyceny custom', `Tryb custom (${mode.reasons.join(', ')}): mnożnik ${fmt(params.marginMultiplier)} < ${fmt(x.settings.customMarginMin)}.`))

  // ---- W4: bufor kar, budżet, rynek ----
  if ((info.penaltyPctPerDay ?? 0) > 0 && !(params.delayDays && params.delayDays > 0))
    out.push(issue('penalty_buffer', 'summary', 'warning', 'Brak bufora na kary umowne', `SWZ: kara ${fmt((info.penaltyPctPerDay ?? 0) * 100)}% dziennie — wpisz szacowane dni opóźnienia w parametrach ceny (np. 14).`))
  if (info.budget != null && x.gross != null && x.gross > info.budget)
    out.push(issue('budget', 'summary', 'warning', 'Cena powyżej budżetu zamawiającego', `Brutto ${pln(x.gross)} > budżet ${pln(info.budget)} (różnica ${pln(x.gross - info.budget)}).`))
  if (x.net != null && x.competitionPln.length) {
    const max = Math.max(...x.competitionPln)
    if (x.net > max) out.push(issue('market', 'summary', 'warning', 'Cena powyżej cen konkurencji', `Netto ${pln(x.net)} > najdroższy produkt z analizy konkurencji (${pln(max)}).`))
  }

  // ---- W5: pytania krytyczne ----
  if (x.criticalOpenQuestions.length)
    out.push(issue('critical_questions', 'questions', 'error', 'Krytyczne pytania bez odpowiedzi', x.criticalOpenQuestions.map((q) => `• ${q.length > 160 ? `${q.slice(0, 160)}…` : q}`).join('\n')))

  return out
}
