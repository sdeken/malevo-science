import { useEffect, useState } from 'react'
import type { CalendarInfo, EventInfo, TimeInfo, WhenValue } from '../../../../shared/types'
import { DateInput } from '../../components/DateInput'
import { useFormattedOne } from '../../state'

interface Props {
  label: string
  when: WhenValue
  onChange(w: WhenValue): void
  calendars: CalendarInfo[]
  /** Events this one may be anchored to (never itself). */
  anchors: EventInfo[]
  resolved: TimeInfo | null
  displayCal: string
  now: number
  version: number
}

/**
 * When something happens: on a date in some calendar, or relative to another
 * event (its start or end, plus an offset in a calendar's own units). A date
 * keeps the text it was entered as; changing its calendar re-writes the text
 * and never moves the instant.
 */
export function WhenEditor({ label, when, onChange, calendars, anchors, resolved, displayCal, now, version }: Props): React.JSX.Element {
  const mode: 'date' | 'anchor' = when.after !== undefined ? 'anchor' : 'date'
  const dateCal = when.at?.cal ?? when.cal ?? displayCal
  const formattedAt = useFormattedOne(dateCal, when.at?.t_s ?? null, when.precision ?? 'minute', version)
  const shown = useFormattedOne(
    displayCal,
    resolved?.t ?? null,
    resolved?.precision && resolved.cal === displayCal ? resolved.precision : 'minute',
    version
  )
  const offsetCal = calendars.find((c) => c.id === (when.cal ?? displayCal))
  const precisionCal = calendars.find((c) => c.id === (mode === 'date' ? dateCal : (when.cal ?? resolved?.cal ?? displayCal)))

  const switchMode = async (m: 'date' | 'anchor'): Promise<void> => {
    if (m === mode) return
    if (m === 'anchor') {
      const target = anchors[0]
      if (!target) return
      onChange({ after: target.id, cal: displayCal, offset: {}, circa: when.circa })
    } else {
      const t = resolved?.t ?? now
      const [text] = await window.malevo.calendar.format(displayCal, [{ t, precision: 'day' }])
      const parsed = text ? await window.malevo.calendar.parse(displayCal, text) : null
      onChange({ at: { t_s: parsed?.t ?? t, cal: displayCal, text: text ?? undefined }, circa: when.circa })
    }
  }

  const changeDateCal = async (cal: string): Promise<void> => {
    const t = when.at?.t_s ?? resolved?.t ?? now
    const [text] = await window.malevo.calendar.format(cal, [
      { t, precision: precisionCal?.units.some((u) => u.name === when.precision) ? when.precision : 'minute' }
    ])
    onChange({ ...when, cal: undefined, precision: undefined, at: { t_s: t, cal, text: text ?? undefined } })
  }

  return (
    <fieldset className="when">
      <legend>{label}</legend>
      <div className="seg">
        <button className={mode === 'date' ? 'on' : ''} onClick={() => void switchMode('date')} type="button">
          On a date
        </button>
        <button
          className={mode === 'anchor' ? 'on' : ''}
          onClick={() => void switchMode('anchor')}
          type="button"
          disabled={anchors.length === 0 && mode !== 'anchor'}
          title={anchors.length === 0 ? 'There is no other event to anchor to yet.' : undefined}
        >
          Relative to an event
        </button>
      </div>

      {mode === 'date' ? (
        <label className="field">
          Date
          <DateInput
            calendars={calendars}
            cal={dateCal}
            text={when.at?.text ?? formattedAt ?? ''}
            onCalendarChange={(c) => void changeDateCal(c)}
            onCommit={(d) => onChange({ ...when, cal: undefined, at: { t_s: d.t, cal: d.cal, text: d.text } })}
          />
        </label>
      ) : (
        <AnchorFields
          when={when}
          onChange={onChange}
          anchors={anchors}
          calendars={calendars}
          offsetCalUnits={offsetCal?.units ?? []}
          displayCal={displayCal}
        />
      )}

      <div className="field-row">
        <label className="field">
          Known to the
          <select value={when.precision ?? ''} onChange={(e) => onChange({ ...when, precision: e.target.value || undefined })}>
            <option value="">{mode === 'date' ? '(as entered)' : '(as its anchor)'}</option>
            {(precisionCal?.units ?? []).map((u) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(when.circa)}
            onChange={(e) => onChange({ ...when, circa: e.target.checked || undefined })}
          />
          Approximate (circa)
        </label>
      </div>
      <div className="resolved">
        {resolved ? (
          <>
            Resolves to <code>{shown ?? '…'}</code>
            {resolved.circa && <span className="muted"> (circa)</span>}
          </>
        ) : (
          <span className="error">Cannot be worked out yet.</span>
        )}
      </div>
    </fieldset>
  )
}

function AnchorFields({
  when,
  onChange,
  anchors,
  calendars,
  offsetCalUnits,
  displayCal
}: {
  when: WhenValue
  onChange(w: WhenValue): void
  anchors: EventInfo[]
  calendars: CalendarInfo[]
  offsetCalUnits: { name: string }[]
  displayCal: string
}): React.JSX.Element {
  const [seconds, setSeconds] = useState(String(when.offset_s ?? ''))
  useEffect(() => setSeconds(String(when.offset_s ?? '')), [when.offset_s])
  const setOffset = (unit: string, raw: string): void => {
    const offset = { ...(when.offset ?? {}) }
    const n = Math.trunc(Number(raw))
    if (raw.trim() === '' || !Number.isFinite(n) || n === 0) delete offset[unit]
    else offset[unit] = n
    onChange({ ...when, offset })
  }
  return (
    <>
      <div className="field-row">
        <label className="field grow">
          Event
          <select value={when.after} onChange={(e) => onChange({ ...when, after: e.target.value })}>
            {!anchors.some((a) => a.id === when.after) && <option value={when.after}>{when.after} (missing)</option>}
            {anchors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.value?.name ?? a.id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From its
          <select value={when.from ?? 'start'} onChange={(e) => onChange({ ...when, from: e.target.value === 'end' ? 'end' : undefined })}>
            <option value="start">start</option>
            <option value="end">end</option>
          </select>
        </label>
      </div>
      <label className="field">
        Offset, counted in
        <select value={when.cal ?? displayCal} onChange={(e) => onChange({ ...when, cal: e.target.value, offset: {} })}>
          {calendars
            .filter((c) => !c.error)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <div className="offset-grid">
        {offsetCalUnits.map((u) => (
          <label key={u.name} className="field">
            {u.name}s
            <input
              type="number"
              step={1}
              defaultValue={when.offset?.[u.name] ?? ''}
              key={`${u.name}:${when.offset?.[u.name] ?? ''}`}
              onBlur={(e) => setOffset(u.name, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setOffset(u.name, (e.target as HTMLInputElement).value)}
            />
          </label>
        ))}
        <label className="field">
          plus seconds
          <input
            type="number"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            onBlur={() => onChange({ ...when, offset_s: seconds.trim() === '' || Number(seconds) === 0 ? undefined : Number(seconds) })}
          />
        </label>
      </div>
    </>
  )
}
