import { useEffect, useState } from 'react'
import type { CalendarInfo } from '../../../shared/types'

export interface EnteredDate {
  t: number
  cal: string
  text: string
  precision: string | null
}

interface Props {
  calendars: CalendarInfo[]
  cal: string
  text: string
  /** Called with the parsed date when the text is committed (Enter or leaving the field) and reads as a date. */
  onCommit(date: EnteredDate): void
  onCalendarChange?(cal: string): void
  placeholder?: string
  id?: string
}

/**
 * A date typed in a calendar's written form ("2031-07-04 09:30"), parsed by
 * main (which runs every calendar, scripts included). Shows what is wrong
 * when the text is not a date in that calendar.
 */
export function DateInput({ calendars, cal, text, onCommit, onCalendarChange, placeholder, id }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(text)
    setError(null)
  }, [text, cal])

  const usable = calendars.filter((c) => !c.error)
  const units = calendars.find((c) => c.id === cal)?.units ?? []
  const example = units.length ? exampleFor(units.map((u) => u.name)) : ''

  const commit = async (): Promise<void> => {
    const value = draft.trim()
    if (value === text.trim() && !error) return
    if (!value) {
      setError('Enter a date.')
      return
    }
    const parsed = await window.malevo.calendar.parse(cal, value)
    if (!parsed) {
      setError(`Not a date in this calendar. Written like: ${example}`)
      return
    }
    setError(null)
    onCommit({ t: parsed.t, cal, text: value, precision: parsed.precision })
  }

  return (
    <span className="date-input">
      <span className="date-input-row">
        {onCalendarChange && (
          <select value={cal} onChange={(e) => onCalendarChange(e.target.value)} aria-label="Calendar">
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {!usable.some((c) => c.id === cal) && <option value={cal}>{cal} (unavailable)</option>}
          </select>
        )}
        <input
          id={id}
          className={error ? 'invalid' : undefined}
          value={draft}
          placeholder={placeholder ?? example}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              setDraft(text)
              setError(null)
            }
          }}
          spellCheck={false}
        />
      </span>
      {error && <span className="field-error">{error}</span>}
    </span>
  )
}

function exampleFor(units: string[]): string {
  // The shape of the written form: year, then date units joined by "-", then time units joined by ":".
  const parts = ['2031']
  if (units.includes('month')) parts.push('-07')
  if (units.includes('day')) parts.push('-04')
  if (units.includes('hour')) parts.push(' 09:30')
  return parts.join('') + (units.length > 0 && !units.includes('month') && !units.includes('day') ? '  (year first, then each unit)' : '')
}
