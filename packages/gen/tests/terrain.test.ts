import { describe, expect, it } from 'vitest'
import { fibonacciSphere } from '@malevo/core'
import { DEFAULT_TERRAIN, runGenerator, terrain } from '@malevo/gen'

const points = fibonacciSphere(3000)
const run = (over: Partial<typeof DEFAULT_TERRAIN> = {}, roll = 0, body = 'b') =>
  runGenerator(terrain, { body, roll, params: { ...DEFAULT_TERRAIN, ...over }, points }, 7)

describe('terrain@1', () => {
  it('puts the asked-for share of the surface under water', () => {
    for (const ocean of [0.3, 0.7, 0.95]) {
      const h = run({ ocean })
      const wet = h.filter((x) => x < 0).length / h.length
      expect(Math.abs(wet - ocean)).toBeLessThan(0.04)
    }
  })

  it('is repeatable, and each roll and body is its own', () => {
    expect(run()).toEqual(run())
    expect(run({}, 1)).not.toEqual(run())
    expect(run({}, 0, 'other')).not.toEqual(run())
    // A single point reads the same as in a big batch: resolution never changes the result.
    const one = runGenerator(terrain, { body: 'b', roll: 0, params: DEFAULT_TERRAIN, points: [points[123]] }, 7)
    expect(one[0]).toBe(run()[123])
  })

  it('raises mountains with the mountain height, within reason', () => {
    const low = Math.max(...run({ mountains_km: 2 }))
    const high = Math.max(...run({ mountains_km: 10 }))
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThan(25)
    expect(Math.min(...run())).toBeGreaterThan(-12)
  })
})
