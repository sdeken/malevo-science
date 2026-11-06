import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEG, GALACTIC_TO_EQUATORIAL, altAz, mulVec, toLocal, toSpherical, type Vec3 } from '@malevo/core'
import {
  readWorld,
  runChecks,
  serializeEntity,
  skyScene,
  skyStars,
  solarSystem,
  solarSystemFor,
  systemFrame,
  systemInfo,
  planTrip,
  allRoutes,
  approachInfo,
  bodyPosition,
  templateFiles,
  type WorldEnv,
  type WorldFile
} from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let env: WorldEnv
beforeAll(async () => {
  env = nodeEnvWith(await loadCatalog(CATALOG))
})

const solFiles = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
const world = (extra: WorldFile[] = []) =>
  readWorld([{ path: 'world.json', text: '{"format": 1, "name": "S", "seed": 1}' }, ...templateFiles(), ...solFiles(), ...extra])

/** A system-frame direction as equatorial RA/Dec, degrees. */
function raDec(w: ReturnType<typeof world>, d: Vec3): { ra: number; dec: number } {
  const f = systemFrame((w.entities.get('system/sol')!.value as { frame: never }) ?? {})
  const g: Vec3 = [
    d[0] * f.x[0] + d[1] * f.y[0] + d[2] * f.z[0],
    d[0] * f.x[1] + d[1] * f.y[1] + d[2] * f.z[1],
    d[0] * f.x[2] + d[1] * f.y[2] + d[2] * f.z[2]
  ]
  const s = toSpherical(mulVec(GALACTIC_TO_EQUATORIAL, g))
  return { ra: s.lon / DEG, dec: s.lat / DEG }
}

