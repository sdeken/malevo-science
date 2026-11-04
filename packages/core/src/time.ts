/**
 * Universal time (docs/PLAN.md §5.1).
 *
 * There is one time, the same everywhere: no relativistic clock effects. An
 * instant is a number of SI seconds since the internal epoch, J2000.0
 * (2000-01-01 12:00:00 on the Gregorian calendar, read with no leap seconds).
 * Whole seconds are exact in a double for about ±285 million years.
 *
 * The epoch is an implementation detail: files store instants through
 * calendars, and nothing in a world depends on the epoch's meaning.
 */
import { DAY, HOUR, MINUTE, WEEK } from './units'

/** Seconds since J2000.0. */
export type Instant = number

/** Julian Date of the epoch. */
export const JD_J2000 = 2451545.0

export function julianDate(t: Instant): number {
  return JD_J2000 + t / DAY
}

export function fromJulianDate(jd: number): Instant {
  return (jd - JD_J2000) * DAY
}

/** Julian centuries since J2000, the argument of most ephemeris series. */
export function julianCenturies(t: Instant): number {
  return t / (36525 * DAY)
}

/** Duration units with a fixed length. Years and months are calendar matters, so they are not here. */
export const DURATION_UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  second: 1,
  seconds: 1,
  min: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  h: HOUR,
  hr: HOUR,
  hour: HOUR,
  hours: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
  w: WEEK,
  week: WEEK,
  weeks: WEEK
}

/**
 * Parse a fixed-length duration: "90 s", "2.5 h", "3 d 4 h", "-1 w". Returns
 * seconds, or null if the text is not a duration made only of fixed units.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim()
  if (!s) return null
  const re = /([+-]?\d+(?:\.\d+)?)\s*([a-z]+)/gi
  let total = 0
  let consumed = ''
  let match: RegExpExecArray | null
  while ((match = re.exec(s))) {
    const unit = DURATION_UNITS[match[2].toLowerCase()]
    if (unit === undefined) return null
    total += Number(match[1]) * unit
    consumed += match[0]
  }
  if (consumed.replace(/\s+/g, '') !== s.replace(/\s+/g, '')) return null
  return total
}
