// Testy przeniesione z workload-calendar (shared/hours.test.js, node:test) — te same przypadki, uruchamiane przez vitest.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as H from './hours.ts'

// ---------------------------------------------------------------------------
// Liczenie godzin z zakresu od–do
// ---------------------------------------------------------------------------

test('computeRangeHours: prosty zakres bez przerwy', () => {
  assert.equal(H.computeRangeHours('08:00', '16:00', 0), 8)
  assert.equal(H.computeRangeHours('09:15', '17:45', 0), 8.5)
})

test('computeRangeHours: odejmuje przerwę', () => {
  assert.equal(H.computeRangeHours('08:00', '16:30', 30), 8)
  assert.equal(H.computeRangeHours('07:00', '15:00', 45), 7.25)
})

test('computeRangeHours: praca przez północ', () => {
  assert.equal(H.computeRangeHours('22:00', '06:00', 0), 8, '22:00–06:00 to 8 godzin')
  assert.equal(H.computeRangeHours('23:30', '07:30', 60), 7)
  assert.equal(H.computeRangeHours('20:00', '00:00', 0), 4, 'koniec o północy')
})

test('computeRangeHours: wynik zawsze w pełnych kwadransach', () => {
  // 50 minut przerwy trafia na najbliższy kwadrans (45), więc 8 h - 0,75 h = 7,25 h.
  assert.equal(H.computeRangeHours('08:00', '16:00', 50), 7.25)
  // 08:20 przyciąga się do 08:15.
  assert.equal(H.computeRangeHours('08:00', '08:20', 0), 0.25)
  // Każdy wynik jest wielokrotnością 0,25.
  for (const [start, end, pause] of [['07:07', '15:53', 22], ['09:04', '17:11', 38], ['06:38', '14:59', 7]] as const) {
    const hours = H.computeRangeHours(start, end, pause)
    assert.equal(hours * 4, Math.round(hours * 4), `${start}–${end} (przerwa ${pause}) daje ${hours}`)
  }
})

test('roundToQuarter i snapMinutesToQuarter zaokrąglają do 15 minut', () => {
  assert.equal(H.roundToQuarter(7.17), 7.25)
  assert.equal(H.roundToQuarter(7.1), 7)
  assert.equal(H.roundToQuarter(8), 8)
  assert.equal(H.snapMinutesToQuarter(7), 0)
  assert.equal(H.snapMinutesToQuarter(8), 15)
  assert.equal(H.snapMinutesToQuarter(50), 45)
  assert.equal(H.snapMinutesToQuarter(0), 0)
})

test('snapTimeToQuarter przyciąga godzinę do kwadransa', () => {
  assert.equal(H.snapTimeToQuarter('08:00'), '08:00')
  assert.equal(H.snapTimeToQuarter('08:07'), '08:00')
  assert.equal(H.snapTimeToQuarter('08:08'), '08:15')
  assert.equal(H.snapTimeToQuarter('08:53'), '09:00')
  // Zaokrąglenie w górę tuż przed północą przechodzi na 00:00 — przy pracy
  // przez północ liczy się to jako koniec doby, więc wynik pozostaje poprawny.
  assert.equal(H.snapTimeToQuarter('23:53'), '00:00')
  assert.equal(H.computeRangeHours('16:00', '23:53', 0), 8)
})

test('timeToMinutes odrzuca niepoprawne godziny', () => {
  assert.equal(H.timeToMinutes('00:00'), 0)
  assert.equal(H.timeToMinutes('23:59'), 1439)
  assert.throws(() => H.timeToMinutes('24:00'))
  assert.throws(() => H.timeToMinutes('8:00'))
  assert.throws(() => H.timeToMinutes('08:60'))
})

// ---------------------------------------------------------------------------
// Przecinek jako separator dziesiętny
// ---------------------------------------------------------------------------

test('parseHoursInput akceptuje przecinek', () => {
  assert.equal(H.parseHoursInput('7,5'), 7.5)
  assert.equal(H.parseHoursInput('7.5'), 7.5)
  assert.equal(H.parseHoursInput(' 8 '), 8)
  assert.equal(H.parseHoursInput(8.25), 8.25)
})

