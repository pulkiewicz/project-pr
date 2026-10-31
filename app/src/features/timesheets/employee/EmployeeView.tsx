import './employee.css'
import { ActionIcon, Alert, Button, Card, Image, Progress, Tabs, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconChevronLeft, IconChevronRight, IconLogout } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hours as H } from '#shared'
import { DayRow } from './DayRow'
import { MonthSummary } from './MonthSummary'
import { PublicApiError, getEntries, getMe, saveEntries } from './publicApi'

const STORAGE_KEY = 'wc.employeeId'

/** Dzisiejsza data w kalendarzu użytkownika (nie UTC — „dziś” to dziś u pracownika). */
function todayISO() {
  const now = new Date()
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Porównywalna postać wpisu — bez updatedAt, które zmienia się przy każdym zapisie. */
function comparable(entry: Partial<H.TimesheetEntry> | null | undefined) {
  if (!entry) return null
  const { mode, start, end, breakMin, hours, note } = entry
  return JSON.stringify({ mode, start: start ?? null, end: end ?? null, breakMin: breakMin ?? 0, hours, note: note ?? '' })
}

const storage = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      // tryb prywatny — ID trzeba będzie wpisać ponownie
    }
  },
  remove: () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // j.w.
    }
  },
}

const notify = (message: string, color: 'green' | 'red' = 'green') => notifications.show({ message, color, autoClose: 3000, position: 'top-center' })

/**
 * Ekran pracownika ewidencji czasu (`/godziny?id=XXXX-XXXX`) — pola, przyciski, komunikaty i zachowanie jak w
 * workload-calendar, wygląd z motywu PMO. Bez konta w PMO: dostęp wyłącznie identyfikatorem.
 */
