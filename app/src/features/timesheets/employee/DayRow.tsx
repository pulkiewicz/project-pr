import { ActionIcon, Select, TextInput } from '@mantine/core'
import { IconAlertCircle, IconArrowBigDown, IconNoteOff, IconNotes, IconX } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { hours as H } from '#shared'

interface Props {
  /** Data dnia w formacie YYYY-MM-DD. */
  date: string
  value: H.DayForm
  onChange: (v: H.DayForm) => void
  /** Czy to dzisiejszy dzień (żółty zakreślacz). */
  today: boolean
  /** Czy da się skopiować godziny z poprzedniego dnia. */
  canCopyPrevious: boolean
  disabled: boolean
  onCopyPrevious: () => void
  onClear: () => void
}

/** Karta jednego dnia — odwzorowanie `DayRow.vue` z workload-calendar. */
export function DayRow({ date, value, onChange, today, canCopyPrevious, disabled, onCopyPrevious, onClear }: Props) {
  const dow = H.dayOfWeek(date)
  const weekend = H.isWeekend(date)
  const dayLabel = `${H.DAY_NAMES[dow]}, ${H.formatDayMonth(date)}`

  // Walidacja na żywo — ta sama funkcja, której użyje serwer przy zapisie.
  const validation = H.validateEntry(H.rawFromForm(value))
  const error = validation.error
  const hours = validation.entry?.hours ?? 0
  const filled = validation.entry !== null

  /** Uwagi są schowane, dopóki nie są potrzebne — pokazują się same, gdy coś w nich jest. */
  const [noteOpen, setNoteOpen] = useState(Boolean(value.note))
  const patch = (changes: Partial<H.DayForm>) => onChange({ ...value, ...changes })

  /** Lista przerw do wyboru; zachowuje nietypową wartość zapisaną wcześniej. */
  const breakMin = Number(value.breakMin) || 0
  const breakChoices = useMemo(() => {
    const values: number[] = [...H.BREAK_OPTIONS]
    if (!values.includes(breakMin)) values.push(breakMin)
    return values.sort((a, b) => a - b).map((m) => ({ value: String(m), label: m === 0 ? 'bez przerwy' : `${m} min` }))
  }, [breakMin])

  /** Godziny zapisane kiedyś jako sama suma — do czasu wpisania od–do zostają nietknięte. */
  const legacyHours = Number(value.legacyHours) || 0

  /** Po opuszczeniu pola przyciągamy godzinę do kwadransa — pracownik widzi dokładnie to, co policzy serwer. */
  const snapField = (key: 'start' | 'end') => {
    const v = value[key]
    if (!H.isValidTime(v)) return
    const snapped = H.snapTimeToQuarter(v)
    if (snapped !== v) patch({ [key]: snapped })
  }

  const toggleNote = () => {
    setNoteOpen(!noteOpen)
    if (noteOpen && value.note) patch({ note: '' })
  }

  const cls = ['wc-day', weekend && 'wc-day--weekend', today && 'wc-day--today', error && 'wc-day--error', !filled && 'wc-day--empty'].filter(Boolean).join(' ')
  return (
    <section className={cls} aria-label={dayLabel}>
      <header className="wc-day__head">
        <span className={`wc-day__dow${today ? ' wc-today-mark' : ''}`}>{H.DAY_SHORT[dow]}</span>
        <span className="wc-day__date">{H.formatDayMonth(date)}</span>
        <span className="wc-day__sum">{filled ? `${H.formatHours(hours)} h` : ''}</span>
        {canCopyPrevious && (
          <ActionIcon variant="subtle" color="gray" size="sm" disabled={disabled} title="Takie same godziny jak poprzedniego dnia" aria-label="Takie same godziny jak poprzedniego dnia" onClick={onCopyPrevious}>
            <IconArrowBigDown size={16} />
          </ActionIcon>
        )}
        {filled && (
          <ActionIcon variant="subtle" color="gray" size="sm" disabled={disabled} title={`Wyczyść ${dayLabel}`} aria-label={`Wyczyść ${dayLabel}`} onClick={onClear}>
            <IconX size={16} />
          </ActionIcon>
        )}
      </header>

      <div className="wc-day__body">
        <div className="wc-day__fields">
          {/* step=900 = 15 minut: przeglądarka sama podpowiada tylko pełne kwadranse. */}
          <TextInput
            type="time"
            step={900}
            label="od"
            size="sm"
            value={value.start}
            disabled={disabled}
            aria-label={`Godzina rozpoczęcia, ${dayLabel}`}
            onChange={(e) => patch({ start: e.currentTarget.value })}
            onBlur={() => snapField('start')}
          />
          <TextInput
            type="time"
            step={900}
            label="do"
            size="sm"
            value={value.end}
            disabled={disabled}
            aria-label={`Godzina zakończenia, ${dayLabel}`}
            onChange={(e) => patch({ end: e.currentTarget.value })}
            onBlur={() => snapField('end')}
          />
          <Select
            label="przerwa"
            size="sm"
            data={breakChoices}
            value={String(breakMin)}
            allowDeselect={false}
            disabled={disabled}
            aria-label={`Przerwa, ${dayLabel}`}
            onChange={(v) => patch({ breakMin: Number(v) || 0 })}
          />
          <ActionIcon
            variant="subtle"
            color="gray"
            className="wc-day__note-btn"
            disabled={disabled}
            title={noteOpen ? 'Ukryj uwagi' : 'Dodaj uwagi'}
            aria-label={noteOpen ? 'Ukryj uwagi' : 'Dodaj uwagi'}
            onClick={toggleNote}
          >
            {noteOpen ? <IconNoteOff size={18} /> : <IconNotes size={18} />}
          </ActionIcon>
        </div>

        {noteOpen && (
          <TextInput
            mt="xs"
            size="sm"
            label="Uwagi"
            maxLength={500}
            value={value.note}
            disabled={disabled}
            aria-label={`Uwagi, ${dayLabel}`}
            onChange={(e) => patch({ note: e.currentTarget.value })}
          />
        )}

        {error ? (
          <p className="wc-day__error" role="alert">
            <IconAlertCircle size={16} style={{ marginRight: 4 }} />
            {error}
          </p>
        ) : legacyHours ? (
          <p className="wc-day__hint">Zapisano wcześniej jako sumę {H.formatHours(legacyHours)} h. Wpisz godziny od–do, aby zaktualizować.</p>
        ) : null}
      </div>
    </section>
  )
}