test('parseHoursInput zwraca null dla pustych i błędnych wartości', () => {
  assert.equal(H.parseHoursInput(''), null)
  assert.equal(H.parseHoursInput('   '), null)
  assert.equal(H.parseHoursInput('abc'), null)
  assert.equal(H.parseHoursInput('7,5,5'), null)
  assert.equal(H.parseHoursInput('-3'), null)
  assert.equal(H.parseHoursInput(null), null)
  assert.equal(H.parseHoursInput(undefined), null)
})

test('formatHours używa przecinka', () => {
  assert.equal(H.formatHours(7.5), '7,5')
  assert.equal(H.formatHours(8), '8')
  assert.equal(H.formatHours(0), '0')
  assert.equal(H.formatHoursShort(7.5), '7,5 h')
  assert.equal(H.formatHoursShort(0), '')
})

// ---------------------------------------------------------------------------
// Walidacja wpisów
// ---------------------------------------------------------------------------

test('validateEntry: tryb range liczy godziny i normalizuje wpis', () => {
  const res = H.validateEntry({ mode: 'range', start: '08:00', end: '16:30', breakMin: 30, note: ' obiad ' })
  assert.equal(res.ok, true)
  assert.equal(res.error, null)
  assert.deepEqual(res.entry, {
    mode: 'range', start: '08:00', end: '16:30', breakMin: 30, hours: 8, note: 'obiad'
  })
})

test('validateEntry: tryb range przez północ', () => {
  const res = H.validateEntry({ mode: 'range', start: '22:00', end: '06:00', breakMin: 0 })
  assert.equal(res.ok, true)
  assert.equal(res.entry!.hours, 8)
})

test('validateEntry: tryb total z przecinkiem', () => {
  const res = H.validateEntry({ mode: 'total', hours: '7,5' })
  assert.equal(res.ok, true)
  assert.equal(res.entry!.hours, 7.5)
  assert.equal(res.entry!.start, null)
  assert.equal(res.entry!.end, null)
})

test('validateEntry: pusty dzień daje entry === null', () => {
  assert.deepEqual(H.validateEntry(null), { ok: true, error: null, entry: null })
  assert.deepEqual(H.validateEntry({ mode: 'range', start: '', end: '', note: '' }).entry, null)
  assert.deepEqual(H.validateEntry({ mode: 'total', hours: '', note: '' }).entry, null)
  assert.deepEqual(H.validateEntry({ mode: 'total', hours: 0, note: '  ' }).entry, null)
})

test('validateEntry: sama uwaga bez godzin zapisuje się jako 0 h', () => {
  const res = H.validateEntry({ mode: 'range', start: '', end: '', note: 'urlop' })
  assert.equal(res.ok, true)
  assert.equal(res.entry!.hours, 0)
  assert.equal(res.entry!.note, 'urlop')
})

test('validateEntry: brakująca godzina zakończenia to błąd', () => {
  const res = H.validateEntry({ mode: 'range', start: '08:00', end: '' })
  assert.equal(res.ok, false)
  assert.equal(res.entry, null)
  assert.match(res.error, /zakończenia/)
})

test('validateEntry: identyczny start i koniec to błąd', () => {
  const res = H.validateEntry({ mode: 'range', start: '08:00', end: '08:00' })
  assert.equal(res.ok, false)
  assert.match(res.error, /różnić/)
})

test('validateEntry: przerwa dłuższa niż czas pracy to błąd', () => {
  const res = H.validateEntry({ mode: 'range', start: '08:00', end: '12:00', breakMin: 300 })
  assert.equal(res.ok, false)
  assert.match(res.error, /Przerwa/)
})

test('validateEntry: przerwa nie może być ujemna ani dłuższa niż doba', () => {
  assert.equal(H.validateEntry({ mode: 'range', start: '08:00', end: '16:00', breakMin: -5 }).ok, false)
  assert.equal(H.validateEntry({ mode: 'range', start: '08:00', end: '16:00', breakMin: 1500 }).ok, false)
})

