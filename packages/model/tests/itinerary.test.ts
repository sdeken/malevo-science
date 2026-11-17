import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  encounters,
  itineraryOverview,
  itineraryReport,
  newCityPlan,
  positionAt,
  readWorld,
  runChecks,
  serializeEntity,
  solarSystem,
  templateFiles,
  type CityPlanFile,
  type ItineraryFile,
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

// A plan (nobody's city): a tram along an avenue, a lighter field, a hotel, a terrace and a flat.
const plan: CityPlanFile = {
  ...newCityPlan('harbour'),
  lines: [
    {
      id: 'tram',
      kind: 'lightrail',
      pts: [
        [-1900, 20],
        [1900, 20]
      ],
      service: { headway_s: 600, speed_ms: 15, accel_ms2: 1, dwell_s: 20, stopEvery_m: 600, hours: [0, 24] }
    }
  ],
  points: [
    { id: 'field', name: 'Lighter field', kind: 'field', pos: [1500, 800] },
    { id: 'customs', name: 'Customs hall', kind: 'label', pos: [1450, 700] },
    { id: 'hotel', name: 'The hotel', kind: 'label', pos: [-1500, 60] },
    { id: 'terrace', name: 'The terrace', kind: 'label', pos: [-1450, 120] },
    { id: 'flat', name: 'The flat', kind: 'label', pos: [200, 40] }
  ],
  orbit: { field: 'field', flight_min: 40, windowGap_min: 90 }
}

const H = 3600
const T0 = 100 * 86400
const at = (h: number) => ({ t_s: T0 + h * H })

const itinerary: ItineraryFile = {
  name: 'Kay',
  city: 'harbour',
  stops: [
    { place: { orbit: 'earth' }, depart: at(0) },
    { place: { point: 'field' }, by: 'lighter' },
    { place: { point: 'customs' }, by: 'fixed', minutes: 40 },
    { place: { point: 'hotel' }, stay_min: 30 },
    { place: { point: 'terrace' }, by: 'walk', arrive: at(6) },
    { place: { point: 'flat' }, stay_min: 300 },
    { place: { point: 'hotel' }, arrive: at(20) }
  ]
}

const world = (extra: WorldFile[] = []) =>
  readWorld([
    { path: 'world.json', text: '{"format": 1, "name": "I", "seed": 5}' },
    ...templateFiles(),
    ...sol(),
    json('cities/harbour.json', { name: 'Harbour', body: 'earth', lat_deg: 10, lon_deg: 20 }),
    json('cityplans/harbour.json', plan),
    json('itineraries/kay.json', itinerary),
    ...extra
  ])

describe('itineraries', () => {
  it('load and check clean', () => {
    const w = world()
    expect(w.issues).toEqual([])
    expect(runChecks(w, env).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('work the day through: lighter windows, a fixed customs desk, the tram, walking, and pinned times', () => {
    const r = itineraryReport(world(), env, 'kay', itinerary)
    expect(r.problems).toEqual([])
    const [orbit, field, customs, hotel, terrace, flat, back] = r.stops
    expect(orbit.depart).toBe(T0)
    // The lighter waits for a window (every 90 min from local midnight), then flies 40 min.
    expect(field.leg!.by).toBe('lighter')
    expect(field.arrive! - T0).toBeGreaterThanOrEqual(40 * 60)
    expect(field.arrive! - T0).toBeLessThanOrEqual((40 + 90) * 60 + 1)
    expect(customs.arrive! - field.arrive!).toBe(40 * 60)
    // Across town: the tram, with walks at each end.
    expect(hotel.leg!.summary).toMatch(/ride/)
    expect(hotel.leg!.duration).toBeGreaterThan(5 * 60)
    expect(hotel.leg!.duration).toBeLessThan(60 * 60)
    // Early for the pinned terrace time: she is there on the dot, with slack to spare.
    expect(terrace.slack!).toBeGreaterThan(0)
    expect(terrace.arrive).toBe(at(6).t_s)
    expect(terrace.leg!.by).toBe('walk')
    // Sleeps at least 5 h at the flat.
    expect(flat.depart! - flat.arrive!).toBe(300 * 60)
    expect(back.slack!).toBeGreaterThan(0)
    expect(r.stops.every((s) => s.problems.length === 0)).toBe(true)
    // Positions: on the plan once down, nowhere while in orbit.
    expect(positionAt(r, T0 + 60).pos).toBe(null)
    expect(positionAt(r, at(7).t_s).pos).toEqual([200, 40])
  })

  it('says when she would be late, and when a pinned departure cuts a stay short', () => {
    const late: ItineraryFile = {
      ...itinerary,
      stops: [
        { place: { point: 'hotel' }, depart: at(1) },
        { place: { point: 'flat' }, by: 'walk', arrive: at(1.05), stay_min: 60, depart: at(1.5) }
      ]
    }
    const r = itineraryReport(world(), env, 'kay', late)
    expect(r.stops[1].slack!).toBeLessThan(0)
    expect(r.stops[1].problems.join(' ')).toMatch(/late/)
    expect(r.stops[1].problems.join(' ')).toMatch(/cuts her stay short/)
  })

  it('finds when two people are together', () => {
    const other: ItineraryFile = {
      name: 'Ro',
      city: 'harbour',
      stops: [
        { place: { point: 'flat' }, depart: at(5) },
        { place: { point: 'terrace' }, arrive: at(6), stay_min: 20 }
      ]
    }
    const w = world([json('itineraries/ro.json', other)])
    const o = itineraryOverview(w, env)
    expect(o.reports).toHaveLength(2)
    const meet = o.encounters.find((e) => e.label === 'The terrace')
    expect(meet).toBeTruthy()
    expect(meet!.t0).toBeLessThanOrEqual(at(6).t_s)
    expect(encounters(o.reports.slice(0, 1))).toEqual([])
  })
})
