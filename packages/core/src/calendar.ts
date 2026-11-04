/**
 * Calendars (docs/PLAN.md §5.2). A calendar is a way of reading universal
 * time; it never changes an instant. Each world defines its calendars as data,
 * from these built-in kinds:
 *
 * - gregorian: proleptic Gregorian, no leap seconds.
 * - fixed:     nested units of exact length, no intercalation.
 * - solar:     a planet's local calendar from its solar day and year, with a
 *              leap rule that keeps the year in step with the seasons.
 * - era:       a year count laid over another calendar.
 * - offset:    another calendar shifted by a fixed amount, like a time zone.
 *
 * Script calendars (JavaScript in the world folder) arrive in Phase 2 and
 * implement the same `Calendar` interface.
 *
 * Every calendar has the same numeric written form, which `format` writes and
 * `parse` reads: the year, then the other date units joined by "-", then the
 * time units joined by ":", e.g. "2026-11-04 22:30:00". An era replaces the
 * year with its own label ("AE 450-03-12").
 */
import type { Instant } from './time'
import { DAY } from './units'

export type Fields = Record<string, number>

export interface CalendarUnit {
  name: string
  /** The value the unit starts counting from (1 for months and days, 0 for hours). The top unit has none. */
  first: number
  /** Part of the time of day rather than the date. */
  time: boolean
}

export interface Calendar {
  readonly id: string
  readonly kind: string
  /** Largest first. units[0] is always the year (or whatever the calendar's top unit is called). */
  readonly units: readonly CalendarUnit[]
  /** Integer fields, except the last unit, which carries any fraction. */
  toFields(t: Instant): Fields
  /** Inverse of toFields. Missing smaller units take their first value. Out-of-range values roll over. */
  fromFields(fields: Partial<Fields>): Instant
  /** The year field as written, e.g. "2026", "-0044", "AE 450". */
  yearLabel(year: number): string
  /** Parse a year label back to the year field, or null. */
  parseYearLabel(text: string): number | null
}

export type CalendarDef =
  | { kind: 'gregorian' }
  | {
      kind: 'fixed'
      /** The instant the epoch year begins. */
      epoch: Instant
      /** The number of the year that begins at the epoch. */
      epochYear: number
      /** Largest first. Every unit but the first says how many of it make one of the unit above. */
      units: { name: string; per?: number; first?: number; time?: boolean }[]
      /** Length of the smallest unit in SI seconds. */
      smallestUnit_s: number
    }
  | {
      kind: 'solar'
      /** Length of the local solar day, SI seconds. */
      dayLength_s: number
      /** Length of the year the calendar tracks (normally the tropical year), SI seconds. */
      yearLength_s: number
      /** The instant the epoch year begins (local midnight on its first day). */
      epoch: Instant
      epochYear: number
      /** Local hours per local day, minutes per hour, seconds per minute. */
      hoursPerDay: number
      minutesPerHour: number
      secondsPerMinute: number
      /** Optional months, with their lengths in a common year; leap days go to `leapMonth` (default: the last). */
      months?: { name: string; days: number }[]
      leapMonth?: number
    }
  | {
      kind: 'era'
      base: string
      /** The base calendar's year that the era counts from. */
      epochYear: number
      /** The era's number for that year (0 or 1, usually). */
      firstYear: number
      /** Count forward from the epoch ("AE 450") or backward to it ("S−550"). */
      direction: 'forward' | 'backward'
      prefix: string
      suffix: string
    }
  | { kind: 'offset'; base: string; offset_s: number }
  | {
      kind: 'script'
      /** Largest first; the units the script's fields use. */
      units: { name: string; first?: number; time?: boolean }[]
      /** The script's functions, already sandboxed by the caller (see @malevo/model/node). */
      impl: ScriptCalendarImpl
    }

/**
 * What a script calendar provides. Calls may throw (a bug in the script, or a
 * time limit enforced by the sandbox); callers that format or parse treat a
 * throw like any other unreadable date.
 */
