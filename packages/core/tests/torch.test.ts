import { describe, expect, it } from 'vitest'
import { AU, burnAllTheWayTime, crawl, flipAndBurnTime, outbound } from '@malevo/core'

describe('a ship’s crawl', () => {
  const e = { exhaust: 0.05 * 299_792_458, thrust: 1e7 * 9.80665, maxAccel: 9.80665 }
  it('matches flip-and-burn at a steady 1 g when thrust is ample', () => {
    const c = crawl(2 * AU, 5e6, e)
    // Light ship, ample thrust: capped at 1 g the whole way.
    expect((c.accel.time + c.coast.time + c.decel.time) / flipAndBurnTime(2 * AU, 9.80665)).toBeCloseTo(1, 3)
    expect(c.coast.time).toBeCloseTo(0, 0)
  })
  it('is slower for a heavy ship whose thrust cannot reach the cap, and faster as it burns off mass', () => {
    const c = crawl(2 * AU, 2e7, e)
    const t = c.accel.time + c.coast.time + c.decel.time
    expect(t).toBeGreaterThan(flipAndBurnTime(2 * AU, 9.80665))
    expect(t).toBeLessThan(flipAndBurnTime(2 * AU, 9.80665 / 2))
    // Lighter by the time it brakes: braking takes less time than speeding up.
    expect(c.decel.time).toBeLessThan(c.accel.time)
  })
  it('coasts at a speed cap, saving propellant', () => {
    const full = crawl(2 * AU, 5e6, e)
    const capped = crawl(2 * AU, 5e6, e, full.peakSpeed / 4)
    expect(capped.coast.time).toBeGreaterThan(0)
    expect(capped.propellant).toBeLessThan(full.propellant / 3)
    expect(capped.accel.distance + capped.coast.distance + capped.decel.distance).toBeCloseTo(2 * AU, -3)
  })
})

describe('a departure', () => {
  const e = { exhaust: 0.05 * 299_792_458, thrust: 1e7 * 9.80665, maxAccel: 9.80665 }
  it('burns the whole way out without braking, as burn-all-the-way at 1 g', () => {
    const o = outbound(1.85 * AU, 5e6, e)
    expect(o.accel.time / burnAllTheWayTime(1.85 * AU, 9.80665)).toBeCloseTo(1, 3)
    expect(o.decel.time).toBe(0)
    // About 2¾ days and about 2,400 km/s for 1.85 AU.
    expect(o.accel.time / 86400).toBeCloseTo(2.75, 1)
    expect(o.peakSpeed / 1000).toBeGreaterThan(2300)
    expect(o.peakSpeed / 1000).toBeLessThan(2500)
  })
  it('coasts the rest at a speed cap', () => {
    const o = outbound(1.85 * AU, 5e6, e, 1e6)
    expect(o.peakSpeed).toBe(1e6)
    expect(o.coast.time).toBeGreaterThan(0)
    expect(o.accel.distance + o.coast.distance).toBeCloseTo(1.85 * AU, -3)
  })
})
