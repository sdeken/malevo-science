import { describe, expect, it } from 'vitest'
import { AU, M_JUPITER, M_SUN, collapseMesh, collapseRadius, collapseRegions, collapseSlice, foamLoad, type MassPoint } from '@malevo/core'

const s = { collapseRadius: 2.7 * AU, rule: 'max-eigen' as const }
const star: MassPoint = { pos: [0, 0, 0], mass: M_SUN }
const X: [number, number, number] = [1, 0, 0]
const Y: [number, number, number] = [0, 1, 0]

describe('the collapse surface', () => {
  it('is the collapse sphere for a lone star, in 3D and in the slice', () => {
    const [r] = collapseRegions([star], s)
    expect(r.radial([0, 0, 1]) / AU).toBeCloseTo(2.7, 2)
    const mesh = collapseMesh(r, 6, 12)
    for (const p of mesh.vertices) expect(Math.hypot(...p) / AU).toBeCloseTo(2.7, 2)
    const slice = collapseSlice(r, s, [star], X, Y, 36)
    expect(slice.length).toBe(36)
    for (const p of slice) expect(Math.hypot(...p) / AU).toBeCloseTo(2.7, 2)
  })

  it('gives a distant giant its own region, and merges a close one into the star’s', () => {
    const far: MassPoint = { pos: [5.2 * AU, 0, 0], mass: M_JUPITER }
    const regions = collapseRegions([star, far], s)
    expect(regions.map((r) => r.body)).toEqual([0, 1])
    // Jupiter's own region is about its collapse radius, a little stretched toward and away from the star by the star's tide.
    const jr = regions[1].radial([0, 1, 0]) / AU
    expect(jr).toBeGreaterThan(0.8 * (collapseRadius(M_JUPITER, s) / AU))
    expect(jr).toBeLessThan(1.3 * (collapseRadius(M_JUPITER, s) / AU))
    // The star's outline is its own circle, not reaching out to the giant's separate region.
    for (const p of collapseSlice(regions[0], s, [star, far], X, Y, 72)) expect(Math.hypot(...p) / AU).toBeLessThan(2.8)
    // Along the star–giant line both tides stretch the same way and add, the star's more on its near side:
    // the giant's region reaches a little farther toward the star than across. Physics, not a drawing fault.
    expect(regions[1].radial([-1, 0, 0])).toBeGreaterThan(regions[1].radial([1, 0, 0]))
    expect(regions[1].radial([1, 0, 0])).toBeGreaterThan(regions[1].radial([0, 1, 0]))
    // Every outline point is on the surface: load 1.
    for (const p of collapseSlice(regions[1], s, [star, far], X, Y, 24)) expect(foamLoad(p, [star, far], s)).toBeCloseTo(1, 1)

    const close: MassPoint = { pos: [2.85 * AU, 0, 0], mass: M_JUPITER }
    const merged = collapseRegions([star, close], s)
    expect(merged.map((r) => r.body)).toEqual([0])
    // The star's region bulges out past the giant on that side.
    expect(merged[0].radial([1, 0, 0]) / AU).toBeGreaterThan(2.85)
    expect(merged[0].radial([-1, 0, 0]) / AU).toBeCloseTo(2.7, 1)
  })
})