test('validateEntry przycina godziny i przerwę do kwadransa', () => {
  const res = H.validateEntry({ mode: 'range', start: '08:07', end: '16:38', breakMin: 22 })
  assert.equal(res.ok, true)
  assert.equal(res.entry!.start, '08:00', 'godzina rozpoczęcia zaokrąglona w dół')
  assert.equal(res.entry!.end, '16:45', 'godzina zakończenia zaokrąglona w górę')
  assert.equal(res.entry!.breakMin, 15, 'przerwa zaokrąglona do kwadransa')
  assert.equal(res.entry!.hours, 8.5)
})

test('validateEntry: godziny różniące się o mniej niż kwadrans to ten sam moment', () => {
  const res = H.validateEntry({ mode: 'range', start: '08:02', end: '08:05' })
  assert.equal(res.ok, false)
  assert.match(res.error, /różnić/)
})

test('validateEntry zaokrągla też liczbę godzin ze starego trybu „suma godzin”', () => {
  assert.equal(H.validateEntry({ mode: 'total', hours: '7,4' }).entry!.hours, 7.5)
  assert.equal(H.validateEntry({ mode: 'total', hours: '7,1' }).entry!.hours, 7)
})

test('validateEntry: więcej niż 24 h to błąd', () => {
  const res = H.validateEntry({ mode: 'total', hours: '25' })
  assert.equal(res.ok, false)
  assert.match(res.error, /24/)
})

test('validateEntry: niepoprawny format godziny to błąd', () => {
  assert.equal(H.validateEntry({ mode: 'range', start: '25:00', end: '16:00' }).ok, false)
  assert.equal(H.validateEntry({ mode: 'range', start: '08:00', end: 'abc' }).ok, false)
})

test('validateEntry: zbyt długa uwaga to błąd', () => {
  const res = H.validateEntry({ mode: 'total', hours: '8', note: 'x'.repeat(501) })
  assert.equal(res.ok, false)
  assert.match(res.error, /500/)
})

test('validateEntry: nieznany tryb traktowany jest jak range', () => {
  const res = H.validateEntry({ mode: 'cokolwiek', start: '08:00', end: '16:00' })
  assert.equal(res.ok, true)
  assert.equal(res.entry!.mode, 'range')
})

// ---------------------------------------------------------------------------
// Formularz pracownika (tylko od–do, bez trybu „suma godzin”)
// ---------------------------------------------------------------------------

test('emptyForm to pusty dzień bez godzin', () => {
  assert.deepEqual(H.emptyForm(), { start: '', end: '', breakMin: 0, note: '', legacyHours: 0 })
  assert.equal(H.validateEntry(H.rawFromForm(H.emptyForm())).entry, null)
})

test('rawFromForm zawsze produkuje tryb range', () => {
  const raw = H.rawFromForm({ start: '08:00', end: '16:30', breakMin: 30, note: 'x' })
  assert.equal(raw.mode, 'range')
  const res = H.validateEntry(raw)
  assert.equal(res.ok, true)
  assert.equal(res.entry!.hours, 8)
})

test('rawFromForm liczy pracę przez północ', () => {
  const res = H.validateEntry(H.rawFromForm({ start: '22:00', end: '06:00', breakMin: 0 }))
  assert.equal(res.entry!.hours, 8)
})

test('rawFromForm z samą uwagą zapisuje 0 h', () => {
  const res = H.validateEntry(H.rawFromForm({ start: '', end: '', breakMin: 0, note: 'urlop' }))
  assert.equal(res.ok, true)
  assert.equal(res.entry!.hours, 0)
  assert.equal(res.entry!.note, 'urlop')
})

test('rawFromForm nie kasuje starych wpisów typu „suma godzin”', () => {
  // Dzień zapisany kiedyś jako sama suma: bez godzin od–do wpis ma zostać nietknięty.
  const res = H.validateEntry(H.rawFromForm({ start: '', end: '', breakMin: 0, note: '', legacyHours: 7.5 }))
  assert.equal(res.ok, true)
  assert.equal(res.entry!.hours, 7.5)
  assert.equal(res.entry!.mode, 'total')
})

