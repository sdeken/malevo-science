import { describe, expect, it } from 'vitest'
import { DAY, buildCalendars, parseInstant } from '@malevo/core'
import {
  affinityAt,
  cultureCalendarAt,
  cultureFiles,
  cultureSettings,
  derivedAffinity,
  historyAt,
  readWorld,
  relationId,
  runChecks,
  systemHistory,
  templateFiles,
  whenResolver,
  worldCalendars,
  type CultureFile,
  type CultureSettings,
  type RelationFile,
  type SystemFile,
  type WorldFile
} from '@malevo/model'

// Synthetic cultures only (docs/PLAN.md P0).
const greg = buildCalendars({ g: { kind: 'gregorian' } }).get('g')!
const at = (text: string): number => parseInstant(greg, text)!
const files = (extra: WorldFile[]): WorldFile[] => [
  { path: 'world.json', text: '{"format": 1, "name": "T", "seed": 3}' },
  ...templateFiles(),
  ...extra
]
const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const culture = (traits: Record<string, number>, extra: Partial<CultureFile> = {}): CultureFile => ({
  name: 'C',
  color: '#336699',
  traits,
  ...extra
})
const ev = (id: string, text: string): WorldFile =>
  json(`events/${id}.json`, { name: id, type: 'event', when: { at: { t_s: at(text), cal: 'gregorian', text } } })

const settings: CultureSettings = {
  traits: [
    { id: 'openness', label: 'Openness', weight: 1 },
    { id: 'trade', label: 'Trade', weight: 0.5 }
  ],
  affinity: { opennessTrait: 'openness', closedFloor: 0.25 }
}