export function EmployeeView() {
  // --- logowanie ---
  const [idInput, setIdInput] = useState('')
  const [employee, setEmployee] = useState<{ id: string; name: string } | null>(null)
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  // --- tydzień ---
  const today = todayISO()
  const [anchor, setAnchor] = useState(() => H.startOfWeek(today))
  const dates = useMemo(() => H.weekDates(anchor), [anchor])
  const [form, setForm] = useState<Record<string, H.DayForm>>({})
  const [saved, setSaved] = useState<Record<string, H.StoredTimesheetEntry>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<string | null>('tydzien')
  const [refreshKey, setRefreshKey] = useState(0)

  const formOf = useCallback((date: string) => form[date] ?? H.emptyForm(), [form])
  /** Wynik wspólnej walidacji dla jednego dnia. */
  const check = useCallback((date: string) => H.validateEntry(H.rawFromForm(formOf(date))), [formOf])

  const errorDates = dates.filter((d) => !check(d).ok)
  const weekTotal = H.sumHours(dates.map((d) => check(d).entry).filter(Boolean))
  const filledDays = dates.filter((d) => Number(check(d).entry?.hours) > 0).length
  const dirty = dates.some((d) => {
    const r = check(d)
    if (!r.ok) return true // błędny wpis też jest zmianą, której nie zapisano
    return comparable(r.entry) !== comparable(saved[d] ?? null)
  })
  const canSave = dirty && errorDates.length === 0 && !saving && !loading

  const logout = useCallback(
    (ask = true) => {
      if (ask && dirty && !window.confirm('Masz niezapisane zmiany. Na pewno wylogować?')) return
      storage.remove()
      setEmployee(null)
      setSaved({})
      setForm({})
      setIdInput('')
    },
    [dirty],
  )
  const logoutRef = useRef(logout)
  logoutRef.current = logout

  // --- ładowanie tygodnia ---
  useEffect(() => {
    if (!employee) return
    let alive = true
    setLoading(true)
    setLoadError('')
    getEntries(employee.id, dates[0]!, dates[6]!)
      .then((data) => {
        if (!alive) return
        const entries = data.entries ?? {}
        setSaved(entries)
        setForm(Object.fromEntries(dates.map((d) => [d, H.formFromEntry(entries[d] ?? null)])))
      })
      .catch((e: PublicApiError) => {
        if (!alive) return
        setLoadError(e.message)
        if (e.status === 403 || e.status === 404) logoutRef.current(false)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [employee, dates])

  // --- logowanie identyfikatorem ---
  const confirmId = useCallback(async (raw: string) => {
    const id = H.normalizeId(raw)
    if (!id) {
      setLoginError('Identyfikator składa się z 8 znaków, np. ABCD-2345.')
      return
    }
    setLoggingIn(true)
    setLoginError('')
    try {
      const me = await getMe(id)
      setEmployee(me)
      storage.set(me.id)
      // Czyścimy ?id= z adresu, żeby identyfikator nie zostawał w pasku adresu.
      if (new URLSearchParams(window.location.search).has('id')) window.history.replaceState(null, '', window.location.pathname)
    } catch (e) {
      setLoginError((e as Error).message)
      storage.remove()
    } finally {
      setLoggingIn(false)
    }
  }, [])

  useEffect(() => {
    // ID z linku ma pierwszeństwo nad zapamiętanym w przeglądarce.
    const fromQuery = H.normalizeId(new URLSearchParams(window.location.search).get('id') ?? '')
    const fromStorage = H.normalizeId(storage.get() ?? '')
    const id = fromQuery ?? fromStorage
    if (id) {
      setIdInput(H.formatId(id))
      // Zapamiętane ID logujemy od razu; ID z linku pracownik potwierdza sam.
      if (!fromQuery && fromStorage) void confirmId(fromStorage)
    }
  }, [confirmId])

  // --- ostrzeżenie o niezapisanych zmianach ---
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  // --- zapis ---
  const save = async () => {
    if (!canSave || !employee) return
    // Wysyłamy tylko dni, które faktycznie się zmieniły.
    const payload: Record<string, H.TimesheetEntry | null> = {}
    for (const d of dates) {
      const r = check(d)
      if (r.ok && comparable(r.entry) !== comparable(saved[d] ?? null)) payload[d] = r.entry
    }
    if (!Object.keys(payload).length) return
    setSaving(true)
    try {
      const result = await saveEntries(employee.id, payload)
      const next = { ...saved }
      for (const d of Object.keys(payload)) {
        if (result.saved?.[d]) next[d] = result.saved[d]
        else delete next[d]
      }
      setSaved(next)
      setRefreshKey((k) => k + 1)
      notify('Tydzień zapisany.')
    } catch (e) {
      const err = e as PublicApiError
      notify(err.message, 'red')
      if (err.status === 403 || err.status === 404) logout(false)
    } finally {
      setSaving(false)
    }
  }

  // --- akcje dnia ---
  const setDay = (date: string, v: H.DayForm) => setForm((f) => ({ ...f, [date]: v }))
  /** Przepisuje godziny i przerwę z poprzedniego dnia; uwagi zostają własne. */
  const copyPrevious = (index: number) => {
    if (index <= 0) return
    const source = formOf(dates[index - 1]!)
    setDay(dates[index]!, { ...formOf(dates[index]!), start: source.start, end: source.end, breakMin: source.breakMin })
  }
  /** Strzałka „jak poprzedni dzień” ma sens tylko na pustym dniu po dniu z godzinami. */
  const canCopyPrevious = (index: number) => index > 0 && check(dates[index]!).entry === null && check(dates[index - 1]!).entry !== null

  const shiftWeek = (amount: number) => setAnchor((a) => H.addDays(a, amount * 7))
  const isCurrentWeek = anchor === H.startOfWeek(today)

  const header = (
    <header className="wc-appbar">
      <Image src="/brand/envcheck-mark.svg" w={34} h={34} alt="Envcheck" />
      <div className="wc-appbar__title">{employee ? employee.name : 'Ewidencja czasu pracy'}</div>
      {employee && (
        <Button variant="subtle" color="gray" leftSection={<IconLogout size={18} />} onClick={() => logout()}>
          Wyloguj
        </Button>
      )}
    </header>
  )

  if (!employee) {
    return (
      <>
        {header}
        <main className="wc-page" id="tresc">
          <div className="wc-container" style={{ maxWidth: 440, paddingTop: 48, paddingBottom: 48 }}>
            <Card withBorder padding="lg">
              <Title order={3} mb={4}>
                Ewidencja czasu pracy
              </Title>
              <Text size="sm" c="dimmed" mb="lg">
                Wpisz swój identyfikator, żeby uzupełnić godziny.
              </Text>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void confirmId(idInput)
                }}
              >
                <TextInput
                  label="Twój identyfikator"
                  placeholder="ABCD-2345"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  size="md"
                  className="wc-nums"
                  value={idInput}
                  onChange={(e) => setIdInput(e.currentTarget.value)}
                  error={loginError || undefined}
                  disabled={loggingIn}
                  mb="md"
                />
                <Button type="submit" size="lg" fullWidth loading={loggingIn}>
                  Dalej
                </Button>
              </form>
              <Text size="xs" c="dimmed" mt="lg">
                Identyfikator dostajesz od administratora. Widzisz wyłącznie swoje dane.
              </Text>
            </Card>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      {header}

      <main className={`wc-page${tab === 'tydzien' ? ' wc-page--with-bar' : ''}`}>
        <div className="wc-container" id="tresc" style={{ maxWidth: 720, paddingTop: 12, paddingBottom: 12 }}>
          <Tabs value={tab} onChange={setTab} mb="sm">
            <Tabs.List>
              <Tabs.Tab value="tydzien">Tydzień</Tabs.Tab>
              <Tabs.Tab value="miesiac">Miesiąc</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="tydzien" pt="sm">
              <div className="wc-week-nav">
                <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Poprzedni tydzień" onClick={() => shiftWeek(-1)}>
                  <IconChevronLeft />
                </ActionIcon>
                <div className="wc-week-nav__label">
                  <div className="wc-title">{H.formatWeekLabel(anchor)}</div>
                  {!isCurrentWeek && (
                    <button type="button" className="wc-link" onClick={() => setAnchor(H.startOfWeek(todayISO()))}>
                      wróć do bieżącego tygodnia
                    </button>
                  )}
                </div>
                <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Następny tydzień" onClick={() => shiftWeek(1)}>
                  <IconChevronRight />
                </ActionIcon>
              </div>

              {loadError && (
                <Alert color="red" mb="sm">
                  {loadError}
                </Alert>
              )}
              {loading && <Progress value={100} animated size="xs" mb="sm" />}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dates.map((date, index) => (
                  <DayRow
                    // Klucz z identyfikatorem: po wczytaniu tygodnia stan „uwagi otwarte” liczy się od nowa.
                    key={`${date}-${refreshKey}-${loading}`}
                    date={date}
                    value={formOf(date)}
                    onChange={(v) => setDay(date, v)}
                    today={date === today}
                    canCopyPrevious={canCopyPrevious(index)}
                    disabled={loading || saving}
                    onCopyPrevious={() => copyPrevious(index)}
                    onClear={() => setDay(date, H.emptyForm())}
                  />
                ))}
              </div>
            </Tabs.Panel>

            <Tabs.Panel value="miesiac" pt="sm">
              <MonthSummary
                employeeId={employee.id}
                initialMonth={H.monthKey(anchor)}
                refreshKey={refreshKey}
                onOpenWeek={(monday) => {
                  setAnchor(monday)
                  setTab('tydzien')
                }}
              />
            </Tabs.Panel>
          </Tabs>
        </div>
      </main>

      {tab === 'tydzien' && (
        <footer className="wc-sticky-bar">
          <div className="wc-sticky-bar__inner">
            <div>
              <div className="wc-sticky-bar__total">{H.formatHours(weekTotal)} h</div>
              {errorDates.length ? (
                <div style={{ fontSize: '0.75rem', color: '#dc2626' }}>Popraw {errorDates.length === 1 ? 'zaznaczony dzień' : 'zaznaczone dni'}</div>
              ) : (
                <div className="wc-muted" style={{ fontSize: '0.75rem' }}>
                  {filledDays} {filledDays === 1 ? 'dzień' : 'dni'} w tym tygodniu
                </div>
              )}
            </div>
            <Button ml="auto" size="lg" disabled={!canSave} loading={saving} onClick={() => void save()} rightSection={!dirty && !errorDates.length ? <IconCheck size={18} /> : undefined}>
              {dirty ? 'Zapisz' : 'Zapisano'}
            </Button>
          </div>
        </footer>
      )}
    </>
  )
}
