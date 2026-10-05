import type { AclLevel } from '#shared'

const E = 'role:EnvcheckInternal'
const A = 'role:Arsanit'
const C = 'role:Client'

export interface FolderSpec {
  name: string
  /** undefined = dziedziczy; {} = jawnie tylko Admin. */
  acl?: Record<string, AclLevel>
  children?: FolderSpec[]
  /** Generator podfolderów z danych projektu (np. punkty odbioru z HRF). */
  dynamic?: 'stage1Tasks' | 'acceptancePoints'
}

const shared = { [E]: 'write', [A]: 'write', [C]: 'read' } as const
const consortium = { [E]: 'write', [A]: 'write' } as const

/** Struktura zatwierdzona przez Admina 05.10.2026 (spec. M7 + podfoldery modułów). */
export const ROOT_NAME = 'PIT-RADWAR_4500010164'
export const ROOT_ACL: Record<string, AclLevel> = { [E]: 'read', [A]: 'read', [C]: 'read' }
export const STRUCTURE: FolderSpec[] = [
  { name: '00_Szablony', acl: { [E]: 'write', [A]: 'read' } },
  { name: '01_Umowa_i_aneksy', acl: { [E]: 'write' }, children: [{ name: 'Umowa' }, { name: 'Aneksy' }, { name: 'Umowa_konsorcjum' }] },
  { name: '02_HRF_i_harmonogramy', acl: shared, children: [{ name: 'Rewizje_HRF' }, { name: 'Wydruki_Gantt' }] },
  { name: '03_Projekt_i_dokumentacja_techniczna', acl: shared, dynamic: 'stage1Tasks', children: [{ name: 'Karty_katalogowe_DTR' }] },
  { name: '04_Uzgodnienia_i_decyzje', acl: shared },
  { name: '05_Korespondencja_formalna', acl: consortium, children: [{ name: 'Przychodzaca' }, { name: 'Wychodzaca' }] },
  { name: '06_Protokoly_odbioru', acl: shared, dynamic: 'acceptancePoints' },
  {
    name: '07_Spotkania',
    acl: shared,
    children: [{ name: 'Wspolne_z_Zamawiajacym' }, { name: 'Konsorcjum', acl: consortium }, { name: 'Wewnetrzne', acl: { [E]: 'write' } }],
  },
  { name: '08_Podwykonawcy', acl: shared },
  { name: '09_Zakupy_i_dostawy', acl: consortium },
  { name: '10_BHP_i_awizacje', acl: shared, children: [{ name: 'Listy_awizacyjne' }, { name: 'Szkolenia_BHP' }] },
  {
    name: '11_Dokumentacja_odbiorowa',
    acl: shared,
    children: ['DTR', 'Deklaracje_zgodnosci', 'Atesty_certyfikaty', 'Protokoly_prob', 'Pomiary_elektryczne', 'F-gaz', 'Powykonawcza'].map((name) => ({ name })),
  },
  { name: '12_Raporty_tygodniowe', acl: shared },
  { name: '98_Eksporty', acl: {} },
  { name: '99_Wewnetrzne_Envcheck', acl: { [E]: 'write' } },
  { name: '99_Backup', acl: {} },
]

/** Bezpieczna nazwa folderu z kodu i nazwy zadania HRF: „1.1_Przygotowanie_projektu_dla_prac…”. */
export function folderNameFor(code: string, name: string): string {
  const clean = name
    .replace(/\(.*?\)/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  return `${code}_${clean}`.slice(0, 80).replace(/_+$/, '')
}

/** Ścieżki folderów automatycznego archiwizowania. */
export const AUTO_FOLDERS = {
  hrfRevisions: '/02_HRF_i_harmonogramy/Rewizje_HRF',
  ganttPrints: '/02_HRF_i_harmonogramy/Wydruki_Gantt',
  avizationLists: '/10_BHP_i_awizacje/Listy_awizacyjne',
  templates: '/00_Szablony',
} as const
