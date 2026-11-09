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
})