export interface ScriptCalendarImpl {
  toFields(t: Instant): Fields
  fromFields(fields: Fields): Instant
  yearLabel?(year: number): string
  parseYearLabel?(text: string): number | null
}

export class CalendarError extends Error {}

const floorDiv = (a: number, b: number): number => Math.floor(a / b)

// ---- Gregorian: Howard Hinnant's days_from_civil / civil_from_days, exact for any integer year ----

/** Days since 1970-01-01 of a proleptic Gregorian date (astronomical year numbering). */
export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0
  const era = floorDiv(y, 400)
  const yoe = y - era * 400
  const doy = floorDiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy
  return era * 146097 + doe - 719468
}

export function civilFromDays(z: number): [number, number, number] {
  z += 719468
  const era = floorDiv(z, 146097)
  const doe = z - era * 146097
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365)
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100))
  const mp = floorDiv(5 * doy + 2, 153)
  const d = doy - floorDiv(153 * mp + 2, 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
}

/** Days from 1970-01-01 to 2000-01-01; the epoch is noon of that day. */
const J2000_DAY = 10957
const J2000_SECOND_OF_DAY = DAY / 2

const STANDARD_TIME_UNITS: CalendarUnit[] = [
  { name: 'hour', first: 0, time: true },
  { name: 'minute', first: 0, time: true },
  { name: 'second', first: 0, time: true }
]

function plainYearLabel(year: number): string {
  const s = String(Math.abs(year)).padStart(4, '0')
  return year < 0 ? `-${s}` : s
}

function parsePlainYear(text: string): number | null {
  return /^[+-]?\d+$/.test(text.trim()) ? Number(text.trim()) : null
}

class GregorianCalendar implements Calendar {
  readonly kind = 'gregorian'
  readonly units: CalendarUnit[] = [
    { name: 'year', first: 0, time: false },
    { name: 'month', first: 1, time: false },
    { name: 'day', first: 1, time: false },
    ...STANDARD_TIME_UNITS
  ]
  constructor(readonly id: string) {}

  toFields(t: Instant): Fields {
    const fromMidnight = t + J2000_SECOND_OF_DAY
    const dayIndex = Math.floor(fromMidnight / DAY)
    const sec = fromMidnight - dayIndex * DAY
    const [year, month, day] = civilFromDays(J2000_DAY + dayIndex)
    const hour = Math.floor(sec / 3600)
    const minute = Math.floor((sec - hour * 3600) / 60)
    return { year, month, day, hour, minute, second: sec - hour * 3600 - minute * 60 }
  }

  fromFields(f: Partial<Fields>): Instant {
    const year = f.year ?? 0
    // Months roll over into years so that daysFromCivil always sees 1..12.
    const m0 = (f.month ?? 1) - 1
    const y = year + floorDiv(m0, 12)
    const m = m0 - floorDiv(m0, 12) * 12 + 1
    const days = daysFromCivil(y, m, 1) + (f.day ?? 1) - 1 - J2000_DAY
    return days * DAY + (f.hour ?? 0) * 3600 + (f.minute ?? 0) * 60 + (f.second ?? 0) - J2000_SECOND_OF_DAY
  }

  yearLabel = plainYearLabel
  parseYearLabel = parsePlainYear
}

class FixedCalendar implements Calendar {
  readonly kind = 'fixed'
  readonly units: CalendarUnit[]
  /** Length of each unit in seconds. */
  private readonly lengths: number[]

