import { useEffect, useState } from 'react'
import type { CalendarInfo, WorldSnapshot } from '../../../../shared/types'
import { DateInput } from '../../components/DateInput'
import { slugId, useFormattedOne } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

// Loose shapes of calendar files; main validates them against the schemas.
type Unit = { name: string; per?: number; first?: number; time?: boolean }
type CalValue = Record<string, unknown> & { name: string; kind: string }
type Instant = { t_s: number; cal?: string; text?: string }

const KINDS: { kind: string; label: string; about: string }[] = [
  { kind: 'gregorian', label: 'Gregorian', about: "Earth's civil calendar, with leap years and no leap seconds." },
  { kind: 'fixed', label: 'Fixed', about: 'Units of exact length nested to any depth, with no leap rules.' },
  {
    kind: 'solar',
    label: 'Planet-local',
    about: "Follows a planet's own day and year, with leap days that keep it in step with the seasons."
  },
  { kind: 'era', label: 'Era count', about: 'Another calendar with the years counted from (or to) some year.' },
  { kind: 'offset', label: 'Offset', about: 'Another calendar shifted by a fixed amount, like a time zone or a ship clock.' },
  { kind: 'script', label: 'Script', about: 'Any rules at all, written in JavaScript. Runs in a sandbox with no clock or randomness.' }
]

const SCRIPT_TEMPLATE = `// A script calendar. \`t\` is universal time: seconds since J2000.0
// (2000-01-01 12:00 on the Gregorian calendar, no leap seconds).
//
// toFields(t, h) returns a field for every unit declared in the calendar,
// largest first. The smallest unit carries any fraction, so that
// fromFields(toFields(t)) gives t back exactly (the Checks tool tests this).
//
// h offers h.DAY, h.floorDiv, h.daysFromCivil, h.civilFromDays and
// h.gregorian.toFields / fromFields. There is no clock and no randomness:
// the same t must always give the same date.
//
// This example keeps Gregorian months and days but counts years from 2100.

const FIRST_YEAR = 2100

module.exports = {
  toFields(t, h) {
    const f = h.gregorian.toFields(t)
    return { year: f.year - FIRST_YEAR + 1, month: f.month, day: f.day, hour: f.hour, minute: f.minute, second: f.second }
  },
  fromFields(f, h) {
    return h.gregorian.fromFields({ year: f.year + FIRST_YEAR - 1, month: f.month, day: f.day, hour: f.hour, minute: f.minute, second: f.second })
  },
  yearLabel(year) {
    return 'Y' + year
  },
  parseYearLabel(text) {
    return /^Y-?\\d+$/.test(text) ? Number(text.slice(1)) : null
  }
}
`

const STANDARD_TIME: Unit[] = [
  { name: 'hour', per: 24, time: true },
  { name: 'minute', per: 60, time: true },
  { name: 'second', per: 60, time: true }
]

