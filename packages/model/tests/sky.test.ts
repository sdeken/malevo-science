import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DAY, DEG, HOUR, altAz, toLocal } from '@malevo/core'
import {
  approachInfo,
  approachSeries,
  meridianForNoon,
  readWorld,
  routeWorld,
  runChecks,
  skyScene,
  skyStars,
  templateFiles,
  type SkyScene,
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
const orbit = (a_au: number, meanAnomaly_deg = 0) => ({
  a_au,
  e: 0,
  i_deg: 0,
  node_deg: 0,
  peri_deg: 0,
  meanAnomaly_deg,
  epoch: { t_s: 0 }
})

// A fixture world (nothing here is anyone's setting): a planet with air around Sol, two neighbours, and routes.
function fixture(sol_b_perDay = 27, extra: WorldFile[] = []) {
  return readWorld([
    { path: 'world.json', text: '{"format": 1, "name": "Fixture", "seed": 3}' },
    ...templateFiles(),
    json('systems/sol.json', { name: 'Sol', star: 'hyg.0', port: 'terra' }),
    json('systems/b.json', { name: 'B', star: 'hip.71683' }),
    json('systems/c.json', { name: 'C', star: 'hip.87937' }),
    json('bodies/terra.json', {
      name: 'Terra',
      system: 'sol',
      class: 'rocky',
      orbit: orbit(1),
      mass_mearth: 1,
      radius_km: 6371,
      rotation: { period_h: 24, tilt_deg: 23.44 },
      atmosphere: { pressure_atm: 1 }
    }),
    json('routes/sol-b.json', {
      name: 'Sol–B',
      waypoints: [{ system: 'sol' }, { system: 'b' }],
      services: [
        { from: 0, to: 1, perDay: sol_b_perDay },
        { from: 1, to: 0, perDay: 7 }
      ]
    }),
    json('routes/c-sol.json', {
      name: 'C–Sol',
      waypoints: [{ system: 'c' }, { system: 'sol' }],
      services: [{ from: 0, to: 1, perDay: 3 }]
    }),
    json('routes/b-c.json', { name: 'B–C', waypoints: [{ system: 'b' }, { system: 'c' }], services: [{ from: 0, to: 1, perDay: 5 }] }),
    json('viewpoints/city.json', { name: 'A city', body: 'terra', lat_deg: 30, lon_deg: 0 }),
    ...extra
  ])
}

const vp = { body: 'terra', lat_deg: 30, lon_deg: 0 }
const scene = (w: ReturnType<typeof fixture>, t: number): SkyScene => {
  const s = skyScene(w, env, vp, t)
  if ('error' in s) throw new Error(s.error)
  return s
}

describe('principle P2: the sky shows the route network’s own numbers', () => {
  it('shows exactly the routes that touch the planet’s system, with λ × crawl time torches each', () => {
    const w = fixture()
    const issues = runChecks(w, env).filter((i) => i.severity === 'error')
    expect(issues).toEqual([])
    const s = scene(w, 3.7 * DAY)
    // Sol–B both ways, C–Sol inbound only; B–C never reaches Sol's sky.
    expect(s.routes.map((r) => `${r.route} ${r.kind} ${r.neighbour}`)).toEqual([
      'c-sol in system:c',
      'sol-b in system:b',
      'sol-b out system:b'
    ])
    const node = routeWorld(w, env).node('system:sol')
    for (const r of s.routes) {
      const crawl = r.kind === 'in' ? node.crawlIn! : node.crawlOut!
      expect(r.crawl).toBe(crawl)
      expect(r.expected).toBeCloseTo((r.perDay * crawl) / DAY, 12)
      expect(r.shown === Math.floor(r.expected) || r.shown === Math.ceil(r.expected)).toBe(true)
      expect(s.torches.filter((x) => x.route === r.route && x.kind === r.kind).length).toBe(r.shown)
    }
    expect(s.torches.every((x) => x.route !== 'b-c')).toBe(true)
  })

  it('averages to Little’s law over time, and follows an edited flow', () => {
    const count = (w: ReturnType<typeof fixture>, route: string, kind: string) => {
      let n = 0
      const N = 400
      for (let k = 0; k < N; k++) n += scene(w, k * 0.731 * HOUR).torches.filter((x) => x.route === route && x.kind === kind).length
      return n / N
    }
    const w = fixture()
    const out = scene(w, 0).routes.find((r) => r.route === 'sol-b' && r.kind === 'out')!
    expect(count(w, 'sol-b', 'out')).toBeCloseTo(out.expected, 0)
    // Doubling the flow doubles the torches.
    const doubled = scene(fixture(54), 0).routes.find((r) => r.route === 'sol-b' && r.kind === 'out')!
    expect(doubled.expected).toBeCloseTo(2 * out.expected, 9)
    expect(count(fixture(54), 'sol-b', 'out')).toBeCloseTo(doubled.expected, 0)
  })

  it('puts arriving torches in the direction of the star they come from', () => {
    const s = scene(fixture(), 2 * DAY)
    const stars = skyStars(fixture(), env, 'sol', 3)!
    const i = stars.ids.indexOf('hip.71683')
    const dirB = [stars.dir[i * 3], stars.dir[i * 3 + 1], stars.dir[i * 3 + 2]]
    // The ship that dropped most recently is still near the collapse edge, out toward B.
    const fresh = s.torches.filter((x) => x.route === 'sol-b' && x.kind === 'in').sort((a, b) => a.tau - b.tau)[0]
    const cos = fresh.dir[0] * dirB[0] + fresh.dir[1] * dirB[1] + fresh.dir[2] * dirB[2]
    expect(Math.acos(cos) / DEG).toBeLessThan(25)
    // Inbound braking ships point their exhaust at the port, so the brightest torches are arrivals.
    expect(Number.isFinite(fresh.mag)).toBe(true)
  })
})

describe('the sky from a planet', () => {
  it('has day and night, and the Sun at the right height at noon', () => {
    const w = fixture()
    const alts: number[] = []
    for (let h = 0; h < 24; h++) {
      const s = scene(w, h * HOUR)
      alts.push(altAz(toLocal(s.frame, s.sun.dir)).alt / DEG)
    }
    expect(Math.max(...alts)).toBeGreaterThan(30)
    expect(Math.min(...alts)).toBeLessThan(-30)
    // Near the equinox (t ≈ 0, spring equinox at orbital longitude 0), the noon Sun at 30° N stands about 60° up.
    expect(Math.max(...alts)).toBeGreaterThan(50)
    expect(Math.max(...alts)).toBeLessThan(65)
    const s = scene(w, 0)
    expect(s.sun.mag).toBeCloseTo(-26.7, 0)
    expect(s.atmosphere?.column).toBeCloseTo(1, 2)
  })

  it('can set the clock so it is local noon at a place and time', () => {
    const t = 123.4 * DAY
    const m = meridianForNoon(fixture(), env, 'terra', 45, t)!
    const w = fixture(27, [
      json('bodies/terra.json', {
        name: 'Terra',
        system: 'sol',
        class: 'rocky',
        orbit: orbit(1),
        mass_mearth: 1,
        radius_km: 6371,
        rotation: { period_h: 24, tilt_deg: 23.44, meridian_deg: m },
        atmosphere: { pressure_atm: 1 }
      })
    ])
    const s = skyScene(w, env, { body: 'terra', lat_deg: 50, lon_deg: 45 }, t)
    if ('error' in s) throw new Error(s.error)
    const az = altAz(toLocal(s.frame, s.sun.dir)).az / DEG
    // Due south: on the meridian.
    expect(Math.min(Math.abs(az - 180), Math.abs(az), Math.abs(az - 360))).toBeLessThan(0.01)
  })

  it('sees the real bright stars from Sol', () => {
    const stars = skyStars(fixture(), env, 'sol', 1.5)!
    expect(stars.names[0]).toBe('Sirius')
    expect(stars.mag[0]).toBeCloseTo(-1.44, 1)
  })
})

describe('approach', () => {
  it('drops at the collapse edge and crawls to the port, and a giant opens lee windows', () => {
    const plain = approachInfo(fixture(), env, { system: 'sol', from: 'system:b', t: 0, margin: 1e9 })
    if ('error' in plain) throw new Error(plain.error)
    expect(plain.crawl).not.toBeNull()
    expect(Math.abs(plain.leeGain!)).toBeLessThan(0.01)
    expect(plain.margin!.worst!).toBeGreaterThanOrEqual(plain.margin!.best!)
    const giant = json('bodies/big.json', {
      name: 'Big',
      system: 'sol',
      class: 'gas-giant',
      orbit: orbit(2.6),
      mass_mearth: 317.8,
      radius_km: 69_911,
      rotation: { period_h: 10, tilt_deg: 3 }
    })
    const series = approachSeries(fixture(27, [giant]), env, { system: 'sol', from: 'system:b' }, 0, 4.2 * 365.25 * DAY, 400)
    if ('error' in series) throw new Error(series.error)
    const gains = series.crawl.map((c, k) => 1 - c! / series.starOnly[k]!)
    expect(Math.max(...gains)).toBeGreaterThan(0.02)
    expect(Math.min(...gains)).toBeLessThan(0.005)
  })
})
