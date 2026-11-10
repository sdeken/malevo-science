import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { JULIAN_YEAR } from '@malevo/core'
import {
  historyInput,
  newsArrival,
  proposeHistory,
  readWorld,
  runChecks,
  serializeEntity,
  templateFiles,
  type HistoryProposal,
  type WorldEnv,
  type WorldFile
} from '@malevo/model'
import { KINDS } from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const at = (year: number) => ({ at: { t_s: Math.round(year * JULIAN_YEAR) } })
const ev = (id: string, year: number, extra: object = {}) =>
  json(`events/${id}.json`, { name: id, type: 'event', when: at(year), ...extra })

// A fixture (nobody's setting): settlement from Sol, with two belief-free polities.
const base = (extra: WorldFile[] = []): WorldFile[] => [
  { path: 'world.json', text: '{"format": 1, "name": "Fixture", "seed": 21}' },
  ...templateFiles(),
  json('systems/sol.json', { name: 'Sol', star: 'hyg.0' }),
  json('cultures/first.json', { name: 'First', color: '#888888', traits: {}, palette: 4 }),
  json('cultures/belief.json', { name: 'Belief', color: '#c9a26b', traits: {}, palette: 1 }),
  json('polities/north.json', { name: 'North', color: '#4f86d9' }),
  json('polities/south.json', { name: 'South', color: '#e8a33d' }),
  ev('slow-ships', 300),
  ev('foam-drive', 650),
  ev('polities-form', 850),
  ev('run-end', 950),
  json('settings/history.json', {
    origin: 'sol',
    originCulture: 'first',
    slowShips: 'slow-ships',
    foamDrive: 'foam-drive',
    end: 'run-end',
    slow: { reach_ly: 12, colonies: 4 },
    growth: { systems: 45, maxRadius_ly: 60 },
    culture: { enclaveRate: 0.1, splitRate: 0.3, splitDistance_ly: 30, blendRate: 0.03 },
    enclaves: [{ culture: 'belief', from: 'foam-drive' }],
    polities: {
      from: 'polities-form',
      list: [
        { polity: 'north', share: 0.3 },
        { polity: 'south', share: 0.3, unify: 0.05 }
      ]
    }
  }),
  ...extra
]

const propose = (files: WorldFile[]): HistoryProposal => {
  const p = proposeHistory(readWorld(files), env)
  if ('error' in p) throw new Error(p.error)
  return p
}
/** The world with every proposed file accepted. */
const accepted = (files: WorldFile[], p: HistoryProposal): WorldFile[] => {
  const byPath = new Map(files.map((f) => [f.path, f]))
  for (const f of p.files)
    byPath.set(f.path, {
      path: f.path,
      text: serializeEntity(
        KINDS.find((k) => k.kind === f.kind)!,
        f.value as never
      )
    })
  return [...byPath.values()]
}

describe('the history generator on a world', () => {
  it('proposes systems, cultures, routes and events that make a valid world', () => {
    const p = propose(base())
    expect(p.counts.systems).toBeGreaterThan(30)
    expect(p.counts.routes).toBeGreaterThan(20)
    expect(p.counts.events).toBeGreaterThan(3)
    expect(p.files.some((f) => f.group === 'polity')).toBe(true) // capitals for both polities
    const w = readWorld(accepted(base(), p))
    expect(w.issues).toEqual([])
    const bad = runChecks(w, env).filter((i) => i.severity === 'error' || i.check === 'history' || i.code === 'star-mass-unknown')
    expect(bad).toEqual([])
    // Repeatable.
    expect(propose(base())).toEqual(p)
  })

  it('keeps what exists, and what was accepted, as fixed points', () => {
    // An authored system settled at a date is not proposed again, and nothing else is put on its star.
    const files = base([
      json('systems/kept.json', {
        name: 'Kept',
        star: 'hip.87937',
        history: [{ from: at(700), polity: 'north', cultures: [{ culture: 'belief', share: 1 }] }]
      })
    ])
    const prep = historyInput(readWorld(files), env)
    if ('error' in prep) throw new Error(prep.error)
    expect(prep.input.fixed.find((f) => f.star === 'hip.87937')).toMatchObject({ year: 700, polity: 'north', mix: { belief: 1 } })
    const p = propose(files)
    expect(p.files.filter((f) => f.group === 'system' && f.stars[0] === 'hip.87937')).toEqual([])
    // Accept everything, then run again: the accepted systems are now fixed, so almost nothing new is proposed.
    const again = propose(accepted(files, p))
    expect(again.counts.systems).toBeLessThan(p.counts.systems / 4)
  })

  it('checks that nothing is settled before it could be', () => {
    const w = readWorld(base([json('systems/early.json', { name: 'Early', star: 'hip.87937', history: [{ from: at(200) }] })]))
    expect(
      runChecks(w, env)
        .filter((i) => i.check === 'history')
        .map((i) => i.code)
    ).toEqual(['settled-too-early'])
    const w2 = readWorld(base([json('systems/far.json', { name: 'Far', star: 'hip.97649', history: [{ from: at(400) }] })]))
    expect(
      runChecks(w2, env)
        .filter((i) => i.check === 'history')
        .map((i) => i.code)
    ).toEqual(['beyond-slow-ships'])
  })
})

