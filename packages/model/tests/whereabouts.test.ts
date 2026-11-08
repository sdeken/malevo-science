import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  driftReport,
  readWorld,
  runChecks,
  serializeEntity,
  solarSystem,
  templateFiles,
  travellerReport,
  type DrifterFile,
  type TravellerFile,
  type WorldEnv,
  type WorldFile
} from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const DAY = 86400
const YEAR = 365.25 * DAY
const sol = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
const world = (extra: WorldFile[] = []) =>
  readWorld([
    { path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' },
    ...templateFiles(),
    ...sol(),
    { path: 'systems/prox.json', text: JSON.stringify({ name: 'Proxima', star: 'hip.70890' }) },
    ...extra
  ])

describe('a traveller', () => {
  const kativa = (gapDays: number): TravellerFile => ({
    name: 'Kativa',
    stops: [
      { place: { body: 'earth' }, depart: { t_s: 0 } },
      { place: { system: 'prox' }, arrive: { t_s: gapDays * DAY }, depart: { t_s: (gapDays + 2) * DAY } },
      { place: { body: 'mars' }, arrive: { t_s: (gapDays * 2 + 2) * DAY } }
    ]
  })

  it('checks each gap against the quickest trip the physics allows', () => {
    const fast = travellerReport(world(), env, kativa(2), 0)
    expect(fast.gaps[0].verdict).toBe('impossible')
    expect(fast.gaps[0].needed).toBeGreaterThan(5 * DAY) // crawl out, foam, crawl in: about a week door to door
    const slow = travellerReport(world(), env, kativa(12), 0)
    expect(slow.gaps.map((g) => g.verdict)).toEqual(['ok', 'ok'])
    expect(slow.stops[0].name).toBe('Earth, Sol')
  })

  it('times a hop inside one system as a flip-and-burn between the bodies', () => {
    const r = travellerReport(
      world(),
      env,
      {
        name: 'T',
        stops: [
          { place: { body: 'earth' }, depart: { t_s: 0 } },
          { place: { body: 'mars' }, arrive: { t_s: 2 * DAY } }
        ]
      },
      DAY
    )
    expect(r.gaps[0].how).toBe('in-system')
    expect(r.gaps[0].needed).toBeGreaterThan(DAY)
    expect(r.gaps[0].needed).toBeLessThan(6 * DAY)
    expect(r.now).toBe('On the way from Earth, Sol to Mars, Sol.')
  })

  it('is a world file the checks accept', () => {
    const w = world([{ path: 'travellers/kativa.json', text: JSON.stringify(kativa(12)) }])
    const issues = runChecks(w).filter((i) => i.path?.startsWith('travellers/'))
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([])
  })
})

describe('a drifter', () => {
  const voyager1: DrifterFile = {
    name: 'Voyager 1',
    from: { system: 'sol' },
    at: { t_s: 0 },
    speed_kms: 17,
    heading: { ra_deg: 258.25, dec_deg: 12.1 },
    cone_deg: 0.1
  }

  it('coasts in a straight line: Voyager 1 is about 0.07 ly out after 1,175 years', () => {
    const r = driftReport(world(), env, voyager1, 1175 * YEAR)
    if ('error' in r) throw new Error(r.error)
    expect(r.travelled_ly).toBeGreaterThan(0.06)
    expect(r.travelled_ly).toBeLessThan(0.075)
  })

  it('finds the stars it passes, in order, toward a place and at speed', () => {
    const r = driftReport(
      world(),
      env,
      { name: 'Hulk', from: { system: 'sol' }, at: { t_s: 0 }, speed_kms: 2000, heading: { toward: { system: 'prox' } } },
      0,
      {
        horizon_yr: 2000,
        passWithin_ly: 0.5
      }
    )
    if ('error' in r) throw new Error(r.error)
    const prox = r.passes.find((p) => p.system === 'prox')
    expect(prox).toBeDefined()
    expect(prox!.miss_ly).toBeLessThan(0.01)
    // 4.24 ly at 2,000 km/s is about 636 years.
    expect(prox!.t / YEAR).toBeGreaterThan(600)
    expect(prox!.t / YEAR).toBeLessThan(670)
    expect(r.passes.map((p) => p.t)).toEqual([...r.passes.map((p) => p.t)].sort((a, b) => a - b))
  })

  it('needs a heading', () => {
    expect(driftReport(world(), env, { ...voyager1, heading: {} }, 0)).toMatchObject({ error: expect.stringMatching(/heading/) })
  })
})