test('wpisanie godzin od–do zastępuje stary wpis typu „suma godzin”', () => {
  const res = H.validateEntry(H.rawFromForm({ start: '09:00', end: '17:00', breakMin: 0, legacyHours: 7.5 }))
  assert.equal(res.entry!.mode, 'range')
  assert.equal(res.entry!.hours, 8)
})

test('formFromEntry odtwarza formularz z zapisanego wpisu', () => {
  const entry = { mode: 'range', start: '08:00', end: '16:30', breakMin: 30, hours: 8, note: 'obiad' } as const
  assert.deepEqual(H.formFromEntry(entry), {
    start: '08:00', end: '16:30', breakMin: 30, note: 'obiad', legacyHours: 0
  })
  assert.deepEqual(H.formFromEntry(null), H.emptyForm())
})

test('formFromEntry oznacza stary wpis typu „suma godzin”', () => {
  const entry = { mode: 'total', start: null, end: null, breakMin: 0, hours: 7.5, note: '' } as const
  assert.equal(H.formFromEntry(entry).legacyHours, 7.5)
  // Wpis z samą uwagą (0 h) nie jest traktowany jak stary wpis z godzinami.
  const noteOnly = { mode: 'total', start: null, end: null, breakMin: 0, hours: 0, note: 'urlop' } as const
  assert.equal(H.formFromEntry(noteOnly).legacyHours, 0)
})

test('formularz i wpis zamieniają się w obie strony bez straty danych', () => {
  const original = H.validateEntry(H.rawFromForm({ start: '07:15', end: '15:45', breakMin: 45, note: 'a' })).entry
  const roundTrip = H.validateEntry(H.rawFromForm(H.formFromEntry(original))).entry
  assert.deepEqual(roundTrip, original)
})

test('BREAK_OPTIONS zawiera typowe długości przerwy i zaczyna się od zera', () => {
  assert.equal(H.BREAK_OPTIONS[0], 0)
  for (const minutes of [15, 30, 60]) {
    assert.ok((H.BREAK_OPTIONS as readonly number[]).includes(minutes), `brak opcji ${minutes} min`)
  }
  for (const minutes of H.BREAK_OPTIONS) {
    assert.equal(minutes % H.QUARTER_MINUTES, 0, `${minutes} min to nie pełny kwadrans`)
  }
  // Każda opcja musi przejść walidację przy 8-godzinnym dniu.
  for (const minutes of H.BREAK_OPTIONS) {
    const res = H.validateEntry(H.rawFromForm({ start: '08:00', end: '18:00', breakMin: minutes }))
    assert.equal(res.ok, true, `przerwa ${minutes} min powinna być poprawna`)
  }
})

// ---------------------------------------------------------------------------
// Sumowanie
// ---------------------------------------------------------------------------

test('sumHours sumuje mapę i tablicę, ignorując puste', () => {
  const entries = {
    '2026-09-28': { hours: 8 },
    '2026-09-29': { hours: 7.5 },
    '2026-09-30': null
  }
  assert.equal(H.sumHours(entries), 15.5)
  assert.equal(H.sumHours([{ hours: 0.1 }, { hours: 0.2 }]), 0.3, 'brak błędu zmiennoprzecinkowego')
  assert.equal(H.sumHours({}), 0)
  assert.equal(H.sumHours(null), 0)
})

test('countWorkedDays liczy tylko dni z godzinami > 0', () => {
  const entries = {
    '2026-09-28': { hours: 8 },
    '2026-09-29': { hours: 0, note: 'urlop' },
    '2026-09-30': { hours: 4 }
  }
  assert.equal(H.countWorkedDays(entries), 2)
})

// ---------------------------------------------------------------------------
// Numer tygodnia ISO 8601
// ---------------------------------------------------------------------------

test('isoWeekNumber: typowe przypadki', () => {
  assert.equal(H.isoWeekNumber('2026-09-29'), 40)
  assert.equal(H.isoWeekNumber('2026-01-01'), 1)
  assert.equal(H.isoWeekNumber('2024-06-12'), 24)
})