function CalendarsView({ snapshot, now, displayCal }: ToolProps): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(snapshot.calendars[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const current = snapshot.calendars.find((c) => c.id === selected) ?? null

  const add = async (kind: string): Promise<void> => {
    const ids = snapshot.calendars.map((c) => c.id)
    const label = KINDS.find((k) => k.kind === kind)!.label
    const id = slugId(kind === 'gregorian' ? 'gregorian' : `${label} calendar`, ids)
    const base = displayCal ?? snapshot.calendars.find((c) => !c.error)?.id ?? 'gregorian'
    const epoch = async (): Promise<Instant> => {
      const [text] = await window.malevo.calendar.format(base, [{ t: now, precision: 'day' }])
      const parsed = text ? await window.malevo.calendar.parse(base, text) : null
      return { t_s: parsed?.t ?? now, cal: base, text: text ?? undefined }
    }
    let value: CalValue
    switch (kind) {
      case 'gregorian':
        value = { name: 'Gregorian', kind }
        break
      case 'fixed':
        value = {
          name: 'New fixed calendar',
          kind,
          epoch: await epoch(),
          epochYear: 1,
          units: [{ name: 'year' }, { name: 'day', per: 365 }, ...STANDARD_TIME],
          smallestUnit_s: 1
        }
        break
      case 'solar':
        value = {
          name: 'New planet-local calendar',
          kind,
          dayLength_s: 86400,
          yearLength_s: 365.2422 * 86400,
          epoch: await epoch(),
          epochYear: 1,
          hoursPerDay: 24,
          minutesPerHour: 60,
          secondsPerMinute: 60
        }
        break
      case 'era':
        value = { name: 'New era', kind, base, epochYear: 2100, firstYear: 1, direction: 'forward', prefix: '', suffix: ' NE' }
        break
      case 'offset':
        value = { name: 'New offset', kind, base, offset_s: 3600 }
        break
      default:
        value = {
          name: 'New script calendar',
          kind: 'script',
          units: [
            { name: 'year' },
            { name: 'month' },
            { name: 'day' },
            { name: 'hour', time: true },
            { name: 'minute', time: true },
            { name: 'second', time: true }
          ]
        }
    }
    await window.malevo.world.setEntity('calendar', id, value)
    if (kind === 'script') await window.malevo.world.setScript(id, SCRIPT_TEMPLATE)
    setAdding(false)
    setSelected(id)
  }

  return (
    <div className="split-tool">
      <nav className="split-list">
        <h2>Calendars</h2>
        <ul>
          {snapshot.calendars.map((c) => (
            <li key={c.id}>
              <button
                className={c.id === selected ? 'list-item is-current' : 'list-item'}
                onClick={() => setSelected(c.id)}
                data-calendar={c.id}
              >
                <span>{c.name}</span>
                <span className={c.error ? 'error small' : 'muted small'}>
                  {c.error ? 'problem' : (KINDS.find((k) => k.kind === c.kind)?.label ?? c.kind)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="add-kinds">
            {KINDS.map((k) => (
              <button key={k.kind} className="list-item" onClick={() => void add(k.kind)} title={k.about} data-add-kind={k.kind}>
                <span>{k.label}</span>
                <span className="muted small">{k.about}</span>
              </button>
            ))}
            <button className="link" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="primary" onClick={() => setAdding(true)} id="newCalendar">
            New calendar…
          </button>
        )}
      </nav>
      <div className="split-detail">
        {current ? (
          <CalendarEditor key={current.id} cal={current} snapshot={snapshot} now={now} onDeleted={() => setSelected(null)} />
        ) : (
          <p className="muted">Choose a calendar, or make a new one.</p>
        )}
      </div>
    </div>
  )
}

function CalendarEditor({
  cal,
  snapshot,
  now,
  onDeleted
}: {
  cal: CalendarInfo
  snapshot: WorldSnapshot
  now: number
  onDeleted(): void
}): React.JSX.Element {
  const value = cal.value as CalValue | null
  const preview = useFormattedOne(cal.error ? null : cal.id, now, 'second', snapshot.version)
  const others = snapshot.calendars.filter((c) => c.id !== cal.id)
  const save = (patch: Record<string, unknown>): void => void window.malevo.world.setEntity('calendar', cal.id, { ...value, ...patch })

  const users = [
    ...snapshot.events.filter((e) => JSON.stringify(e.value ?? {}).includes(`"${cal.id}"`)).map((e) => `event “${e.value?.name ?? e.id}”`),
    ...others.filter((c) => JSON.stringify(c.value ?? {}).includes(`"${cal.id}"`)).map((c) => `calendar “${c.name}”`)
  ]
  const remove = (): void => {
    const msg = users.length
      ? `Delete “${cal.name}”?\n\nThese use it and will show errors:\n${users.map((u) => `• ${u}`).join('\n')}`
      : `Delete “${cal.name}”?`
    if (window.confirm(msg)) void window.malevo.world.deleteEntity('calendar', cal.id).then(onDeleted)
  }

  if (!value) {
    return (
      <div className="tool-page">
        <h1>{cal.id}</h1>
        <p className="error">This calendar's file has errors and cannot be edited here. See Checks, or fix {cal.path} by hand.</p>
      </div>
    )
  }

  return (
    <div className="tool-page calendar-editor" data-editing={cal.id}>
      <TextField label="Name" value={value.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} id="calendarName" />
      <p className="muted">{KINDS.find((k) => k.kind === value.kind)?.about}</p>

      {value.kind === 'fixed' && <FixedFields value={value} save={save} others={others} />}
      {value.kind === 'solar' && (
        <SolarFields
          value={value}
          save={save}
          others={others}
          bodies={snapshot.systems.flatMap((sys) =>
            sys.bodies.map((b) => ({ id: b.id, name: `${b.name} (${sys.name})`, solarDay: b.solarDay, year: b.year }))
          )}
        />
      )}
      {value.kind === 'era' && <EraFields value={value} save={save} others={others} />}
      {value.kind === 'offset' && <OffsetFields value={value} save={save} others={others} />}
      {value.kind === 'script' && <ScriptFields cal={cal} value={value} save={save} />}

      <div className="preview">
        <h3>The current date in this calendar</h3>
        {cal.error ? <p className="error">{cal.error}</p> : <code className="preview-date">{preview ?? '…'}</code>}
      </div>
      <div className="inspector-actions">
        <button className="danger" onClick={remove}>
          Delete…
        </button>
      </div>
      <p className="muted small">
        Saved as <code>{cal.path}</code>
        {value.kind === 'script' && (
          <>
            {' '}
            and <code>{cal.path.replace(/\.json$/, '.js')}</code>
          </>
        )}
      </p>
    </div>
  )
}

// ---- fields ----

function TextField({
  label,
  value,
  onCommit,
  id,
  mono
}: {
  label: string
  value: string
  onCommit(v: string): void
  id?: string
  mono?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className="field">
      {label}
      <input
        id={id}
        className={mono ? 'mono' : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  onCommit,
  hint,
  step
}: {
  label: string
  value: number
  onCommit(v: number): void
  hint?: string
  step?: number
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n)
    else setDraft(String(value))
  }
  return (
    <label className="field">
      {label}
      <input
        type="number"
        step={step ?? 'any'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  )
}

function BaseSelect({ value, others, onChange }: { value: string; others: CalendarInfo[]; onChange(v: string): void }): React.JSX.Element {
  return (
    <label className="field">
      Based on
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!others.some((c) => c.id === value) && <option value={value}>{value} (missing)</option>}
        {others.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function EpochField({
  value,
  others,
  save
}: {
  value: CalValue
  others: CalendarInfo[]
  save(p: Record<string, unknown>): void
}): React.JSX.Element {
  const epoch = value.epoch as Instant
  const cal = epoch.cal ?? others[0]?.id ?? 'gregorian'
  return (
    <label className="field">
      Year {String(value.epochYear)} begins at
      <DateInput
        calendars={others}
        cal={cal}
        text={epoch.text ?? ''}
        onCalendarChange={(c) => save({ epoch: { ...epoch, cal: c, text: undefined } })}
        onCommit={(d) => save({ epoch: { t_s: d.t, cal: d.cal, text: d.text } })}
      />
    </label>
  )
}

function UnitsTable({ units, onChange, withPer }: { units: Unit[]; onChange(u: Unit[]): void; withPer: boolean }): React.JSX.Element {
  const set = (i: number, patch: Partial<Unit>): void => onChange(units.map((u, k) => (k === i ? clean({ ...u, ...patch }) : u)))
  return (
    <table className="units">
      <thead>
        <tr>
          <th>Unit</th>
          {withPer && <th>How many in the unit above</th>}
          <th>Time of day</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {units.map((u, i) => (
          <tr key={i}>
            <td>
              <CellText value={u.name} onCommit={(name) => set(i, { name })} />
            </td>
            {withPer && (
              <td>{i === 0 ? <span className="muted">—</span> : <CellNumber value={u.per ?? 1} onCommit={(per) => set(i, { per })} />}</td>
            )}
            <td>
              <input
                type="checkbox"
                checked={Boolean(u.time)}
                onChange={(e) => set(i, { time: e.target.checked || undefined })}
                disabled={i === 0}
              />
            </td>
            <td>
              {units.length > 1 && (
                <button className="link" onClick={() => onChange(units.filter((_, k) => k !== i))}>
                  Remove
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4}>
            <button
              className="link"
              onClick={() =>
                onChange([...units, withPer ? { name: `unit${units.length + 1}`, per: 10 } : { name: `unit${units.length + 1}` }])
              }
            >
              Add a smaller unit
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function clean(u: Unit): Unit {
  const out: Unit = { name: u.name }
  if (u.per !== undefined) out.per = u.per
  if (u.first !== undefined) out.first = u.first
  if (u.time) out.time = true
  return out
}

function CellText({ value, onCommit }: { value: string; onCommit(v: string): void }): React.JSX.Element {
  const [d, setD] = useState(value)
  useEffect(() => setD(value), [value])
  return <input value={d} onChange={(e) => setD(e.target.value)} onBlur={() => d !== value && d.trim() && onCommit(d.trim())} />
}

function CellNumber({ value, onCommit }: { value: number; onCommit(v: number): void }): React.JSX.Element {
  const [d, setD] = useState(String(value))
  useEffect(() => setD(String(value)), [value])
  return (
    <input
      type="number"
      step={1}
      min={1}
      value={d}
      onChange={(e) => setD(e.target.value)}
      onBlur={() => Number(d) !== value && Number(d) >= 1 && onCommit(Math.trunc(Number(d)))}
    />
  )
}

const duration = (s: number): string => {
  if (!Number.isFinite(s)) return ''
  const h = s / 3600
  return h < 48 ? `${+h.toFixed(4)} standard hours` : `${+(s / 86400).toFixed(4)} standard days`
}

function FixedFields({
  value,
  save,
  others
}: {
  value: CalValue
  save(p: Record<string, unknown>): void
  others: CalendarInfo[]
}): React.JSX.Element {
  return (
    <>
      <EpochField value={value} others={others} save={save} />
      <NumberField
        label="Number of the epoch year"
        value={value.epochYear as number}
        step={1}
        onCommit={(epochYear) => save({ epochYear: Math.trunc(epochYear) })}
      />
      <h3>Units, largest first</h3>
      <UnitsTable units={value.units as Unit[]} onChange={(units) => save({ units })} withPer />
      <NumberField
        label="Length of the smallest unit, in seconds"
        value={value.smallestUnit_s as number}
        hint={duration(value.smallestUnit_s as number)}
        onCommit={(smallestUnit_s) => save({ smallestUnit_s })}
      />
    </>
  )
}

function SolarFields({
  value,
  save,
  others,
  bodies
}: {
  value: CalValue
  save(p: Record<string, unknown>): void
  others: CalendarInfo[]
  bodies: { id: string; name: string; solarDay: number | null; year: number | null }[]
}): React.JSX.Element {
  const followed = value.body ? bodies.find((b) => b.id === value.body) : undefined
  const day = (followed ? followed.solarDay : value.dayLength_s) as number
  const year = (followed ? followed.year : value.yearLength_s) as number
  const months = (value.months as { name: string; days: number }[] | undefined) ?? []
  const perYear = year / day
  const total = months.reduce((s, m) => s + m.days, 0)
  const leap = `${+perYear.toFixed(4)} local days, so a leap day about ${perYear % 1 ? `every ${+(1 / (perYear % 1)).toFixed(2)} years` : 'never'}`
  return (
    <>
      <label className="field">
        Follows
        <select
          value={value.body ? String(value.body) : ''}
          onChange={(e) =>
            e.target.value
              ? save({ body: e.target.value, dayLength_s: undefined, yearLength_s: undefined })
              : save({
                  body: undefined,
                  dayLength_s: Number.isFinite(day) && day > 0 ? day : 86400,
                  yearLength_s: Number.isFinite(year) && year > 0 ? year : 365.2422 * 86400
                })
          }
        >
          <option value="">the day and year given below</option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {value.body ? (
        <p className="muted">
          {followed && Number.isFinite(day) && day > 0
            ? `A day of ${duration(day)} (noon to noon) and a year of ${duration(year)}: ${leap}. They follow the body, so editing its orbit or spin changes them.`
            : 'That body has no solar day to follow (it is missing, or always shows the same face to its star).'}
        </p>
      ) : (
        <>
          <NumberField
            label="Length of the local day (noon to noon), seconds"
            value={day}
            hint={duration(day)}
            onCommit={(dayLength_s) => save({ dayLength_s })}
          />
          <NumberField
            label="Length of the year it follows, seconds"
            value={year}
            hint={`${duration(year)}; ${leap}`}
            onCommit={(yearLength_s) => save({ yearLength_s })}
          />
        </>
      )}
      <EpochField value={value} others={others} save={save} />
      <NumberField
        label="Number of the epoch year"
        value={value.epochYear as number}
        step={1}
        onCommit={(epochYear) => save({ epochYear: Math.trunc(epochYear) })}
      />
      <div className="field-row">
        <NumberField
          label="Local hours per day"
          value={value.hoursPerDay as number}
          step={1}
          onCommit={(n) => save({ hoursPerDay: Math.trunc(n) })}
        />
        <NumberField
          label="Minutes per hour"
          value={value.minutesPerHour as number}
          step={1}
          onCommit={(n) => save({ minutesPerHour: Math.trunc(n) })}
        />
        <NumberField
          label="Seconds per minute"
          value={value.secondsPerMinute as number}
          step={1}
          onCommit={(n) => save({ secondsPerMinute: Math.trunc(n) })}
        />
      </div>
      <h3>Months (optional)</h3>
      {months.length > 0 && (
        <p className={total === Math.floor(perYear) ? 'muted small' : 'error small'}>
          The months add up to {total} days; a common year has {Math.floor(perYear)}. Leap days go to{' '}
          {months[(value.leapMonth as number | undefined) ?? months.length - 1]?.name ?? 'the last month'}.
        </p>
      )}
      <table className="units">
        <tbody>
          {months.map((m, i) => (
            <tr key={i}>
              <td>
                <CellText value={m.name} onCommit={(name) => save({ months: months.map((x, k) => (k === i ? { ...x, name } : x)) })} />
              </td>
              <td>
                <CellNumber value={m.days} onCommit={(days) => save({ months: months.map((x, k) => (k === i ? { ...x, days } : x)) })} />
              </td>
              <td>
                <label className="check small">
                  <input
                    type="radio"
                    name="leap"
                    checked={((value.leapMonth as number | undefined) ?? months.length - 1) === i}
                    onChange={() => save({ leapMonth: i })}
                  />
                  takes leap days
                </label>
              </td>
              <td>
                <button
                  className="link"
                  onClick={() => save({ months: months.length > 1 ? months.filter((_, k) => k !== i) : undefined, leapMonth: undefined })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="link" onClick={() => save({ months: [...months, { name: `Month ${months.length + 1}`, days: 30 }] })}>
        Add a month
      </button>
    </>
  )
}

function EraFields({
  value,
  save,
  others
}: {
  value: CalValue
  save(p: Record<string, unknown>): void
  others: CalendarInfo[]
}): React.JSX.Element {
  return (
    <>
      <BaseSelect value={value.base as string} others={others} onChange={(base) => save({ base })} />
      <div className="field-row">
        <NumberField
          label="Counts from its base's year"
          value={value.epochYear as number}
          step={1}
          onCommit={(n) => save({ epochYear: Math.trunc(n) })}
        />
        <NumberField
          label="Which it calls year"
          value={value.firstYear as number}
          step={1}
          onCommit={(n) => save({ firstYear: Math.trunc(n) })}
        />
        <label className="field">
          Counting
          <select value={value.direction as string} onChange={(e) => save({ direction: e.target.value })}>
            <option value="forward">forward from it</option>
            <option value="backward">back to it</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <TextField label="Written before the year" value={value.prefix as string} onCommit={(prefix) => save({ prefix })} />
        <TextField label="Written after the year" value={value.suffix as string} onCommit={(suffix) => save({ suffix })} />
      </div>
    </>
  )
}

function OffsetFields({
  value,
  save,
  others
}: {
  value: CalValue
  save(p: Record<string, unknown>): void
  others: CalendarInfo[]
}): React.JSX.Element {
  return (
    <>
      <BaseSelect value={value.base as string} others={others} onChange={(base) => save({ base })} />
      <NumberField
        label="Ahead of it by, seconds (negative for behind)"
        value={value.offset_s as number}
        hint={duration(Math.abs(value.offset_s as number))}
        onCommit={(offset_s) => save({ offset_s })}
      />
    </>
  )
}

function ScriptFields({
  cal,
  value,
  save
}: {
  cal: CalendarInfo
  value: CalValue
  save(p: Record<string, unknown>): void
}): React.JSX.Element {
  const [code, setCode] = useState(cal.script ?? '')
  useEffect(() => setCode(cal.script ?? ''), [cal.script])
  return (
    <>
      <h3>Units the script's fields use, largest first</h3>
      <UnitsTable units={value.units as Unit[]} onChange={(units) => save({ units })} withPer={false} />
      <h3>Script</h3>
      <textarea
        className="code"
        spellCheck={false}
        value={code}
        rows={Math.min(40, Math.max(12, code.split('\n').length + 1))}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => code !== (cal.script ?? '') && void window.malevo.world.setScript(cal.id, code)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.currentTarget
            const { selectionStart: a, selectionEnd: b } = el
            setCode(code.slice(0, a) + '  ' + code.slice(b))
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
          }
        }}
      />
      <p className="muted small">The script is applied when you leave the editor; the preview below then uses it.</p>
    </>
  )
}

export const calendarsTool: ToolDefinition = {
  id: 'calendars',
  title: 'Calendars',
  description: 'The ways this world counts time',
  View: CalendarsView
}