describe('affinity from traits', () => {
  it('is 1 for identical open cultures, colder for closed ones, −1 for opposites', () => {
    const open = culture({ openness: 1, trade: 0.5 })
    const closed = culture({ openness: 0, trade: 0.5 })
    expect(derivedAffinity(open, open, settings)).toBeCloseTo(1, 10)
    expect(derivedAffinity(closed, closed, settings)).toBeCloseTo(2 * 0.25 - 1, 10)
    expect(derivedAffinity(culture({ openness: 1, trade: 1 }), culture({ openness: 0, trade: 0 }), settings)).toBeCloseTo(-1, 10)
  })

  it('is symmetric, bounded, and falls as cultures differ', () => {
    const a = culture({ openness: 0.8, trade: 0.2 })
    const b = culture({ openness: 0.6, trade: 0.9 })
    const c = culture({ openness: 0.8, trade: 0.3 })
    expect(derivedAffinity(a, b, settings)).toBe(derivedAffinity(b, a, settings))
    expect(derivedAffinity(a, c, settings)).toBeGreaterThan(derivedAffinity(a, b, settings))
    for (let i = 0; i < 200; i++) {
      const x = culture({ openness: (i * 0.37) % 1, trade: (i * 0.61) % 1 })
      const y = culture({ openness: (i * 0.73) % 1, trade: (i * 0.19) % 1 })
      const v = derivedAffinity(x, y, settings)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('treats missing traits as neutral and ignores zero-weight ones', () => {
    expect(derivedAffinity(culture({}), culture({ openness: 0.5, trade: 0.5 }), settings)).toBeCloseTo(
      derivedAffinity(culture({}), culture({}), settings),
      10
    )
    const zero: CultureSettings = { ...settings, traits: [{ id: 'trade', label: 'Trade', weight: 0 }] }
    expect(derivedAffinity(culture({ openness: 1, trade: 0 }), culture({ openness: 1, trade: 1 }), zero)).toBeCloseTo(1, 10)
  })
})

describe('affinity over time', () => {
  const a = culture({ openness: 0.9, trade: 0.5 })
  const b = culture({ openness: 0.9, trade: 0.6 })
  const times: Record<string, number> = { war: at('2800'), peace: at('2810') }
  const eventTime = (id: string): number | null => times[id] ?? null
  const relation: RelationFile = {
    between: ['a', 'b'],
    changes: [
      { event: 'peace', affinity: 0.3, note: 'treaty' },
      { event: 'war', affinity: -0.9 },
      { event: 'unknown', affinity: 1 }
    ]
  }

  it('follows the latest change at or before the date', () => {
    expect(affinityAt(a, b, relation, settings, at('2799'), eventTime).source).toBe('traits')
    expect(affinityAt(a, b, relation, settings, at('2805'), eventTime)).toMatchObject({ value: -0.9, source: 'change' })
    expect(affinityAt(a, b, relation, settings, at('2900'), eventTime)).toMatchObject({
      value: 0.3,
      source: 'change',
      change: { event: 'peace', note: 'treaty' }
    })
    expect(affinityAt(a, b, { ...relation, affinity: 0.1 }, settings, at('2700'), eventTime)).toMatchObject({ value: 0.1, source: 'set' })
    expect(relationId('zeta', 'alpha')).toBe('alpha--zeta')
  })
})

describe('in a world', () => {
  const sys = (history: SystemFile['history']): WorldFile => json('systems/home.json', { name: 'Home', star: 'hyg.0', history })
  const world = readWorld(
    files([
      ev('settled', '2600'),
      ev('takeover', '2750-03'),
      ev('reform', '2900'),
      json('cultures/plains.json', {
        name: 'Plains',
        color: '#aa5500',
        traits: { openness: 0.8, wanderlust: 0.3 },
        calendars: [{ calendar: 'gregorian' }, { calendar: 'reckoning', from: 'reform' }]
      }),
      json('cultures/hill.json', { name: 'Hill', color: '#0055aa', traits: { openness: 0.1 } }),
      json('calendars/reckoning.json', { name: 'Reckoning', kind: 'offset', base: 'gregorian', offset_s: 0 }),
      json('polities/league.json', { name: 'League', color: '#225522', culture: 'plains', founded: 'takeover', dissolved: 'settled' }),
      json('relations/hill--plains.json', { between: ['plains', 'hill'], changes: [{ event: 'takeover', affinity: -0.5 }] }),
      json('relations/plains--wrong.json', { between: ['plains', 'hill'] }),
      sys([
        {
          from: { after: 'takeover' },
          polity: 'league',
          cultures: [
            { culture: 'plains', share: 3 },
            { culture: 'hill', share: 1 }
          ]
        },
        { from: { after: 'settled', cal: 'gregorian', offset: { year: 10 } }, cultures: [{ culture: 'hill', share: 1 }] },
        { from: { after: 'nowhere' } },
        { from: { after: 'takeover' }, cultures: [{ culture: 'hill', share: 0 }] }
      ])
    ])
  )
  const resolver = whenResolver(world, worldCalendars(world))

  it('orders a system’s history and finds who held it when', () => {
    const history = systemHistory(world.entities.get('system/home')!.value as SystemFile, resolver)
    expect(history.map((h) => h.index)).toEqual([1, 0, 3, 2])
    expect(historyAt(history, at('2500'))).toBeNull()
    expect(historyAt(history, at('2700'))!.cultures).toEqual([{ culture: 'hill', share: 1 }])
    const later = historyAt(history, at('2800'))!
    expect(later.index).toBe(3) // the same moment as entry 0; the later one in the file wins
    const entry0 = history.find((h) => h.index === 0)!
    expect(entry0.polity).toBe('league')
    expect(entry0.cultures).toEqual([
      { culture: 'plains', share: 0.75 },
      { culture: 'hill', share: 0.25 }
    ])
    expect(history.find((h) => h.index === 2)!.errors[0]).toMatch(/does not exist/)
  })

  it('knows which calendar a culture uses when', () => {
    const plains = cultureFiles(world).get('plains')!
    const start = (id: string): number | null => resolver.events().get(id)?.start?.t ?? null
    expect(cultureCalendarAt(plains, at('2850'), start)).toBe('gregorian')
    expect(cultureCalendarAt(plains, at('2950'), start)).toBe('reckoning')
    expect(cultureCalendarAt(cultureFiles(world).get('hill')!, at('2950'), start)).toBeNull()
  })

  it('reports what does not hang together', () => {
    const codes = runChecks(world).map((i) => `${i.path} ${i.code}`)
    expect(codes).toContain('cultures/plains.json unknown-trait')
    expect(codes).toContain('relations/plains--wrong.json bad-relation')
    expect(codes).toContain('polities/league.json polity-dates')
    expect(codes).toContain('systems/home.json history-date')
    expect(codes).toContain('systems/home.json empty-history')
    expect(codes).toContain('systems/home.json empty-shares')
    expect(codes).toContain('systems/home.json same-date')
    expect(codes).not.toContain('relations/hill--plains.json bad-relation')
    expect(cultureSettings(world)!.traits.map((t) => t.id)).toEqual(['openness', 'trade', 'expansion'])
  })

  it('a well-formed cultures world checks clean', () => {
    const clean = readWorld(
      files([
        ev('treaty', '2700'),
        json('cultures/a.json', { name: 'A', color: '#111111', traits: { openness: 0.4 } }),
        json('cultures/b.json', { name: 'B', color: '#222222', traits: { openness: 0.6 } }),
        json('relations/a--b.json', { between: ['a', 'b'], affinity: 0.2, changes: [{ event: 'treaty', affinity: 0.7 }] }),
        json('polities/p.json', { name: 'P', color: '#333333', culture: 'a', founded: 'treaty' })
      ])
    )
    expect(runChecks(clean).filter((i) => i.severity !== 'info')).toEqual([])
    expect(DAY).toBe(86400)
  })
})