test('isoWeekNumber: przełom roku wg ISO', () => {
  // 1 stycznia 2021 (piątek) należy jeszcze do 53. tygodnia roku 2020.
  assert.equal(H.isoWeekNumber('2021-01-01'), 53)
  assert.equal(H.isoWeekYear('2021-01-01'), 2020)
  // 31 grudnia 2019 (wtorek) należy już do 1. tygodnia roku 2020.
  assert.equal(H.isoWeekNumber('2019-12-31'), 1)
  assert.equal(H.isoWeekYear('2019-12-31'), 2020)
  // 2026 zaczyna się w czwartek, więc 1 stycznia to tydzień 1 roku 2026.
  assert.equal(H.isoWeekYear('2026-01-01'), 2026)
})

test('isoWeekNumber: ten sam numer dla całego tygodnia', () => {
  const dates = H.weekDates('2026-09-29')
  const numbers = new Set(dates.map(H.isoWeekNumber))
  assert.equal(numbers.size, 1, 'wszystkie 7 dni ma ten sam numer tygodnia')
})

test('rok 2020 ma 53 tygodnie ISO', () => {
  assert.equal(H.isoWeekNumber('2020-12-31'), 53)
})

// ---------------------------------------------------------------------------
// Daty i tygodnie
// ---------------------------------------------------------------------------

test('dayOfWeek: poniedziałek = 1, niedziela = 7', () => {
  assert.equal(H.dayOfWeek('2026-09-28'), 1) // poniedziałek
  assert.equal(H.dayOfWeek('2026-09-29'), 2)
  assert.equal(H.dayOfWeek('2026-10-03'), 6) // sobota
  assert.equal(H.dayOfWeek('2026-10-04'), 7) // niedziela
})

test('isWeekend rozpoznaje sobotę i niedzielę', () => {
  assert.equal(H.isWeekend('2026-10-03'), true)
  assert.equal(H.isWeekend('2026-10-04'), true)
  assert.equal(H.isWeekend('2026-10-05'), false)
})

test('startOfWeek zawsze zwraca poniedziałek', () => {
  assert.equal(H.startOfWeek('2026-09-29'), '2026-09-28')
  assert.equal(H.startOfWeek('2026-09-28'), '2026-09-28')
  assert.equal(H.startOfWeek('2026-10-04'), '2026-09-28')
})

test('weekDates zwraca 7 kolejnych dni od poniedziałku', () => {
  const dates = H.weekDates('2026-10-01')
  assert.equal(dates.length, 7)
  assert.equal(dates[0], '2026-09-28')
  assert.equal(dates[6], '2026-10-04')
})