  constructor(
    readonly id: string,
    private readonly def: Extract<CalendarDef, { kind: 'fixed' }>
  ) {
    if (def.units.length === 0) throw new CalendarError('A fixed calendar needs at least one unit.')
    if (!(def.smallestUnit_s > 0)) throw new CalendarError('The smallest unit must be longer than zero seconds.')
    const lengths = new Array<number>(def.units.length)
    lengths[def.units.length - 1] = def.smallestUnit_s
    for (let i = def.units.length - 2; i >= 0; i--) {
      const per = def.units[i + 1].per
      if (!per || !Number.isInteger(per) || per < 1)
        throw new CalendarError(`Unit "${def.units[i + 1].name}" needs a whole "per" of 1 or more.`)
      lengths[i] = lengths[i + 1] * per
    }
    this.lengths = lengths
    this.units = def.units.map((u, i) => ({ name: u.name, first: i === 0 ? 0 : (u.first ?? (u.time ? 0 : 1)), time: Boolean(u.time) }))
    const names = new Set(this.units.map((u) => u.name))
    if (names.size !== this.units.length) throw new CalendarError('Unit names must be unique.')
  }

  toFields(t: Instant): Fields {
    let rem = t - this.def.epoch
    const out: Fields = {}
    const top = Math.floor(rem / this.lengths[0])
    out[this.units[0].name] = this.def.epochYear + top
    rem -= top * this.lengths[0]
    for (let i = 1; i < this.units.length; i++) {
      const last = i === this.units.length - 1
      const n = last ? rem / this.lengths[i] : Math.floor(rem / this.lengths[i])
      out[this.units[i].name] = this.units[i].first + n
      rem -= Math.floor(n) * this.lengths[i]
    }
    if (this.units.length === 1) out[this.units[0].name] = this.def.epochYear + (t - this.def.epoch) / this.lengths[0]
    return out
  }

  fromFields(f: Partial<Fields>): Instant {
    let t = this.def.epoch + ((f[this.units[0].name] ?? this.def.epochYear) - this.def.epochYear) * this.lengths[0]
    for (let i = 1; i < this.units.length; i++)
      t += ((f[this.units[i].name] ?? this.units[i].first) - this.units[i].first) * this.lengths[i]
    return t
  }

  yearLabel = plainYearLabel
  parseYearLabel = parsePlainYear
}

class SolarCalendar implements Calendar {
  readonly kind = 'solar'
  readonly units: CalendarUnit[]
  private readonly daysPerYear: number
  private readonly secondsPerLocalSecond: number

  constructor(
    readonly id: string,
    private readonly def: Extract<CalendarDef, { kind: 'solar' }>
  ) {
    if (!(def.dayLength_s > 0) || !(def.yearLength_s > def.dayLength_s)) {
      throw new CalendarError('A solar calendar needs a day length above zero and a year longer than a day.')
    }
    for (const k of ['hoursPerDay', 'minutesPerHour', 'secondsPerMinute'] as const) {
      if (!Number.isInteger(def[k]) || def[k] < 1) throw new CalendarError(`${k} must be a whole number of 1 or more.`)
    }
    this.daysPerYear = def.yearLength_s / def.dayLength_s
    this.secondsPerLocalSecond = def.dayLength_s / (def.hoursPerDay * def.minutesPerHour * def.secondsPerMinute)
    if (def.months) {
      const total = def.months.reduce((s, m) => s + m.days, 0)
      if (total !== Math.floor(this.daysPerYear)) {
        throw new CalendarError(
          `The months add up to ${total} days, but a common year has ${Math.floor(this.daysPerYear)} local days (a leap year one more).`
        )
      }
      if (def.months.some((m) => !Number.isInteger(m.days) || m.days < 1))
        throw new CalendarError('Every month needs a whole number of days.')
    }
    this.units = [
      { name: 'year', first: 0, time: false },
      ...(def.months ? [{ name: 'month', first: 1, time: false }] : []),
      { name: 'day', first: 1, time: false },
      ...STANDARD_TIME_UNITS
    ]
  }

  /** Local-day index (from the epoch) on which year `k` (relative to the epoch year) begins. */
  private yearStart(k: number): number {
    return Math.floor(k * this.daysPerYear + 0.5)
  }

