import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  cityTravel,
  newCityPlan,
  planGeometry,
  portCapacity,
  readWorld,
  runChecks,
  serializeEntity,
  solarSystem,
  templateFiles,
  type CityPlanFile,
  type WorldEnv,
  type WorldFile
} from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const sol = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))

// A plan (nobody's city): a straight tram along an avenue, a lighter field, and a port.
const plan = (over: Partial<CityPlanFile> = {}): CityPlanFile => ({
  ...newCityPlan('harbour'),
  lines: [
    {
      id: 'avenue',
      kind: 'avenue',
      pts: [
        [-1900, 0],
        [1900, 0]
      ]
    },
    {
      id: 'tram',
      kind: 'lightrail',
      pts: [
        [-1900, 20],
        [1900, 20]
      ],
      service: { headway_s: 600, speed_ms: 15, accel_ms2: 1, dwell_s: 20, stopEvery_m: 600, hours: [5, 23] }
    }
  ],
  points: [{ id: 'field', name: 'Lighter field', kind: 'field', pos: [1500, 800] }],
  orbit: { field: 'field', flight_min: 40, windowGap_min: 90 },
  port: {
    spacing_min: 20,
    berths: 40,
    daysInStack: 2,
    lighters: 30,
    flightsPerLighter: 4,
    containersPerFreighter: 3000,
    lighterCapacity: 200,
    fieldMovements: 400
  },
  ...over
})

const world = (p: CityPlanFile, extra: WorldFile[] = []) =>
  readWorld([
    { path: 'world.json', text: '{"format": 1, "name": "P", "seed": 5}' },
    ...templateFiles(),
    ...sol(),
    json('cities/harbour.json', { name: 'Harbour', body: 'earth', lat_deg: 10, lon_deg: 20, port: 'main' }),
    json('cityplans/harbour.json', p),
    ...extra
  ])

describe('city plans', () => {
  it('load, generate and check clean', () => {
    const w = world(plan())
    expect(w.issues).toEqual([])
    expect(runChecks(w, env).filter((i) => i.check === 'cityplans' || i.severity === 'error')).toEqual([])
    const g = planGeometry(w, 'harbour')!
    expect(g.stats.byKind.avenue).toBeGreaterThan(0)
    expect(g.stats.byKind.lamp).toBeGreaterThan(0)
  })

  it('rides the tram when it is quicker than walking, and walks when it is not running', () => {
    const day = cityTravel(plan(), [-1850, 0], [1850, 0], 8 * 3600)
    if ('error' in day) throw new Error(day.error)
    const walkAll = (3700 * 1.3) / 1.3
    expect(day.total).toBeLessThan(walkAll / 2)
    expect(day.legs.map((l) => l.mode)).toContain('ride')
    // Waits are never longer than a headway.
    for (const l of day.legs.filter((x) => x.mode === 'wait')) expect(l.duration).toBeLessThanOrEqual(600)
    const night = cityTravel(plan(), [-1850, 0], [1850, 0], 2 * 3600)
    if ('error' in night) throw new Error(night.error)
    expect(night.legs.every((l) => l.mode === 'walk')).toBe(true)
    expect(night.total).toBeCloseTo(walkAll, -1)
  })

  it('gets to orbit by way of the lighter field', () => {
    const r = cityTravel(plan(), [0, 0], 'orbit', 10 * 3600)
    if ('error' in r) throw new Error(r.error)
    expect(r.legs.at(-1)).toMatchObject({ mode: 'orbit', duration: (45 + 40) * 60 })
  })

  it('weighs the port against the ships the routes bring', () => {
    const cap = portCapacity(world(plan()), env, plan())!
    // 3000 containers at 200 a flight: 15 trips per freighter. Fleet 30 × 4 / 15 = 8 a day binds.
    expect(cap.tripsPerFreighter).toBe(15)
    expect(cap.binding).toBe('fleet')
    expect(cap.capacity).toBeCloseTo(8, 6)
    expect(cap.demand).toBe(0)
    // Routes bring 12 a day into Sol: more than the port can take.
    const busy = world(plan(), [
      json('systems/b.json', { name: 'B', star: 'hip.71683' }),
      json('routes/sol-b.json', {
        name: 'Sol–B',
        waypoints: [{ system: 'sol' }, { system: 'b' }],
        services: [
          { from: 0, to: 1, perDay: 12 },
          { from: 1, to: 0, perDay: 12 }
        ]
      })
    ])
    expect(portCapacity(busy, env, plan())!.demand).toBe(12)
    expect(
      runChecks(busy, env)
        .filter((i) => i.check === 'cityplans')
        .map((i) => i.code)
    ).toEqual(['port-overloaded'])
  })
})
