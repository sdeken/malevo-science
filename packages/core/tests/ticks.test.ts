import { describe, expect, it } from 'vitest'
import {
  DAY,
  buildCalendars,
  calendarTicks,
  daysFromCivil,
  civilFromDays,
  formatInstant,
  parseInstant,
  type Calendar,
  type CalendarDef
} from '@malevo/core'

// A synthetic script calendar: a 10-day week counted from an epoch, years of 36 weeks (360 days), with its own year label.
const scriptDef: CalendarDef = {
  kind: 'script',
  units: [{ name: 'cycle' }, { name: 'week' }, { name: 'day' }, { name: 'hour', time: true }],
  impl: {
    toFields(t) {
      const days = Math.floor(t / DAY)
      const cycle = Math.floor(days / 360)
      const inYear = days - cycle * 360
      return { cycle, week: Math.floor(inYear / 10) + 1, day: (inYear % 10) + 1, hour: (t - days * DAY) / 3600 }
    },
    fromFields(f) {
      return ((f.cycle * 360 + (f.week - 1) * 10 + (f.day - 1)) * 24 + f.hour) * 3600
    },
    yearLabel: (y) => `C${y}`,
    parseYearLabel: (s) => (/^C-?\d+$/.test(s) ? Number(s.slice(1)) : null)
  }
}

const set = buildCalendars({
  greg: { kind: 'gregorian' },
  tidy: {
    kind: 'fixed',
    epoch: 0,
    epochYear: 1,
    smallestUnit_s: DAY,
    units: [{ name: 'year' }, { name: 'month', per: 12 }, { name: 'day', per: 30 }]
  },
  scripted: scriptDef,
  broken: { kind: 'script', units: [{ name: 'year' }], impl: { toFields: () => ({}), fromFields: () => NaN } }
})
const cal = (id: string): Calendar => set.get(id)!
const g = cal('greg')
const at = (text: string): number => parseInstant(g, text)!

describe('script calendars', () => {
  it('format and parse through the script, with its own year label', () => {
    const c = cal('scripted')
    expect(formatInstant(c, 365 * DAY)).toBe('C1-01-06 00')
    expect(parseInstant(c, 'C1-01-06 00')).toBe(365 * DAY)
    expect(parseInstant(c, 'C1-01-11')).toBeNull() // day 11 of a 10-day week does not exist
    expect(parseInstant(c, '1-01-06')).toBeNull()
  })

  it('reports a script that returns nonsense instead of passing it on', () => {
    const b = cal('broken')
    expect(() => b.toFields(0)).toThrow(/no number for "year"/)
    expect(() => b.fromFields({ year: 1 })).toThrow(/did not return a number/)
    expect(parseInstant(b, '0001')).toBeNull()
  })

  it('is built like any other calendar, and needs units', () => {
    const bad = buildCalendars({ x: { kind: 'script', units: [], impl: scriptDef.kind === 'script' ? scriptDef.impl : (null as never) } })
    expect(bad.errors[0].message).toMatch(/at least one unit/)
  })
})

describe('calendarTicks', () => {
  const check = (c: Calendar, t0: number, t1: number, target: number): ReturnType<typeof calendarTicks> => {
    const ts = calendarTicks(c, t0, t1, target)
    expect(ts.ticks.length).toBeGreaterThan(0)
    expect(ts.ticks.length).toBeLessThanOrEqual(target + 2)
    for (let i = 0; i < ts.ticks.length; i++) {
      expect(ts.ticks[i].t).toBeGreaterThanOrEqual(t0)
      expect(ts.ticks[i].t).toBeLessThanOrEqual(t1)
      if (i) expect(ts.ticks[i].t).toBeGreaterThan(ts.ticks[i - 1].t)
    }
    return ts
  }

  it('picks decades for a century', () => {
    const ts = check(g, at('2000'), at('2100'), 10)
    expect([ts.unit, ts.step]).toEqual(['year', 10])
    expect(ts.ticks.map((t) => t.label)).toEqual(['2000', '2010', '2020', '2030', '2040', '2050', '2060', '2070', '2080', '2090', '2100'])
  })

  it('picks months within a year, and restarts day steps at each month', () => {
    const months = check(g, at('2024-01-01'), at('2024-12-31'), 8)
    expect(months.unit).toBe('month')
    expect(months.ticks.map((t) => t.label)).toEqual(['2024-01', '2024-03', '2024-05', '2024-07', '2024-09', '2024-11'])
    const days = check(g, at('2024-01-20'), at('2024-03-05'), 12)
    expect(days.unit).toBe('day')
    expect(days.ticks.filter((t) => t.major).map((t) => t.label)).toEqual(['2024-02-01', '2024-03-01'])
    expect(days.ticks.map((t) => t.label)).toContain('2024-02-01')
  })

  it('handles very long spans and negative years', () => {
    const ts = check(g, at('-50000'), at('50000'), 10)
    expect(ts.step).toBe(10000)
    expect(ts.ticks[0].label).toBe('-50000')
  })

  it('works in fixed and script calendars', () => {
    const tidy = check(cal('tidy'), 0, 3 * 360 * DAY, 12)
    expect(tidy.unit).toBe('month')
    const s = check(cal('scripted'), 0, 360 * DAY, 20)
    expect([s.unit, s.step]).toEqual(['week', 2])
    expect(s.ticks.slice(0, 3).map((t) => t.label)).toEqual(['C0-01', 'C0-03', 'C0-05'])
    // Day steps never exceed a 10-day week.
    const d = check(cal('scripted'), 0, 60 * DAY, 30)
    expect(d.unit).toBe('day')
    expect(d.step).toBeLessThan(10)
  })

  it('returns nothing for an empty range', () => {
    expect(calendarTicks(g, 5, 5).ticks).toEqual([])
  })

  it('agrees with the civil-day helpers', () => {
    expect(civilFromDays(daysFromCivil(2024, 2, 29))).toEqual([2024, 2, 29])
  })
})