  /** Days in each month of relative year k. */
  private monthLengths(k: number): number[] {
    const months = this.def.months!
    const lengths = months.map((m) => m.days)
    const extra = this.yearStart(k + 1) - this.yearStart(k) - Math.floor(this.daysPerYear)
    lengths[this.def.leapMonth ?? months.length - 1] += extra
    return lengths
  }

  toFields(t: Instant): Fields {
    const elapsed = t - this.def.epoch
    const dayIndex = Math.floor(elapsed / this.def.dayLength_s)
    let k = Math.floor(dayIndex / this.daysPerYear)
    while (this.yearStart(k) > dayIndex) k--
    while (this.yearStart(k + 1) <= dayIndex) k++
    let dayOfYear = dayIndex - this.yearStart(k)
    const out: Fields = { year: this.def.epochYear + k }
    if (this.def.months) {
      const lengths = this.monthLengths(k)
      let m = 0
      while (dayOfYear >= lengths[m]) dayOfYear -= lengths[m++]
      out.month = m + 1
    }
    out.day = dayOfYear + 1
    const local = (elapsed - dayIndex * this.def.dayLength_s) / this.secondsPerLocalSecond
    const perHour = this.def.minutesPerHour * this.def.secondsPerMinute
    out.hour = Math.floor(local / perHour)
    out.minute = Math.floor((local - out.hour * perHour) / this.def.secondsPerMinute)
    out.second = local - out.hour * perHour - out.minute * this.def.secondsPerMinute
    return out
  }

  fromFields(f: Partial<Fields>): Instant {
    const k = (f.year ?? this.def.epochYear) - this.def.epochYear
    let day = this.yearStart(k) + (f.day ?? 1) - 1
    if (this.def.months) {
      const lengths = this.monthLengths(k)
      for (let m = 0; m < (f.month ?? 1) - 1; m++) day += lengths[m % lengths.length]
    }
    const local = ((f.hour ?? 0) * this.def.minutesPerHour + (f.minute ?? 0)) * this.def.secondsPerMinute + (f.second ?? 0)
    return this.def.epoch + day * this.def.dayLength_s + local * this.secondsPerLocalSecond
  }

  /** Is relative year k a leap year (one day longer than common)? */
  isLeapYear(year: number): boolean {
    const k = year - this.def.epochYear
    return this.yearStart(k + 1) - this.yearStart(k) > Math.floor(this.daysPerYear)
  }

  yearLabel = plainYearLabel
  parseYearLabel = parsePlainYear
}

class ScriptCalendar implements Calendar {
  readonly kind = 'script'
  readonly units: CalendarUnit[]

  constructor(
    readonly id: string,
    private readonly def: Extract<CalendarDef, { kind: 'script' }>
  ) {
    if (def.units.length === 0) throw new CalendarError('A script calendar must declare at least one unit.')
    this.units = def.units.map((u, i) => ({ name: u.name, first: i === 0 ? 0 : (u.first ?? (u.time ? 0 : 1)), time: Boolean(u.time) }))
    if (new Set(this.units.map((u) => u.name)).size !== this.units.length) throw new CalendarError('Unit names must be unique.')
  }

  toFields(t: Instant): Fields {
    const raw = this.def.impl.toFields(t)
    const out: Fields = {}
    for (const u of this.units) {
      const v = raw?.[u.name]
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new CalendarError(`The script's toFields() gave no number for "${u.name}".`)
      out[u.name] = v
    }
    return out
  }

  fromFields(f: Partial<Fields>): Instant {
    const full: Fields = {}
    for (const u of this.units) full[u.name] = f[u.name] ?? u.first
    const t = this.def.impl.fromFields(full)
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new CalendarError("The script's fromFields() did not return a number.")
    return t
  }

  yearLabel(year: number): string {
    if (!this.def.impl.yearLabel) return plainYearLabel(year)
    const s = this.def.impl.yearLabel(year)
    if (typeof s !== 'string') throw new CalendarError("The script's yearLabel() did not return text.")
    return s
  }