describe('polities that come about by founding', () => {
  /** The base world with North expanding from Sol and South federating from its breakaways. */
  const founding = (over: object = {}): WorldFile[] => {
    const files = base()
    const i = files.findIndex((f) => f.path === 'settings/history.json')
    const settings = JSON.parse(files[i].text!) as Record<string, unknown>
    delete settings.polities
    files[i] = json('settings/history.json', {
      ...settings,
      growth: { systems: 70, maxRadius_ly: 70 },
      founding: {
        list: [
          { polity: 'north', mode: 'expand', from: 'slow-ships' },
          { polity: 'south', mode: 'federate', from: 'polities-form' }
        ],
        breakaway: { rate: 0.3, distance_ly: 20, minAge_y: 30 },
        minor: { rate: 0.01, size: 3, minAge_y: 30, max: 10 },
        ...over
      }
    })
    return files
  }

  it('proposes system histories that change polity, minor polities, and a capital for each', () => {
    const p = propose(founding())
    expect(p.conflicts).toEqual([])
    const sys = p.files.filter((f) => f.group === 'system')
    const polityOf = (f: (typeof sys)[number]): string[] => ((f.value.history as { polity?: string }[]) ?? []).map((h) => h.polity ?? '-')
    expect(sys.some((f) => polityOf(f).includes('north'))).toBe(true)
    expect(sys.some((f) => polityOf(f).includes('south'))).toBe(true)
    // Some systems were North's, then broke away (independent), then South's.
    expect(sys.some((f) => /north,(-,)+.*south/.test(polityOf(f).join(',')))).toBe(true)
    // South gets the capital the run chose; North's is at Sol.
    expect(p.files.find((f) => f.key === 'polity/south')?.value.capital).toBeTruthy()
    expect(p.files.find((f) => f.key === 'polity/north')?.value.capital).toBe('sol')
    // Everything accepted makes a valid world.
    const w = readWorld(accepted(founding(), p))
    expect(w.issues).toEqual([])
    const bad = runChecks(w, env).filter((i) => i.severity === 'error')
    expect(bad).toEqual([])
    expect(propose(founding())).toEqual(p)
  })

  it('names new minor polities and gives them colours', () => {
    const p = propose(founding({ minor: { rate: 0.05, size: 3, minAge_y: 20, max: 10 } }))
    const minors = p.files.filter((f) => f.group === 'polity' && !f.change)
    expect(minors.length).toBeGreaterThan(0)
    for (const m of minors) {
      expect(m.value.tags).toEqual(['minor', 'history'])
      expect(String(m.value.color)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('news', () => {
  it('goes by ship once the foam drive exists, faster than radio, and by radio before', () => {
    const p = propose(base())
    const files = accepted(base(), p)
    const after = readWorld([...files, ev('news', 900, { where: 'sol' })])
    const n = newsArrival(after, env, 'news')
    if ('error' in n) throw new Error(n.error)
    const byShip = n.arrivals.filter((a) => a.via === 'ships')
    expect(byShip.length).toBeGreaterThan(10)
    // A ship crosses tens of light-years in days; radio takes decades. (Some places wait for their route to open.)
    const quick = byShip.filter((a) => (a.t - n.t0) / JULIAN_YEAR < 1)
    expect(quick.length).toBeGreaterThan(byShip.length / 2)
    const far = quick.sort((a, b) => b.t - a.t)[0]
    expect(far.path[0]).toBe('sol')
    expect(far.path.length).toBeGreaterThan(2)
    const before = readWorld([...files, ev('old-news', 500, { where: 'sol' })])
    const m = newsArrival(before, env, 'old-news')
    if ('error' in m) throw new Error(m.error)
    const notHere = m.arrivals.filter((a) => a.via !== 'here')
    expect(notHere.every((a) => a.via === 'radio' || a.t >= 650 * JULIAN_YEAR)).toBe(true)
  })
})
