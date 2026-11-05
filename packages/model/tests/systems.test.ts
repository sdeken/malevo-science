import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { AU, DAY, generateCell, type StarRecord } from '@malevo/core'
import {
  bodyPosition,
  daylightByLatitude,
  readWorld,
  runChecks,
  systemInfo,
  templateFiles,
  worldCalendars,
  worldStars,
  type BodyFile,
  type StarCatalog,
  type WorldEnv,
  type WorldFile
} from '@malevo/model'
import { loadCatalog, nodeEnvWith } from '@malevo/model/node'

const CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/catalog/hyg-stars.json')
let catalog: StarCatalog
let env: WorldEnv
beforeAll(async () => {
  catalog = await loadCatalog(CATALOG)
  env = nodeEnvWith(catalog)
})

const files = (extra: WorldFile[]): WorldFile[] => [
  { path: 'world.json', text: '{"format": 1, "name": "T", "seed": 77}' },
  ...templateFiles(),
  ...extra
]
const json = (p: string, v: unknown): WorldFile => ({ path: p, text: JSON.stringify(v) })
const epoch = { t_s: 0 }
const body = (id: string, v: Omit<Partial<BodyFile>, 'orbit'> & { orbit: Partial<BodyFile['orbit']> }): WorldFile =>
  json(`bodies/${id}.json`, {
    class: 'rocky',
    rotation: { period_h: 24, tilt_deg: 0 },
    ...v,
    orbit: { e: 0, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch, ...v.orbit }
  })

// Real Solar System values, as a physics check (not anyone's setting).
const solSystem = [
  json('systems/sol.json', { name: 'Sol', star: 'hyg.0' }),
  body('earth', {
    name: 'Earth',
    system: 'sol',
    mass_mearth: 1,
    radius_km: 6371,
    orbit: { a_au: 1.00000261, e: 0.0167 },
    rotation: { period_h: 23.9344696, tilt_deg: 23.44 }
  }),
  body('moon', {
    name: 'Moon',
    system: 'sol',
    parent: 'earth',
    mass_mearth: 0.0123,
    radius_km: 1737.4,
    orbit: { a_km: 384400, e: 0.0549, i_deg: 5.145 },
    rotation: { locked: true, tilt_deg: 6.68 }
  }),
  body('jupiter', {
    name: 'Jupiter',
    system: 'sol',
    class: 'gas-giant',
    mass_mearth: 317.8,
    radius_km: 69911,
    orbit: { a_au: 5.2026, e: 0.0484 },
    rotation: { period_h: 9.925, tilt_deg: 3.13 }
  })
]

describe('stars', () => {
  it('loads the catalogue with Sol added, and finds generated stars by id', () => {
    expect(catalog.stars.length).toBe(79816)
    expect(catalog.get('hyg.0')!.name).toBe('Sol')
    expect(catalog.get('hip.70890')!.name).toBe('Proxima Centauri')
    const world = readWorld(files([]))
    const stars = worldStars(world, env)
    expect(stars.params!.seed).toBe(77) // the world seed, since settings/stars.json gives none
    const someCell = generateCell(stars.params!, 3, -2, 0)
    expect(someCell.length).toBeGreaterThan(0)
    expect(stars.get(someCell[0].id)).toEqual(someCell[0])
    expect(stars.get('g.3_-2_0.99999')).toBeUndefined()
  })

  it('finds catalogue and generated stars near a point', () => {
    const stars = worldStars(readWorld(files([])), env)
    const near: StarRecord[] = stars.near([0, 0, 0], 12)
    const names = near.map((s) => s.name)
    expect(names).toContain('Sol')
    expect(names).toContain('Proxima Centauri')
    expect(names).toContain('Sirius')
    expect(near.every((s) => Math.hypot(...s.pos) <= 12)).toBe(true)
    expect(stars.near([0, 0, 0], 60).some((s) => s.generated)).toBe(true) // generated stars start beyond 25 ly
  })
})

