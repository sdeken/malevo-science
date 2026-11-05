import { describe, expect, it } from 'vitest'
import { cityServices, cityplan, distToLine, inPoly, runGenerator, vehiclesAt } from '@malevo/gen'
import { syntheticPlan } from './synthetic'

describe('cityplan@1', () => {
  const plan = syntheticPlan()
  const out = runGenerator(cityplan, plan, 9)

  it('makes every preset, and is repeatable', () => {
    expect(runGenerator(cityplan, syntheticPlan(), 9)).toEqual(out)
    for (const k of ['building', 'cliff', 'hull', 'house', 'tree', 'landmark', 'avenue', 'lightrail', 'lamp'])
      expect(out.stats.byKind[k] ?? 0).toBeGreaterThan(0)
  })

  it('finds the cliff where the plateau meets the flat', () => {
    // (The plateau's outer edges drop to the default ground outside it too; this is the one along y = 0.)
    const cliff = out.faces.filter((f) => f.zHi - f.zLo > 140 && Math.abs(f.a[1]) < 1 && Math.abs(f.b[1]) < 1)
    expect(cliff.reduce((s, f) => s + Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), 0)).toBeCloseTo(4000, -1)
    for (const f of cliff) expect(f.n[1]).toBeLessThan(0)
    // Cliff-city stacks stand on the low side, against the face, no higher than the top.
    const stacks = out.boxes.filter((b) => b.kind === 'cliff')
    expect(stacks.every((b) => b.cy < 0 && b.z1 <= 150.001 && b.z0 >= 0.999)).toBe(true)
  })

  it('keeps generated buildings inside their regions, out of landmarks and the funicular', () => {
    const towers = plan.regions!.find((r) => r.id === 'towers')!
    const b = out.boxes.filter((x) => x.src === 'towers')
    expect(b.every((x) => inPoly(x.cx, x.cy, towers.poly))).toBe(true)
    expect(b.every((x) => Math.hypot(x.cx + 700, x.cy + 700) > 32)).toBe(true)
    const tallest = Math.max(...b.map((x) => x.z1 - x.z0))
    expect(tallest).toBeGreaterThan(100) // the peak profile
    const incline = plan.lines!.find((l) => l.id === 'incline')!
    expect(out.boxes.filter((x) => x.kind === 'cliff').every((x) => distToLine(x.cx, x.cy, incline.pts) > 3)).toBe(true)
  })

  it('changing one region leaves the others alone', () => {
    const p2 = syntheticPlan()
    p2.regions!.find((r) => r.id === 'suburbs')!.params = { density: 20 }
    const o2 = runGenerator(cityplan, p2, 9)
    expect(o2.boxes.filter((b) => b.src === 'towers')).toEqual(out.boxes.filter((b) => b.src === 'towers'))
    expect(o2.boxes.filter((b) => b.src === 'suburbs').length).toBeLessThan(out.boxes.filter((b) => b.src === 'suburbs').length)
  })

  it('runs trams on their timetable and the funicular’s two cars in step', () => {
    const svc = cityServices(plan)
    const tram = svc.find((s) => s.id === 'tram')!
    expect(tram.stops.length).toBeGreaterThan(5)
    // A 3.8 km line with stops every 500 m: a run of a few minutes, so at any moment a few trams each way.
    const cars = vehiclesAt(svc, 7 * 3600).filter((v) => v.line === 'tram')
    const expected = (2 * tram.run.duration) / tram.headway
    expect(Math.abs(cars.length - expected)).toBeLessThanOrEqual(2)
    for (const c of cars) expect(Math.abs(c.y + 250)).toBeLessThan(3)
    const funi = vehiclesAt(svc, 1234).filter((v) => v.line === 'incline')
    expect(funi.length).toBe(2)
    // One goes up as the other comes down: their heights mirror.
    expect(funi[0].z + funi[1].z).toBeCloseTo(151, -1)
  })
})
