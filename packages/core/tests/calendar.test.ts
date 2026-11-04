import { describe, expect, it } from 'vitest'
import { DAY, buildCalendars, formatInstant, julianDate, mulberry32, parseInstant, type Calendar, type CalendarDef } from '@malevo/core'

// Synthetic calendars only (docs/PLAN.md P0): none of these is any setting's calendar.
const defs: Record<string, CalendarDef> = {
  greg: { kind: 'gregorian' },
  tidy: {
    kind: 'fixed',
    epoch: 0,
    epochYear: 1,
    smallestUnit_s: 1,
    units: [
      { name: 'year' },
      { name: 'month', per: 12 },
      { name: 'day', per: 30 },
      { name: 'hour', per: 24, time: true },
      { name: 'minute', per: 60, time: true },
      { name: 'second', per: 60, time: true }
    ]
  },
  local: {
    kind: 'solar',
    dayLength_s: 1.19 * DAY,
    yearLength_s: 401.37 * 1.19 * DAY,
    epoch: 1000 * DAY,
    epochYear: 1,
    hoursPerDay: 24,
    minutesPerHour: 60,
    secondsPerMinute: 60,
    months: [
      { name: 'One', days: 100 },
      { name: 'Two', days: 100 },
      { name: 'Three', days: 100 },
      { name: 'Four', days: 101 }
    ]
  },
  forward: { kind: 'era', base: 'greg', epochYear: 2500, firstYear: 0, direction: 'forward', prefix: 'XE ', suffix: '' },
  backward: { kind: 'era', base: 'greg', epochYear: 2900, firstYear: 0, direction: 'backward', prefix: 'B−', suffix: '' },
  shifted: { kind: 'offset', base: 'greg', offset_s: 13 * 3600 + 27 * 60 }
}
const set = buildCalendars(defs)
const cal = (id: string): Calendar => {
  const c = set.get(id)
  if (!c) throw new Error(`no calendar ${id}`)
  return c
}

describe('building calendars', () => {
  it('builds every valid definition', () => {
    expect(set.errors).toEqual([])
    expect(set.ids()).toEqual(['backward', 'forward', 'greg', 'local', 'shifted', 'tidy'])
  })

  it('reports cycles, missing bases and bad parameters without throwing', () => {
    const broken = buildCalendars({
      a: { kind: 'offset', base: 'b', offset_s: 1 },
      b: { kind: 'offset', base: 'a', offset_s: 1 },
      c: { kind: 'era', base: 'nope', epochYear: 0, firstYear: 0, direction: 'forward', prefix: '', suffix: '' },
      d: { kind: 'fixed', epoch: 0, epochYear: 1, smallestUnit_s: 1, units: [{ name: 'year' }, { name: 'day' }] },
      e: {
        kind: 'solar',
        dayLength_s: DAY,
        yearLength_s: 10 * DAY,
        epoch: 0,
        epochYear: 1,
        hoursPerDay: 24,
        minutesPerHour: 60,
        secondsPerMinute: 60,
        months: [{ name: 'x', days: 3 }]
      },
      ok: { kind: 'gregorian' }
    })
    expect(broken.ids()).toEqual(['ok'])
    const byId = Object.fromEntries(broken.errors.map((e) => [e.id, e.message]))
    expect(byId.a).toMatch(/cycle/)
    expect(byId.c).toMatch(/does not exist/)
    expect(byId.d).toMatch(/per/)
    expect(byId.e).toMatch(/add up to 3 days/)
  })
})

describe('gregorian', () => {
  const g = cal('greg')

  it('puts the epoch at J2000.0 and agrees with Julian dates', () => {
    expect(formatInstant(g, 0, 'second')).toBe('2000-01-01 12:00:00')
    expect(julianDate(parseInstant(g, '1970-01-01 00:00')!)).toBe(2440587.5)
    expect(julianDate(parseInstant(g, '1858-11-17')!)).toBe(2400000.5) // the MJD epoch
  })

  it('agrees with JavaScript Date across its whole range', () => {
    const r = mulberry32(11)
    for (let i = 0; i < 5000; i++) {
      const ms = Math.floor((r() * 2 - 1) * 8.64e15)
      const d = new Date(ms)
      const t = Math.floor(ms / 1000) - 946728000
      const f = g.toFields(t)
      expect([f.year, f.month, f.day, f.hour, f.minute, Math.floor(f.second)]).toEqual([
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds()
      ])
      expect(g.fromFields(f)).toBe(t)
    }
  })

  it('handles leap years and refuses dates that do not exist', () => {
    expect(parseInstant(g, '2000-02-29')).not.toBeNull()
    expect(parseInstant(g, '2024-02-29')).not.toBeNull()
    expect(parseInstant(g, '1900-02-29')).toBeNull()
    expect(parseInstant(g, '2023-02-29')).toBeNull()
    expect(parseInstant(g, '2023-13-01')).toBeNull()
    expect(parseInstant(g, '2023-04-31')).toBeNull()
    expect(parseInstant(g, '2023-04-30 24:00')).toBeNull()
  })

  it('round-trips negative and far-future years', () => {
    for (const text of ['-0044-03-15 12:00', '0000-01-01 00:00', '9999-12-31 23:59', '-4713-11-24 12:00', '25000-06-30 06:15']) {
      expect(formatInstant(g, parseInstant(g, text)!)).toBe(text)
    }
    expect(julianDate(parseInstant(g, '-4713-11-24 12:00')!)).toBe(0) // JD 0 in the proleptic Gregorian calendar
  })

  it('accepts partial dates and formats at any precision', () => {
    const t = parseInstant(g, '2031-07')!
    expect(formatInstant(g, t, 'day')).toBe('2031-07-01')
    expect(formatInstant(g, t, 'year')).toBe('2031')
    expect(formatInstant(g, parseInstant(g, '2031-07-04 09')!, 'minute')).toBe('2031-07-04 09:00')
    expect(formatInstant(g, parseInstant(g, '2031-07-04 09:05:30.25')!, 'second')).toBe('2031-07-04 09:05:30')
    expect(parseInstant(g, '2031 09:00')).toBeNull()
    expect(parseInstant(g, 'banana')).toBeNull()
  })

  it('truncates rather than rounds', () => {
    expect(formatInstant(g, parseInstant(g, '2031-12-31 23:59:59.9')!, 'minute')).toBe('2031-12-31 23:59')
  })
})