  parseYearLabel(text: string): number | null {
    if (!this.def.impl.parseYearLabel) return parsePlainYear(text)
    const y = this.def.impl.parseYearLabel(text)
    return typeof y === 'number' && Number.isInteger(y) ? y : null
  }
}

class EraCalendar implements Calendar {
  readonly kind = 'era'
  constructor(
    readonly id: string,
    private readonly def: Extract<CalendarDef, { kind: 'era' }>,
    private readonly base: Calendar
  ) {}

  get units(): readonly CalendarUnit[] {
    return this.base.units
  }

  private toEra(baseYear: number): number {
    const d = this.def
    return d.direction === 'forward' ? baseYear - d.epochYear + d.firstYear : d.epochYear - baseYear + d.firstYear
  }

  private toBase(eraYear: number): number {
    const d = this.def
    return d.direction === 'forward' ? eraYear - d.firstYear + d.epochYear : d.epochYear + d.firstYear - eraYear
  }

  toFields(t: Instant): Fields {
    const f = this.base.toFields(t)
    const top = this.base.units[0].name
    return { ...f, [top]: this.toEra(f[top]) }
  }

  fromFields(f: Partial<Fields>): Instant {
    const top = this.base.units[0].name
    return this.base.fromFields({ ...f, [top]: this.toBase(f[top] ?? this.def.firstYear) })
  }

  yearLabel(year: number): string {
    return `${this.def.prefix}${year}${this.def.suffix}`
  }

  parseYearLabel(text: string): number | null {
    let s = text.trim()
    if (!s.startsWith(this.def.prefix) || !s.endsWith(this.def.suffix)) return null
    s = s.slice(this.def.prefix.length, s.length - this.def.suffix.length).trim()
    return /^[+-]?\d+$/.test(s) ? Number(s) : null
  }
}

class OffsetCalendar implements Calendar {
  readonly kind = 'offset'
  constructor(
    readonly id: string,
    private readonly def: Extract<CalendarDef, { kind: 'offset' }>,
    private readonly base: Calendar
  ) {}

  get units(): readonly CalendarUnit[] {
    return this.base.units
  }
  toFields(t: Instant): Fields {
    return this.base.toFields(t + this.def.offset_s)
  }
  fromFields(f: Partial<Fields>): Instant {
    return this.base.fromFields(f) - this.def.offset_s
  }
  yearLabel(year: number): string {
    return this.base.yearLabel(year)
  }
  parseYearLabel(text: string): number | null {
    return this.base.parseYearLabel(text)
  }
}

export interface CalendarSet {
  get(id: string): Calendar | undefined
  ids(): string[]
  /** Definitions that could not be built: unknown or circular bases, invalid parameters. */
  errors: { id: string; message: string }[]
}

/** Build every calendar of a world. Bases are resolved by id; a broken definition is reported, not thrown. */
export function buildCalendars(defs: Record<string, CalendarDef>): CalendarSet {
  const built = new Map<string, Calendar>()
  const errors: { id: string; message: string }[] = []
  const failed = new Set<string>()

  const build = (id: string, trail: string[]): Calendar | undefined => {
    if (built.has(id)) return built.get(id)
    if (failed.has(id)) return undefined
    const def = defs[id]
    if (!def) return undefined
    if (trail.includes(id)) {
      errors.push({ id, message: `Calendars form a cycle: ${[...trail, id].join(' → ')}.` })
      failed.add(id)
      return undefined
    }
    try {
      let cal: Calendar
      switch (def.kind) {
        case 'gregorian':
          cal = new GregorianCalendar(id)
          break
        case 'fixed':
          cal = new FixedCalendar(id, def)
          break
        case 'solar':
          cal = new SolarCalendar(id, def)
          break
        case 'script':
          cal = new ScriptCalendar(id, def)
          break
        case 'era':
        case 'offset': {
          if (!defs[def.base]) throw new CalendarError(`Its base calendar "${def.base}" does not exist.`)
          const base = build(def.base, [...trail, id])
          if (!base) throw new CalendarError(`Its base calendar "${def.base}" could not be built.`)
          cal = def.kind === 'era' ? new EraCalendar(id, def, base) : new OffsetCalendar(id, def, base)
          break
        }
        default:
          throw new CalendarError(`Unknown calendar kind "${(def as { kind: string }).kind}".`)
      }
      built.set(id, cal)
      return cal
    } catch (err) {
      if (!failed.has(id)) {
        failed.add(id)
        if (!errors.some((e) => e.id === id)) errors.push({ id, message: (err as Error).message })
      }
      return undefined
    }
  }

  for (const id of Object.keys(defs).sort()) build(id, [])
  return {
    get: (id) => built.get(id),
    ids: () => [...built.keys()].sort(),
    errors
  }
}