test('addDays i daysBetween działają na przełomie roku', () => {
  assert.equal(H.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(H.addDays('2027-01-01', -1), '2026-12-31')
  assert.equal(H.daysBetween('2026-12-28', '2027-01-03'), 6)
})

test('obliczenia dat są odporne na zmianę czasu (UTC)', () => {
  // W Polsce zmiana czasu wypada 25.10.2026 i 29.03.2026 — doba „krótsza”/„dłuższa”
  // nie może przesunąć wyniku, bo liczymy w UTC.
  assert.equal(H.addDays('2026-10-24', 1), '2026-10-25')
  assert.equal(H.addDays('2026-10-25', 1), '2026-10-26')
  assert.equal(H.daysBetween('2026-10-24', '2026-10-26'), 2)
  assert.equal(H.addDays('2026-03-28', 1), '2026-03-29')
  assert.equal(H.addDays('2026-03-29', 1), '2026-03-30')
  assert.equal(H.daysBetween('2026-03-28', '2026-03-30'), 2)
})

test('parseDate odrzuca nieistniejące daty', () => {
  assert.equal(H.isValidDate('2026-02-30'), false)
  assert.equal(H.isValidDate('2026-13-01'), false)
  assert.equal(H.isValidDate('2026-00-10'), false)
  assert.equal(H.isValidDate('26-01-01'), false)
  assert.equal(H.isValidDate('2026-1-1'), false)
  assert.equal(H.isValidDate(''), false)
  assert.equal(H.isValidDate(null), false)
  assert.equal(H.isValidDate('2024-02-29'), true, 'rok przestępny')
  assert.equal(H.isValidDate('2026-02-29'), false, 'rok nieprzestępny')
})

// ---------------------------------------------------------------------------
// Zakresy miesięcy
// ---------------------------------------------------------------------------

test('monthsInRange: tydzień w jednym miesiącu', () => {
  assert.deepEqual(H.monthsInRange('2026-09-07', '2026-09-13'), ['2026-09'])
})

test('monthsInRange: tydzień przechodzący przez dwa miesiące', () => {
  assert.deepEqual(H.monthsInRange('2026-09-28', '2026-10-04'), ['2026-09', '2026-10'])
})

test('monthsInRange: tydzień przechodzący przez dwa lata', () => {
  assert.deepEqual(H.monthsInRange('2026-12-28', '2027-01-03'), ['2026-12', '2027-01'])
})

test('monthsInRange: dłuższy zakres zwraca wszystkie miesiące po kolei', () => {
  assert.deepEqual(H.monthsInRange('2026-11-15', '2027-02-05'), ['2026-11', '2026-12', '2027-01', '2027-02'])
})

test('monthsInRange odrzuca odwrócony zakres', () => {
  assert.throws(() => H.monthsInRange('2026-10-05', '2026-10-01'))
})

test('monthRange zwraca kolejne miesiące okresu', () => {
  assert.deepEqual(H.monthRange('2026-09', '2026-09'), ['2026-09'])
  assert.deepEqual(H.monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02'])
  assert.equal(H.monthRange('2026-01', '2026-12').length, 12)
})

test('monthRange odrzuca odwrócony i niepoprawny zakres', () => {
  assert.throws(() => H.monthRange('2026-10', '2026-09'))
  assert.throws(() => H.monthRange('2026-13', '2027-01'))
  assert.throws(() => H.monthRange('2026-09-01', '2026-10'))
})

test('monthKey wyciąga miesiąc z daty', () => {
  assert.equal(H.monthKey('2026-09-28'), '2026-09')
  assert.throws(() => H.monthKey('2026-02-30'))
})

test('daysInMonth uwzględnia lata przestępne', () => {
  assert.equal(H.daysInMonth('2026-01'), 31)
  assert.equal(H.daysInMonth('2026-02'), 28)
  assert.equal(H.daysInMonth('2024-02'), 29)
  assert.equal(H.daysInMonth('2026-04'), 30)
})

test('monthDates zwraca wszystkie dni miesiąca', () => {
  const dates = H.monthDates('2026-02')
  assert.equal(dates.length, 28)
  assert.equal(dates[0], '2026-02-01')
  assert.equal(dates[27], '2026-02-28')
})

test('addMonths działa na przełomie roku', () => {
  assert.equal(H.addMonths('2026-12', 1), '2027-01')
  assert.equal(H.addMonths('2026-01', -1), '2025-12')
  assert.equal(H.addMonths('2026-09', 5), '2027-02')
})

test('datesInRange zwraca ciągły zakres dat', () => {
  const dates = H.datesInRange('2026-09-28', '2026-10-04')
  assert.equal(dates.length, 7)
  assert.equal(dates[0], '2026-09-28')
  assert.equal(dates[6], '2026-10-04')
})

// ---------------------------------------------------------------------------
// Identyfikatory
// ---------------------------------------------------------------------------

test('normalizeId akceptuje różne zapisy tego samego ID', () => {
  assert.equal(H.normalizeId('ABCD-2345'), 'ABCD2345')
  assert.equal(H.normalizeId('abcd2345'), 'ABCD2345')
  assert.equal(H.normalizeId(' abcd 2345 '), 'ABCD2345')
})

test('normalizeId odrzuca ID o złej długości lub ze znakami spoza alfabetu', () => {
  assert.equal(H.normalizeId('ABCD234'), null)
  assert.equal(H.normalizeId('ABCD23456'), null)
  assert.equal(H.normalizeId('ABCD2340'), null, 'zero nie należy do alfabetu')
  assert.equal(H.normalizeId('ABCD234I'), null, 'I nie należy do alfabetu')
  assert.equal(H.normalizeId(''), null)
  assert.equal(H.normalizeId(null), null)
})

test('formatId wstawia myślnik', () => {
  assert.equal(H.formatId('ABCD2345'), 'ABCD-2345')
})

test('alfabet ID nie zawiera mylących znaków', () => {
  for (const ch of '01IO') {
    assert.equal(H.ID_ALPHABET.includes(ch), false, `alfabet nie może zawierać ${ch}`)
  }
})

// ---------------------------------------------------------------------------
// Formatowanie po polsku
// ---------------------------------------------------------------------------

test('formatDayMonth używa dopełniacza', () => {
  assert.equal(H.formatDayMonth('2026-09-28'), '28 września')
  assert.equal(H.formatDayMonth('2026-01-05'), '5 stycznia')
  assert.equal(H.formatDayMonth('2026-11-30'), '30 listopada')
})

test('formatDatePL i formatMonth', () => {
  assert.equal(H.formatDatePL('2026-09-28'), '28.09.2026')
  assert.equal(H.formatMonth('2026-09'), 'Wrzesień 2026')
})

test('formatWeekLabel zawiera numer tygodnia i zakres dat', () => {
  assert.equal(H.formatWeekLabel('2026-09-29'), 'Tydzień 40 · 28.09 – 04.10.2026')
})

test('nazwy dni tygodnia po polsku', () => {
  assert.equal(H.DAY_NAMES[H.dayOfWeek('2026-09-28')], 'Poniedziałek')
  assert.equal(H.DAY_SHORT[H.dayOfWeek('2026-10-04')], 'nd')
})

// ---------------------------------------------------------------------------
// Nazwy plików i arkuszy
// ---------------------------------------------------------------------------

test('safeFileName usuwa polskie znaki i spacje', () => {
  assert.equal(H.safeFileName('Łukasz Żółć'), 'lukasz_zolc')
  assert.equal(H.safeFileName('Anna  Kowalska-Nowak'), 'anna_kowalska_nowak')
  assert.equal(H.safeFileName('???', 'plik'), 'plik')
})

test('safeSheetName skraca do 31 znaków i usuwa znaki zakazane', () => {
  const long = H.safeSheetName('Bardzo Długie Imię I Nazwisko Pracownika Firmy')
  assert.ok(long.length <= 31)
  assert.equal(H.safeSheetName('A/B[C]D:E*F?G'), 'A B C D E F G')
})

test('safeSheetName zapewnia unikalność', () => {
  const used: string[] = []
  const a = H.safeSheetName('Jan Kowalski', used); used.push(a)
  const b = H.safeSheetName('Jan Kowalski', used); used.push(b)
  const c = H.safeSheetName('Jan Kowalski', used)
  assert.equal(a, 'Jan Kowalski')
  assert.notEqual(a, b)
  assert.notEqual(b, c)
  assert.ok(b.length <= 31 && c.length <= 31)
})

// ---------------------------------------------------------------------------
// Spójność: ten sam wpis = ta sama suma wszędzie
// ---------------------------------------------------------------------------

test('suma z validateEntry zgadza się z sumHours (kryterium akceptacji)', () => {
  const raw = {
    '2026-09-28': { mode: 'range', start: '08:00', end: '16:30', breakMin: 30 },
    '2026-09-29': { mode: 'total', hours: '7,5' },
    '2026-09-30': { mode: 'range', start: '22:00', end: '06:00', breakMin: 0 },
    '2026-10-01': null
  }
  const normalized: Record<string, H.TimesheetEntry> = {}
  for (const [date, entry] of Object.entries(raw)) {
    const res = H.validateEntry(entry)
    assert.equal(res.ok, true, `${date} powinien być poprawny`)
    if (res.entry) normalized[date] = res.entry
  }
  assert.equal(H.sumHours(normalized), 23.5)
  assert.equal(H.countWorkedDays(normalized), 3)
})

test('ponowna walidacja zapisanego wpisu daje ten sam wynik (idempotencja)', () => {
  const first = H.validateEntry({ mode: 'range', start: '08:00', end: '16:30', breakMin: 30, note: 'x' }).entry
  const second = H.validateEntry(first).entry
  assert.deepEqual(second, first)
})