describe('fixed', () => {
  const c = cal('tidy')

  it('has years of exactly 360 × 30-day months', () => {
    expect(formatInstant(c, 0, 'second')).toBe('0001-01-01 00:00:00')
    expect(c.fromFields({ year: 2 }) - c.fromFields({ year: 1 })).toBe(360 * DAY)
    expect(formatInstant(c, 360 * DAY - 1, 'second')).toBe('0001-12-30 23:59:59')
    expect(formatInstant(c, -1, 'second')).toBe('0000-12-30 23:59:59')
    expect(parseInstant(c, '0001-01-31')).toBeNull()
  })

  it('round-trips at random', () => {
    const r = mulberry32(5)
    for (let i = 0; i < 2000; i++) {
      const t = Math.floor((r() * 2 - 1) * 1e11)
      expect(c.fromFields(c.toFields(t))).toBeCloseTo(t, 3)
    }
  })
})

describe('solar', () => {
  const c = cal('local')
  const day = 1.19 * DAY
  const daysPerYear = 401.37

  it('keeps every year within half a local day of the true year', () => {
    for (let k = -500; k < 2000; k++) {
      const start = c.fromFields({ year: 1 + k })
      const ideal = 1000 * DAY + k * daysPerYear * day
      expect(Math.abs(start - ideal)).toBeLessThanOrEqual(day / 2 + 1e-3)
    }
  })

  it('makes leap years at the right rate, with the leap day in the last month', () => {
    let leap = 0
    for (let y = 1; y <= 1000; y++) {
      const len = (c.fromFields({ year: y + 1 }) - c.fromFields({ year: y })) / day
      expect([401, 402]).toContain(Math.round(len))
      if (Math.round(len) === 402) {
        leap++
        expect(parseInstant(c, `${String(y).padStart(4, '0')}-04-102`)).not.toBeNull()
      }
    }
    expect(leap).toBe(370) // 0.37 × 1000
  })

  it('divides the local day into local hours', () => {
    const noon = c.fromFields({ year: 3, month: 2, day: 10, hour: 12 })
    expect(formatInstant(c, noon, 'second')).toBe('0003-02-10 12:00:00')
    expect(c.fromFields({ year: 3, month: 2, day: 11 }) - c.fromFields({ year: 3, month: 2, day: 10 })).toBeCloseTo(day, 6)
  })

  it('round-trips at random', () => {
    const r = mulberry32(6)
    for (let i = 0; i < 2000; i++) {
      const t = Math.floor((r() * 2 - 1) * 1e11)
      expect(c.fromFields(c.toFields(t))).toBeCloseTo(t, 2)
    }
  })
})

describe('era and offset', () => {
  it('counts forward and backward from an epoch year', () => {
    const t = parseInstant(cal('greg'), '2950-03-12 08:00')!
    expect(formatInstant(cal('forward'), t)).toBe('XE 450-03-12 08:00')
    expect(formatInstant(cal('backward'), t, 'year')).toBe('B−-50')
    expect(parseInstant(cal('forward'), 'XE 450-03-12 08:00')).toBe(t)
    expect(formatInstant(cal('backward'), parseInstant(cal('greg'), '2350')!, 'year')).toBe('B−550')
    expect(parseInstant(cal('backward'), 'B−550')).toBe(parseInstant(cal('greg'), '2350'))
    expect(parseInstant(cal('forward'), '450-03-12')).toBeNull()
  })

  it('shifts by a fixed offset', () => {
    expect(formatInstant(cal('shifted'), 0)).toBe('2000-01-02 01:27')
    expect(parseInstant(cal('shifted'), '2000-01-02 01:27')).toBe(0)
  })
})
