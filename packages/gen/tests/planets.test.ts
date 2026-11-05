import { describe, expect, it } from 'vitest'
import { planets, radiusFromMass, runGenerator } from '@malevo/gen'

const sun = { mass_msun: 1, luminosity_lsun: 1, cls: 'G' }

describe('planets@1', () => {
  it('is the same roll every time, and different rolls differ', () => {
    const a = runGenerator(planets, { system: 's', systemName: 'S', star: sun, roll: 0 }, 9)
    const b = runGenerator(planets, { system: 's', systemName: 'S', star: sun, roll: 0 }, 9)
    expect(a).toEqual(b)
    const rolls = [0, 1, 2, 3, 4].map((roll) => JSON.stringify(runGenerator(planets, { system: 's', systemName: 'S', star: sun, roll }, 9)))
    expect(new Set(rolls).size).toBe(5)
  })

  it('depends only on its own system id', () => {
    const one = runGenerator(planets, { system: 'alpha', systemName: 'Alpha', star: sun, roll: 0 }, 9)
    const renamed = runGenerator(planets, { system: 'alpha', systemName: 'Renamed', star: sun, roll: 0 }, 9)
    expect(one.bodies.map((b) => b.value.orbit)).toEqual(renamed.bodies.map((b) => b.value.orbit))
  })

  it('makes stable, ordered, physically sensible systems', () => {
    let total = 0
    for (let roll = 0; roll < 200; roll++) {
      for (const star of [sun, { mass_msun: 0.2, luminosity_lsun: 0.005, cls: 'M' }, { mass_msun: 1.4, luminosity_lsun: 4, cls: 'F' }]) {
        const { bodies } = runGenerator(planets, { system: 'x', systemName: 'X', star, roll }, 1)
        total += bodies.length
        bodies.forEach((b, i) => {
          const v = b.value
          expect(v.orbit.a_au).toBeGreaterThan(0)
          expect(v.orbit.e).toBeLessThanOrEqual(0.6)
          expect(v.mass_mearth).toBeGreaterThan(0)
          expect(v.lock.gen).toBe('planets@1')
          expect(b.id).toBe(`x-${'bcdefghijk'[i]}`)
          if (i > 0) expect(v.orbit.a_au).toBeGreaterThan(bodies[i - 1].value.orbit.a_au)
          if (v.rotation.locked) expect(v.rotation.period_h).toBeUndefined()
          else expect(Math.abs(v.rotation.period_h!)).toBeGreaterThan(7)
        })
      }
    }
    expect(total / 600).toBeGreaterThan(2) // a few planets per system on average
  })

  it('sizes planets from their mass', () => {
    expect(radiusFromMass(1)).toBeCloseTo(1, 1)
    expect(radiusFromMass(317.8)).toBeGreaterThan(10)
    expect(radiusFromMass(317.8)).toBeLessThan(15) // the mean relation gives ~13.8 for Jupiter (real 11.2): a population average
    expect(radiusFromMass(17)).toBeGreaterThan(3)
  })
})
