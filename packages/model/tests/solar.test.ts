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
