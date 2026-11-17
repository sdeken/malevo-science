import { describe, expect, it } from 'vitest'
import {
  applyDesign,
  designReport,
  landingReport,
  newDesign,
  newLanding,
  readWorld,
  serializeEntity,
  solarSystem,
  templateFiles,
  type LandingFile,
  type ShipFile,
  type WorldFile
} from '@malevo/model'

const G0 = 9.80665
const sol = (): WorldFile[] =>
  solarSystem().map((f) => ({ path: f.kind.file ?? `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
const world = (extra: WorldFile[] = []) =>
  readWorld([{ path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' }, ...templateFiles(), ...sol(), ...extra])

describe('the shipyard', () => {
  it('builds a Sandpiper-class freighter: about 6,600 t dry, just under 1 g laden, radiators enough', () => {
    const r = designReport(newDesign(), { foamPower_GW: 20 }, null)
    expect(r.dry_t).toBeGreaterThan(6000)
    expect(r.dry_t).toBeLessThan(7500)
    expect(r.accelFull / G0).toBeGreaterThan(0.8)
    expect(r.accelFull / G0).toBeLessThan(1)
    expect(r.jetPower_W / 1e12).toBeGreaterThan(700) // five torches of ~150 TW
    expect(r.problems).toEqual([])
  })

  it('says when the radiators or the power plant fall short', () => {
    const r = designReport({ ...newDesign(), radiators_m2: 1000, plant_GW: 1 }, { foamPower_GW: 20 }, null)
    expect(r.problems.length).toBe(2)
    expect(r.problems[0]).toMatch(/radiators/)
  })

  it('sets the ship numbers the trip planner flies', () => {
    const ship: ShipFile = {
      name: 'S',
      dryMass_t: 1,
      propellant_t: 1,
      thrust_MN: 1,
      reserve: { share: 0.1 },
      foamPower_GW: 20,
      design: newDesign()
    }
    const out = applyDesign(ship, null)
    const r = designReport(ship.design!, ship, null)
    expect(out.dryMass_t).toBeCloseTo(r.dry_t + r.load_t, 0)
    expect(out.propellant_t).toBe(3900)
    expect(out.engines).toBe(5)
    expect(out.thrust_MN).toBe(21)
  })
})

describe('the landing planner', () => {
  const f = (patch: Partial<LandingFile> = {}): LandingFile => ({ ...newLanding('L', 'earth', 0), ...patch })

  it('brings a 5,000 t hull down from orbit with a ballute and a short rocket burn', () => {
    const r = landingReport(world(), {}, f({ mass_t: 5000 }))
    if ('error' in r) throw new Error(r.error)
    expect(r.deorbit_ms).toBeGreaterThan(50)
    expect(r.deorbit_ms).toBeLessThan(200)
    expect(r.ballute_m).toBeGreaterThan(150)
    expect(r.peakHeat_Wm2 / 1e4).toBeLessThan(30) // fabric-friendly W/cm²
    expect(r.rocket_ms).toBeGreaterThan(200)
    expect(r.rocket_ms).toBeLessThan(1500)
    expect(r.propellant_t).toBeLessThan(2000)
    expect(r.descent_s / 60).toBeGreaterThan(20)
    expect(r.descent_s / 60).toBeLessThan(120)
    expect(r.notes.some((n) => /can't stop/.test(n))).toBe(false)
  })

  it('scales with the sections: each smaller, landing seconds apart along the line, then towed in', () => {
    const r = landingReport(world(), {}, f({ mass_t: 10000, sections: 8, mode: 'splash', tow: { offshore_km: 50, knots: 5 } }))
    if ('error' in r) throw new Error(r.error)
    expect(r.section_t).toBe(1250)
    expect(r.succession_s).toBeLessThan(60)
    expect(r.tow!.duration_s / 3600).toBeCloseTo(5.4, 0)
    expect(r.timeline[0].t).toBeLessThan(0)
  })

  // A rescue team's drop pod (nobody's ship): 4 t, heat-shielded, no ballute.
  const pod = (entry: LandingFile['entry'], patch: Partial<LandingFile> = {}): LandingFile =>
    f({
      mass_t: 4,
      hullBeta_kg_m2: 400,
      ballute: { beta_kg_m2: 100, release_km: 8 },
      rockets: { exhaust_kms: 3, thrust_g: 3, touchdown_ms: 3 },
      entry: { noBallute: true, nose_m: 1, ...entry },
      ...patch
    })

  it('comes down harder and faster when the low point is aimed into the ground', () => {
    const gentle = landingReport(world(), {}, pod({}))
    const hard = landingReport(world(), {}, pod({ perigee_km: -500 }))
    if ('error' in gentle || 'error' in hard) throw new Error('no report')
    expect(hard.deorbit_ms).toBeGreaterThan(200)
    expect(hard.deorbit_ms).toBeLessThan(400)
    expect(hard.entryAngle_deg).toBeGreaterThan(gentle.entryAngle_deg * 2)
    expect(hard.coast_s).toBeLessThan(gentle.coast_s * 0.7)
    // About half an hour from the burn to the ground, at around ten g.
    expect(hard.descent_s / 60).toBeGreaterThan(18)
    expect(hard.descent_s / 60).toBeLessThan(35)
    expect(hard.peakDecel_g).toBeGreaterThan(6)
    expect(hard.peakDecel_g).toBeLessThan(16)
    expect(hard.heatOn).toBe('shield')
    expect(hard.notes.some((n) => /can't stop/.test(n))).toBe(false)
  })

  it('eases the peak with lift', () => {
    const ballistic = landingReport(world(), {}, pod({ perigee_km: -1500 }))
    const lifting = landingReport(world(), {}, pod({ perigee_km: -1500, lift: 0.4 }))
    if ('error' in ballistic || 'error' in lifting) throw new Error('no report')
    expect(lifting.peakDecel_g).toBeLessThan(ballistic.peakDecel_g * 0.8)
  })

  it('finds when a burn from the ship’s orbit brings it down at the site', () => {
    // An orbit tilted 52°, the ship over the equator at 0° east at the start.
    const track = { inclination_deg: 52, node_lon_deg: 0, arg_deg: 0, at: { t_s: 0 } }
    const base = landingReport(world(), {}, pod({ perigee_km: -500 }))
    if ('error' in base) throw new Error(base.error)
    // Where a burn ten minutes in would bring it down, with the Earth turning beneath.
    const D = Math.PI / 180
    const earth = world().entities.get('body/earth')!.value as { radius_km: number; rotation: { period_h: number } }
    const tb = 600
    const u = ((2 * Math.PI) / base.orbitPeriod) * tb + base.downrange_km / earth.radius_km
    const lat = Math.asin(Math.sin(52 * D) * Math.sin(u)) / D
    const lon =
      (Math.atan2(Math.cos(52 * D) * Math.sin(u), Math.cos(u)) -
        ((2 * Math.PI) / (earth.rotation.period_h * 3600)) * (tb + base.descent_s)) /
      D
    const r = landingReport(world(), {}, pod({ perigee_km: -500 }, { track, site: { lat_deg: lat, lon_deg: lon } }))
    if ('error' in r) throw new Error(r.error)
    expect(r.chances!.length).toBeGreaterThan(0)
    expect(Math.abs(r.chances![0].burn - tb)).toBeLessThan(10)
    expect(r.chances![0].miss_km).toBeLessThan(25)
    expect(r.chances![0].touchdown - r.chances![0].burn).toBeCloseTo(r.descent_s, 0)
    // The order comes later: the next chance is later too, a day or so on, when the track comes round again.
    const later = landingReport(
      world(),
      {},
      pod({ perigee_km: -500 }, { track: { ...track, order: { t_s: 3600 } }, site: { lat_deg: lat, lon_deg: lon } })
    )
    if ('error' in later) throw new Error(later.error)
    expect(later.chances!.every((c) => c.burn >= 3600)).toBe(true)
    // A site the track never passes: none, with the closest pass reported.
    const far = landingReport(world(), {}, pod({ perigee_km: -500 }, { track, site: { lat_deg: 80, lon_deg: 0 } }))
    if ('error' in far) throw new Error(far.error)
    expect(far.chances).toEqual([])
    expect(far.bestPass!.miss_km).toBeGreaterThan(1000)
  })
})
