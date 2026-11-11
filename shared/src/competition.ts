import { z } from 'zod'

/** Analiza konkurencji (krok 4a wyceny, opcjonalny): AI szuka w sieci produktów konkurencji spełniających parametry wyceny. */

/** Zgodność produktu z kryteriami wyceny. */
export const COMPETITION_MATCHES = ['full', 'partial', 'none'] as const
export type CompetitionMatch = (typeof COMPETITION_MATCHES)[number]

export interface CompetitionProduct {
  manufacturer: string
  model: string
  /** Strona produktu / karta katalogowa. */
  url: string | null
  match: CompetitionMatch
  /** Kluczowe parametry produktu (zakres temperatur, wilgotności, objętość, wymiary, dynamika). */
  specs: string
  /** Odstępstwa od kryteriów (czego nie spełnia lub czego nie udało się potwierdzić). */
  deviations: string | null
  /** Cena katalogowa / ofertowa; null — nie znaleziono. */
  price: number | null
  currency: string | null
  /** true — cena netto, false — brutto, null — nieznane. */
  priceNet: boolean | null
  /** Skąd cena (sklep, przetarg, cennik) i jak pewna; szacunki wyraźnie oznaczone. */
  priceNote: string | null
  priceUrl: string | null
  confidence: 'low' | 'medium' | 'high'
}

export interface CompetitionResult {
  /** Kryteria użyte do wyszukiwania (z checklisty i parametrów wyceny). */
  criteria: string[]
  summary: string
  products: CompetitionProduct[]
  generatedAt: string
  /** Nazwa pliku wytycznych użytych w analizie. */
  guidelinesFile: string | null
}

/** Wytyczne analizy konkurencji — jeden plik Markdown wspólny dla wszystkich wycen. */
export interface CompetitionGuidelinesDto {
  markdown: string
  fileName: string
  /** true — wytyczne domyślne (nikt jeszcze nie wczytał ani nie zapisał własnych). */
  isDefault: boolean
  updatedAt: string | null
  updatedByName: string | null
}

export const COMPETITION_GUIDELINES_MAX = 50_000
export const competitionGuidelinesInput = z.object({
  markdown: z.string().trim().min(1).max(COMPETITION_GUIDELINES_MAX),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/\.(md|markdown|txt)$/i, 'validation.markdownFile'),
})

export const DEFAULT_COMPETITION_GUIDELINES = `# Wytyczne analizy konkurencji

## Cel
Znaleźć produkty konkurencji (komory klimatyczne, temperaturowe, walk-in), które spełniają parametry wyceny, i ustalić ich ceny — jako punkt odniesienia dla ceny Envcheck.

## Gdzie szukać
- Producenci: Weiss Technik, Binder, Memmert, ESPEC, Vötsch, CTS, Angelantoni (ACS), Thermotron, Climats, Kambič, Pol-Eko.
- Ceny: sklepy i dystrybutorzy laboratoryjni, cenniki producentów, rozstrzygnięcia przetargów publicznych (BZP, TED, platformy zakupowe uczelni i jednostek badawczych).

## Zasady
- Do 8 produktów, najlepiej dopasowane najpierw.
- Produkt „spełnia”, gdy pokrywa wszystkie kluczowe parametry (zakres temperatur, wilgotności, objętość / wymiary wewnętrzne, dynamika zmian). Brak danych = „częściowo”, z opisem, czego nie potwierdzono.
- Ceny tylko ze źródeł — podaj link. Szacunek oznacz wyraźnie jako szacunek i wskaż podstawę.
- Waluta jak w źródle; zaznacz, czy cena jest netto czy brutto.
- Pomijaj produkty wycofane ze sprzedaży.
`