// ---- the written form ----

/**
 * Write an instant in a calendar, down to the unit named by `precision`
 * (default: minute, or the smallest unit if the calendar has no minutes).
 * Lower units are truncated, never rounded, so a date never reads later than it is.
 */
export function formatInstant(cal: Calendar, t: Instant, precision?: string): string {
  const f = cal.toFields(t)
  const units = cal.units
  let last = precision ? units.findIndex((u) => u.name === precision) : units.findIndex((u) => u.name === 'minute')
  if (last < 0) last = precision ? -1 : units.length - 1
  if (last < 0) throw new CalendarError(`Calendar "${cal.id}" has no unit "${precision}".`)
  const date: string[] = []
  const time: string[] = []
  for (let i = 1; i <= last; i++) {
    const text = String(Math.floor(f[units[i].name])).padStart(2, '0')
    ;(units[i].time ? time : date).push(text)
  }
  let out = cal.yearLabel(f[units[0].name])
  if (date.length) out += `-${date.join('-')}`
  if (time.length) out += ` ${time.join(':')}`
  return out
}

/**
 * Read the written form back. Accepts any prefix of the units ("2026",
 * "2026-11", "2026-11-04 22:30"). Rejects fields out of range for that
 * calendar (day 31 of a 30-day month), so a parsed date always round-trips.
 */
export function parseInstant(cal: Calendar, text: string): Instant | null {
  const s = text.trim()
  const units = cal.units
  const dateUnits = units.slice(1).filter((u) => !u.time)
  const timeUnits = units.slice(1).filter((u) => u.time)
  // The year label can itself hold "-" or spaces ("-0044", "AE 450"), so try every split, most specific first.
  let fields: Fields | null = null
  for (let tp = timeUnits.length; tp >= 0 && !fields; tp--) {
    for (let dp = dateUnits.length; dp >= 0 && !fields; dp--) {
      if (tp > 0 && dp < dateUnits.length) continue
      const datePat = dp ? `((?:-\\d+){${dp}})` : '()'
      const timePat = tp ? `\\s+(\\d+(?::\\d+){${tp - 1}}(?:\\.\\d+)?)` : '()'
      const m = new RegExp(`^(.+?)${datePat}${timePat}$`).exec(s)
      if (!m) continue
      let year: number | null
      try {
        year = cal.parseYearLabel(m[1])
      } catch {
        year = null
      }
      if (year === null) continue
      fields = { [units[0].name]: year }
      if (dp)
        m[2]
          .slice(1)
          .split('-')
          .forEach((v, i) => (fields![dateUnits[i].name] = Number(v)))
      if (tp) m[3].split(':').forEach((v, i) => (fields![timeUnits[i].name] = Number(v)))
    }
  }
  if (!fields) return null
  let t: Instant
  let back: Fields
  try {
    t = cal.fromFields(fields)
    back = cal.toFields(t)
  } catch {
    return null
  }
  // Range check: the fields must survive a round trip.
  for (const [k, v] of Object.entries(fields)) {
    const isLast = k === units[units.length - 1].name
    if (isLast ? Math.abs(back[k] - v) > 1e-6 : back[k] !== v) return null
  }
  return t
}
