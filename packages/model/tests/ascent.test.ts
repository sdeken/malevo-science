import { describe, expect, it } from 'vitest'
import { GM_EARTH } from '@malevo/core'
import {
  climbRide,
  landingReport,
  newLanding,
  readWorld,
  serializeEntity,
  shakeWord,
  solarSystem,
  templateFiles,
  type WorldFile
} from '@malevo/model'

const earthAir = (h: number) => 1.225 * Math.exp(-h / 8000)
const climb = (extra: object = {}) =>
  climbRide({
    mu: GM_EARTH,
    radius: 6378e3,
    rho: earthAir,
    sound: 331,
    orbit_km: 400,
    thrust_g: 1.5,
    max_g: 3,
    exhaust_kms: 4.4,
    beta_kg_m2: 50_000,
    ...extra
  })

describe('the climb back up', () => {
  it('flies like a rocket to Earth orbit: about 9.3 km/s, 30 kPa at max-Q near a minute, held at 3 g', () => {
    const c = climb()
    expect(c.error).toBeNull()
    expect(c.dv_ms).toBeGreaterThan(9000)
    expect(c.dv_ms).toBeLessThan(9800)
    expect(c.maxQ_kPa).toBeGreaterThan(20)
    expect(c.maxQ_kPa).toBeLessThan(45)
    expect(c.maxQ_t).toBeGreaterThan(40)
    expect(c.maxQ_t).toBeLessThan(120)
    expect(c.mach1_t!).toBeLessThan(c.maxQ_t)
    expect(c.peak_g).toBeCloseTo(3, 1)
    expect(c.over2g_s).toBeGreaterThan(120)
    expect(c.meco_s / 60).toBeGreaterThan(4)
    expect(c.meco_s / 60).toBeLessThan(10)
    expect(c.shake!.from).toBeLessThan(c.maxQ_t)
    expect(c.shake!.to).toBeGreaterThan(c.maxQ_t)
    // Weightless while coasting up.
    expect(c.samples.some((s) => s.t > c.meco_s + 60 && s.g === 0)).toBe(true)
  })

  it('pulls harder and shakes harder with more thrust', () => {
    const hot = climb({ thrust_g: 2.5, max_g: 4 })
    expect(hot.peak_g).toBeCloseTo(4, 1)
    expect(hot.maxQ_kPa).toBeGreaterThan(climb().maxQ_kPa)
    expect(hot.maxQ_t).toBeLessThan(climb().maxQ_t)
  })

  it('says when it cannot make it', () => {
    expect(climb({ thrust_g: 0.9 }).error).toMatch(/more than 1/)
    expect(climb({ exhaust_kms: 2 }).error).toMatch(/propellant/)
  })

  it('without air: no shaking at all', () => {
    const c = climb({ rho: () => 0, sound: null, orbit_km: 100, exhaust_kms: 4.4 })
    expect(c.maxQ_kPa).toBe(0)
    expect(c.mach1_t).toBeNull()
    expect(shakeWord(c.maxQ_kPa)).toBe('barely any')
  })
})

describe('a landing report', () => {
  const sol = (): WorldFile[] =>
    solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
  const world = readWorld([{ path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' }, ...templateFiles(), ...sol()])

  it('has the ride down, and the climb back up when asked', () => {
    const f = newLanding('Down', 'earth', 0)
    const r = landingReport(world, { catalog: null } as never, { ...f, climb: {} })
    if ('error' in r) throw new Error(r.error)
    expect(r.ride.samples.length).toBeGreaterThan(10)
    expect(r.ride.peak_g).toBeCloseTo(r.peakDecel_g, 0)
    expect(r.ride.maxQ_kPa).toBeGreaterThan(0)
    expect(r.climb?.error).toBeNull()
    expect(r.climb!.toOrbit_s).toBeGreaterThan(5 * 60)
  })
})