describe('a system', () => {
  const world = readWorld(files(solSystem))
  let info: NonNullable<ReturnType<typeof systemInfo>>
  beforeAll(() => {
    info = systemInfo(world, env, 'sol')!
  })

  it('takes its star from the catalogue', () => {
    expect(info.starError).toBeNull()
    expect(info.star!.record.name).toBe('Sol')
    expect(info.star!.physics.mass).toBeCloseTo(1, 1)
    expect(info.habitableZone!.inner / AU).toBeCloseTo(0.95, 1)
    expect(info.collapse! / AU).toBeCloseTo(2.7, 1) // the template's collapse radius for one solar mass
  })

  it('orders bodies as a tree and derives their physics', () => {
    expect(info.bodies.map((b) => b.id)).toEqual(['earth', 'moon', 'jupiter'])
    const [earth, moon, jupiter] = info.bodies
    expect(earth.error).toBeNull()
    expect(earth.period! / DAY).toBeCloseTo(365.25, 0)
    expect(earth.solarDay! / 3600).toBeCloseTo(24, 1)
    expect(earth.surfaceGravity).toBeCloseTo(1, 1)
    expect(earth.insolation!).toBeGreaterThan(1300)
    expect(earth.insolation!).toBeLessThan(1420)
    expect(earth.equilibriumTemp!).toBeGreaterThan(245)
    expect(earth.equilibriumTemp!).toBeLessThan(262)
    expect(moon.period! / DAY).toBeCloseTo(27.3, 0)
    expect(moon.solarDay! / DAY).toBeCloseTo(29.5, 0) // a locked moon's day is the synodic month
    expect(moon.year).toBe(earth.period)
    expect(moon.surfaceGravity).toBeCloseTo(0.165, 2)
    expect(jupiter.collapse! / AU).toBeCloseTo(0.266, 2)
    expect(jupiter.period! / (365.25 * DAY)).toBeCloseTo(11.86, 1)
  })

  it('places bodies relative to the star, moons with their planet', () => {
    const e = bodyPosition(info, 'earth', 0)!
    const m = bodyPosition(info, 'moon', 0)!
    expect(Math.hypot(...e) / AU).toBeCloseTo(0.983, 2) // epoch at perihelion (mean anomaly 0)
    expect(Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]) / 1000).toBeCloseTo(384400 * (1 - 0.0549), -2)
  })

  it('passes the checks', () => {
    expect(runChecks(world, env).filter((i) => i.severity !== 'info')).toEqual([])
  })

  it('drives a planet-local calendar that follows a body', () => {
    const w = readWorld(
      files([
        ...solSystem,
        json('calendars/earthly.json', {
          name: 'Earthly',
          kind: 'solar',
          body: 'earth',
          epoch,
          epochYear: 1,
          hoursPerDay: 24,
          minutesPerHour: 60,
          secondsPerMinute: 60
        }),
        json('calendars/lunar.json', {
          name: 'Lunar',
          kind: 'solar',
          body: 'moon',
          epoch,
          epochYear: 1,
          hoursPerDay: 24,
          minutesPerHour: 60,
          secondsPerMinute: 60
        })
      ])
    )
    const cals = worldCalendars(w, env)
    expect(cals.errors).toEqual(new Map())
    const earthly = cals.set.get('earthly')!
    const year = earthly.fromFields({ year: 2 }) - earthly.fromFields({ year: 1 })
    expect(Math.abs(year / DAY - 365.256)).toBeLessThan(1) // a whole number of solar days, close to the sidereal year
    const lunar = cals.set.get('lunar')!
    expect((lunar.fromFields({ year: 1, day: 2 }) - lunar.fromFields({ year: 1, day: 1 })) / DAY).toBeCloseTo(29.5, 0)
    // A planet locked to its star has no solar day to count.
    const locked = readWorld(
      files([
        ...solSystem.map((f) =>
          f.path === 'bodies/earth.json' ? { ...f, text: f.text!.replace('"period_h":23.9344696', '"locked":true') } : f
        ),
        json('calendars/earthly.json', {
          name: 'Earthly',
          kind: 'solar',
          body: 'earth',
          epoch,
          epochYear: 1,
          hoursPerDay: 24,
          minutesPerHour: 60,
          secondsPerMinute: 60
        })
      ])
    )
    expect(worldCalendars(locked, env).errors.get('earthly')).toMatch(/same face/)
  })
})

describe('system checks', () => {
  it('reports missing stars, bad orbits, crossing orbits and moons outside the Hill sphere', () => {
    const world = readWorld(
      files([
        json('systems/nowhere.json', { name: 'Nowhere', star: 'hip.999999999' }),
        json('systems/sol.json', { name: 'Sol', star: 'hyg.0' }),
        body('a', { name: 'A', system: 'sol', mass_mearth: 1, radius_km: 6000, orbit: { a_au: 1, e: 0.3 } }),
        body('b', { name: 'B', system: 'sol', mass_mearth: 1, radius_km: 6000, orbit: { a_au: 1.2 } }),
        body('c', { name: 'C', system: 'sol', mass_mearth: 1, radius_km: 6000, orbit: { a_au: 0.001 } }),
        body('d', { name: 'D', system: 'sol', mass_mearth: 1, radius_km: 6000, orbit: {} }),
        body('far', { name: 'Far moon', system: 'sol', parent: 'b', mass_mearth: 0.01, radius_km: 1000, orbit: { a_km: 5e6 } }),
        body('spin', { name: 'No spin', system: 'sol', mass_mearth: 1, radius_km: 6000, orbit: { a_au: 30 }, rotation: { tilt_deg: 0 } })
      ])
    )
    const codes = runChecks(world, env).map((i) => `${i.path} ${i.code}`)
    expect(codes).toContain('systems/nowhere.json missing-star')
    expect(codes).toContain('bodies/b.json crossing-orbits')
    expect(codes).toContain('bodies/c.json inside-host')
    expect(codes).toContain('bodies/d.json bad-body')
    expect(codes).toContain('bodies/far.json moon-unbound')
    expect(codes).toContain('bodies/spin.json bad-body')
    // Without the catalogue, a catalogue star is only noted, not an error; Sol, built in, is always known.
    const bare = readWorld(files([...solSystem, json('systems/prox.json', { name: 'Prox', star: 'hip.70890' })]))
    const noCat = runChecks(bare).map((i) => `${i.path} ${i.code}`)
    expect(noCat).toContain('systems/prox.json no-catalogue')
    expect(noCat).not.toContain('systems/sol.json no-catalogue')
  })

  it('answers daylight questions directly', () => {
    const row = daylightByLatitude((23.44 * Math.PI) / 180, 1).find((r) => r.lat === 28)!
    expect(row.shortest * 24).toBeCloseTo(10.36, 1)
    expect(row.longest * 24).toBeCloseTo(13.9, 0)
    const pole = daylightByLatitude((23.44 * Math.PI) / 180).at(-1)!
    expect([pole.longest, pole.shortest]).toEqual([1, 0])
  })
})
