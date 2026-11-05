import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { AU, C, DAY, G0, JULIAN_YEAR, LY, flipAndBurnTime, lightYears } from '@malevo/core'
import {
  planRoute,
  readWorld,
  routeInfo,
  routeKind,
  routeWorld,
  runChecks,
  serializeEntity,
  suggestBalancing,
  templateFiles,
  trafficReport,
  worldStars,
  type RouteFile,
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
const world = (extra: WorldFile[]) =>
  readWorld([{ path: 'world.json', text: '{"format": 1, "name": "T", "seed": 77}' }, ...templateFiles(), ...extra])
const station = (id: string, x: number, y = 0, more: object = {}): WorldFile =>
  json(`stations/${id}.json`, { name: id.toUpperCase(), pos_ly: [x, y, 0], ...more })
const route = (id: string, v: Partial<RouteFile> & { stops: string[] }): WorldFile =>
  json(`routes/${id}.json`, { name: id, waypoints: v.stops.map((s) => ({ station: s })), services: v.services })
const routeIssues = (w: ReturnType<typeof world>) => runChecks(w, {}).filter((i) => i.check === 'routes')

// The template's physics: top speed 6500 c, stopover 1 day, leg limit 15 ly, tolerance 2% or 1/day.
const foamDays = (ly: number): number => (ly * JULIAN_YEAR) / 6500 / DAY

describe('directed traffic', () => {
  const stations = [station('a', 0), station('r', 10), station('b', 20)]

  it('carries a rest stop’s through traffic one way only', () => {
    const w = world([...stations, route('arb', { stops: ['a', 'r', 'b'], services: [{ from: 0, to: 2, perDay: 17 }] })])
    const r = routeInfo(w, {}, 'arb')!
    expect(r.legs.map((l) => l.ly)).toEqual([10, 10])
    const s = r.services[0]
    expect(s.stops).toEqual(['station:a', 'station:r', 'station:b'])
    // Stations have no collapse zone to crawl through: foam time plus one stopover at R.
    expect(s.duration! / DAY).toBeCloseTo(foamDays(20) + 1, 9)
    expect(s.fleet).toBeCloseTo(17 * (foamDays(20) + 1), 9)

    const t = trafficReport(w, {})!
    const by = Object.fromEntries(t.nodes.map((n) => [n.node, n]))
    expect(by['station:r']).toMatchObject({ arrivals: 17, departures: 17, net: 0, through: 17 })
    expect(by['station:a']).toMatchObject({ arrivals: 0, departures: 17 })
    expect(by['station:b']).toMatchObject({ arrivals: 17, departures: 0 })
    expect(t.inTransit['station:a→station:r']).toBeCloseTo(17 * foamDays(10), 9)

    const issues = routeIssues(w)
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['unbalanced', 'stations/a.json'],
      ['unbalanced', 'stations/b.json']
    ])
  })

  it('proposes return flows, which balance the network once added', () => {
    const services = [
      { from: 0, to: 2, perDay: 17 },
      { from: 2, to: 0, perDay: 7 }
    ]
    const w = world([...stations, route('arb', { stops: ['a', 'r', 'b'], services })])
    const p = suggestBalancing(w, {})!
    expect(p.remaining).toEqual({})
    // B → R and R → A, joined into one service through R.
    expect(p.suggestions).toEqual([{ route: 'arb', from: 2, to: 0, perDay: 10 }])
    const fixed = world([
      ...stations,
      route('arb', {
        stops: ['a', 'r', 'b'],
        services: [...services, ...p.suggestions.map(({ from, to, perDay }) => ({ from, to, perDay }))]
      })
    ])
    expect(routeIssues(fixed)).toEqual([])
  })

  it('accepts declared sinks and sources, and wants them to cancel', () => {
    const svc = [{ from: 0, to: 2, perDay: 0.2 }]
    // 0.2 a day is under the 1/day floor anyway; make it count with more traffic each way.
    const base = [
      { from: 0, to: 2, perDay: 100 },
      { from: 2, to: 0, perDay: 90 }
    ]
    const both = world([
      station('a', 0, 0, { declaredNet_perDay: -10 }),
      station('r', 10),
      station('b', 20, 0, { declaredNet_perDay: 10 }),
      route('arb', { stops: ['a', 'r', 'b'], services: base })
    ])
    expect(routeIssues(both)).toEqual([])
    const oneSided = world([
      station('a', 0),
      station('r', 10),
      station('b', 20, 0, { declaredNet_perDay: 10 }),
      route('arb', { stops: ['a', 'r', 'b'], services: base })
    ])
    expect(routeIssues(oneSided).map((i) => i.code)).toEqual(['declared-total', 'unbalanced'])
    // Below the tolerance floor, nothing is reported.
    expect(routeIssues(world([...stations, route('arb', { stops: ['a', 'r', 'b'], services: svc })]))).toEqual([])
  })

  it('flags legs that are too long or cross a nebula, and services that do not fit the route', () => {
    const nebula = json('nebulae/veil.json', { name: 'The Veil', center_ly: [15, 0, 0], radii_ly: [1, 3, 3] })
    const w = world([
      station('a', 0),
      station('far', 16),
      station('b', 30),
      nebula,
      route('bad', {
        stops: ['a', 'far', 'b', 'b'],
        services: [
          { from: 0, to: 4, perDay: 1 },
          { from: 1, to: 1, perDay: 1 }
        ]
      })
    ])
    expect(routeIssues(w).map((i) => [i.code, i.field])).toEqual([
      ['bad-service', 'services[0]'],
      ['bad-service', 'services[1]'],
      ['crosses-nebula', 'waypoints[1]'],
      ['leg-too-long', 'waypoints[1]'],
      ['repeated-waypoint', 'waypoints[3]']
    ])
    const bad = world([station('a', 0), json('routes/x.json', { name: 'x', waypoints: [{ station: 'a', star: 'hyg.0' }, {}] })])
    expect(routeIssues(bad).filter((i) => i.code === 'bad-waypoint')).toHaveLength(2)
  })

  it('writes route files in canonical form', () => {
    const v: RouteFile = { name: 'R', waypoints: [{ station: 'a' }, { star: 'hyg.0' }], services: [{ from: 1, to: 0, perDay: 3.5 }] }
    const text = serializeEntity(routeKind, v)
    const w = world([{ path: 'routes/r.json', text }])
    expect(w.issues).toEqual([])
    expect(w.entities.get('route/r')!.canonical).toBe(text)
  })
})