describe('the Solar System', () => {
  it('loads cleanly and checks clean', () => {
    const w = world()
    expect(w.issues).toEqual([])
    const issues = runChecks(w, env).filter((i) => i.check === 'systems' || i.severity === 'error')
    expect(issues).toEqual([])
  })

  it('has the real day lengths, tilts and years', () => {
    const sys = systemInfo(world(), env, 'sol')!
    const b = (id: string) => sys.bodies.find((x) => x.id === id)!
    expect(b('earth').file.rotation.tilt_deg).toBeCloseTo(23.44, 1)
    expect(b('earth').solarDay! / 3600).toBeCloseTo(24, 2)
    expect(b('earth').year! / 86400).toBeCloseTo(365.26, 1)
    expect(b('mars').file.rotation.tilt_deg).toBeCloseTo(25.19, 0)
    expect(b('moon').period! / 86400).toBeCloseTo(27.32, 0)
    expect(b('io').period! / 86400).toBeCloseTo(1.769, 1)
    // Venus spins backwards; Uranus lies on its side.
    expect(b('venus').file.rotation.period_h!).toBeLessThan(0)
    const u = b('uranus').file.rotation
    expect(u.tilt_deg > 80 && u.tilt_deg < 100).toBe(true)
  })

  it('shows the real sky from Greenwich at J2000', () => {
    const w = world()
    const vp = { body: 'earth', lat_deg: 51.4769, lon_deg: 0 }
    const s = skyScene(w, env, vp, 0)
    if ('error' in s) throw new Error(s.error)
    // The Sun at J2000.0: RA 281.3°, Dec −23.0°; 12:00 at Greenwich, so near the meridian, about 15.5° up.
    const sun = raDec(w, s.sun.dir)
    expect(sun.ra).toBeCloseTo(281.3, 0)
    expect(sun.dec).toBeCloseTo(-23.03, 0)
    const { alt, az } = altAz(toLocal(s.frame, s.sun.dir))
    expect(alt / DEG).toBeCloseTo(15.5, 0)
    expect(Math.abs(az / DEG - 180)).toBeLessThan(2)
    // The Moon: ecliptic longitude about 223° at J2000.0.
    const moon = s.bodies.find((b) => b.id === 'moon')!
    const ecl = toSpherical(moon.dir)
    expect(Math.abs(ecl.lon / DEG - 223.3)).toBeLessThan(3)
    // Polaris stands at the latitude.
    const stars = skyStars(w, env, 'sol', 2.5)!
    const k = stars.names ? Object.entries(stars.names).find(([, n]) => n === 'Polaris')![0] : '0'
    const i = Number(k)
    const p: Vec3 = [stars.dir[i * 3], stars.dir[i * 3 + 1], stars.dir[i * 3 + 2]]
    expect(altAz(toLocal(s.frame, p)).alt / DEG).toBeCloseTo(51.5, 0)
  })

  it('joins an existing Sol system instead of making a second one', () => {
    const w = readWorld([
      { path: 'world.json', text: '{"format": 1, "name": "S", "seed": 1}' },
      ...templateFiles(),
      { path: 'systems/home.json', text: JSON.stringify({ name: 'Home', star: 'hyg.0' }) },
      {
        path: 'bodies/earth.json',
        text: JSON.stringify({
          name: 'Mine',
          system: 'home',
          class: 'rocky',
          orbit: { a_au: 1, e: 0, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
          mass_mearth: 1,
          radius_km: 6371,
          rotation: { period_h: 24, tilt_deg: 0 }
        })
      }
    ])
    const files = solarSystemFor(w)
    expect(files.some((f) => f.path === 'systems/sol.json')).toBe(false)
    expect(files.find((f) => f.path === 'systems/home.json')!.value).toMatchObject({
      name: 'Home',
      frame: { poleB_deg: expect.any(Number) }
    })
    expect(files.some((f) => f.id === 'earth')).toBe(false)
    expect(files.filter((f) => f.kind.kind === 'body').every((f) => (f.value as { system: string }).system === 'home')).toBe(true)
  })
})

describe('where the planets are at a date', () => {
  // Heliocentric ecliptic J2000 positions at 2000-01-01 12:00 TT (JPL Horizons), AU.
  const J2000: Record<string, [number, number]> = {
    earth: [-0.1771, 0.9672],
    mars: [1.3908, -0.0134],
    jupiter: [4.0012, 2.9385],
    saturn: [6.4064, 6.5699]
  }
  const AU_M = 149_597_870_700
  const at = (id: string, t: number): [number, number, number] => {
    const sys = systemInfo(world(), env, 'sol')!
    const p = bodyPosition(sys, id, t)!
    return [p[0] / AU_M, p[1] / AU_M, p[2] / AU_M]
  }

  it('matches the published positions at J2000', () => {
    for (const [id, [x, y]] of Object.entries(J2000)) {
      const p = at(id, 0)
      // JPL's approximate elements are good to about a fifth of a degree for Jupiter and Saturn, far better within.
      expect(Math.hypot(p[0] - x, p[1] - y)).toBeLessThan(0.004 * Math.hypot(x, y))
    }
  })

  it('moves them with the date: Earth half a year on is across the Sun, a year on back again', () => {
    const year = 365.25636 * 86400
    const e0 = at('earth', 0)
    const half = at('earth', year / 2)
    const full = at('earth', year)
    expect(e0[0] * half[0] + e0[1] * half[1]).toBeLessThan(-0.9)
    expect(Math.hypot(full[0] - e0[0], full[1] - e0[1])).toBeLessThan(0.002)
    // Jupiter a quarter of its 11.86-year orbit on has turned about 90°.
    const j0 = at('jupiter', 0)
    const jq = at('jupiter', (11.862 * 365.25 * 86400) / 4)
    const turn = Math.acos((j0[0] * jq[0] + j0[1] * jq[1]) / (Math.hypot(j0[0], j0[1]) * Math.hypot(jq[0], jq[1]))) / DEG
    expect(turn).toBeGreaterThan(80)
    expect(turn).toBeLessThan(100)
  })
})

describe('trip times follow the physics settings', () => {
  const withPhysics = (patch: (p: Record<string, Record<string, unknown>>) => void) => {
    const files = [...templateFiles(), ...solFiles()]
    const phys = files.find((f) => f.path === 'settings/physics.json')!
    const p = JSON.parse(phys.text ?? '{}')
    patch(p)
    const rest = files.filter((f) => f !== phys)
    return readWorld([
      { path: 'world.json', text: '{"format": 1, "name": "S", "seed": 1}' },
      ...rest,
      { path: 'settings/physics.json', text: JSON.stringify(p) },
      { path: 'routes/r.json', text: JSON.stringify({ name: 'R', waypoints: [{ system: 'sol' }, { star: 'hip.70890' }] }) }
    ])
  }
  const foamTime = (w: ReturnType<typeof world>): number => allRoutes(w, env)[0].legs[0].foam!
  const crawl = (w: ReturnType<typeof world>): number => {
    const r = approachInfo(w, env, { system: 'sol', from: [1, 0, 0], t: 0 })
    if ('error' in r) throw new Error(r.error)
    return r.crawl!
  }

  it('foam time scales with the top speed and the crawl with the acceleration; tanks do not cap the route planner', () => {
    const base = withPhysics(() => {})
    const fast = withPhysics((p) => (p.foam.topSpeed_c = (p.foam.topSpeed_c as number) * 2))
    expect(foamTime(fast) / foamTime(base)).toBeCloseTo(0.5, 6)
    const hard = withPhysics((p) => (p.torch.cruiseAccel_g = (p.torch.cruiseAccel_g as number) * 4))
    expect(crawl(hard) / crawl(base)).toBeCloseTo(0.5, 3)
    // The route planner is idealized: tanks never cap it (the trip planner flies a real ship).
    const dry = withPhysics((p) => (p.torch.exhaustSpeed_c = 0.0001))
    expect(crawl(dry)).toBeCloseTo(crawl(base), 3)
  })
})

describe('the trip planner', () => {
  const tripWorld = (ship: Record<string, unknown>) =>
    readWorld([
      { path: 'world.json', text: '{"format": 1, "name": "S", "seed": 1}' },
      ...templateFiles(),
      ...solFiles(),
      { path: 'systems/prox.json', text: JSON.stringify({ name: 'Proxima', star: 'hip.70890' }) },
      { path: 'routes/r.json', text: JSON.stringify({ name: 'R', waypoints: [{ system: 'sol' }, { system: 'prox' }] }) },
      { path: 'ships/s.json', text: JSON.stringify(ship) }
    ])
  const plan = (ship: Record<string, unknown>) => {
    const p = planTrip(tripWorld(ship), env, { ship: 's', route: 'r', from: 0, to: 1, t: 0 })
    if ('error' in p) throw new Error(p.error)
    return p
  }
  const base = { name: 'S', dryMass_t: 5000, propellant_t: 50000, thrust_MN: 1000, reserve: { share: 0.1 } }

  it('flies flip-and-burn at the comfort cap when thrust and tanks are ample, close to the idealized time', () => {
    const p = plan(base)
    expect(p.legs).toHaveLength(1)
    expect(p.legs[0].speedCap).toBeNull()
    expect(p.total / p.ideal!).toBeGreaterThan(0.98)
    expect(p.total / p.ideal!).toBeLessThan(1.02)
  })

  it('coasts at a lower cruise speed when the tanks are short, and still arrives with the reserve', () => {
    const p = plan({ ...base, propellant_t: 600 })
    const leg = p.legs[0]
    expect(leg.speedCap).toBeGreaterThan(0)
    expect(leg.depart!.coast.time).toBeGreaterThan(0)
    expect(leg.propellantEnd).toBeGreaterThanOrEqual(0.1 * 600_000 - 1)
    expect(p.total).toBeGreaterThan(p.ideal! * 1.2)
  })

  it('is slower with too little thrust for the comfort cap, and says when a leg cannot be flown', () => {
    expect(plan({ ...base, thrust_MN: 10 }).total).toBeGreaterThan(plan(base).total * 1.5)
    const hopeless = plan({ ...base, propellant_t: 600, foamPower_GW: 1e8 })
    expect(hopeless.legs[0].problems.join(' ')).toMatch(/cannot cover this leg/)
  })
})