describe('planning and crawl times', () => {
  it('plans around a nebula through stations', () => {
    const line = [0, 8, 16, 24].map((x, i) => station(`s${i}`, x))
    const detour = [station('up1', 8, 8), station('up2', 16, 8)]
    const neb = json('nebulae/n.json', { name: 'N', center_ly: [12, 0, 0], radii_ly: [5, 2, 2] })
    const open = world([...line, ...detour])
    // No catalogue: only the stations are candidates.
    expect(planRoute(open, {}, 'station:s0', 'station:s3')!.waypoints).toEqual([
      { station: 's0' },
      { station: 's1' },
      { station: 's2' },
      { station: 's3' }
    ])
    const blocked = planRoute(world([...line, ...detour, neb]), {}, 'station:s0', 'station:s3')!
    expect(blocked.waypoints.map((w) => w.station)).toEqual(['s0', 'up1', 'up2', 's3'])
    expect(planRoute(world([station('a', 0), station('b', 40)]), {}, 'station:a', 'station:b')).toBeNull()
  })

  it('crawls between the dock and the collapse edge of a real system', () => {
    const w = world([
      json('systems/sol.json', { name: 'Sol', star: 'hyg.0', port: 'earth' }),
      json('bodies/earth.json', {
        name: 'Earth',
        system: 'sol',
        class: 'rocky',
        orbit: { a_au: 1, e: 0, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
        mass_mearth: 1,
        radius_km: 6371,
        rotation: { period_h: 24, tilt_deg: 23 }
      })
    ])
    const sol = routeWorld(w, env).node('system:sol')
    // Template collapse radius 2.7 AU around one solar mass; Sol's catalogue mass estimate is close to 1.
    expect(sol.crawlDistance! / AU).toBeGreaterThan(1.6)
    expect(sol.crawlDistance! / AU).toBeLessThan(1.8)
    expect(sol.crawlIn).toBeCloseTo(flipAndBurnTime(sol.crawlDistance!, G0), 6)
    expect(sol.crawlOut!).toBeLessThan(sol.crawlIn!)
    // The star node for Sol is the system.
    expect(routeWorld(w, env).node('star:hyg.0').system).toBe('sol')

    // A plan to a star some 40 ly away goes through the atlas, every leg within the limit.
    const target = worldStars(w, env)
      .near([0, 0, 0], 45)
      .find((s) => lightYears(s.pos, [0, 0, 0]) > 38 && !s.generated)!
    const plan = planRoute(w, env, 'system:sol', `star:${target.id}`)!
    expect(plan.waypoints[0]).toEqual({ system: 'sol' })
    expect(plan.waypoints.at(-1)).toEqual({ star: target.id })
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(4)
    const pos = (wp: (typeof plan.waypoints)[number]) => routeWorld(w, env).node(wp.system ? `system:${wp.system}` : `star:${wp.star}`).pos!
    for (let i = 1; i < plan.waypoints.length; i++)
      expect(lightYears(pos(plan.waypoints[i - 1]), pos(plan.waypoints[i]))).toBeLessThanOrEqual(15)
    expect(plan.duration).toBeGreaterThan(sol.crawlOut! + (plan.ly * LY) / (6500 * C))
  })
})
