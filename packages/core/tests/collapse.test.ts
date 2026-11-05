import { describe, expect, it } from 'vitest'
import {
  AU,
  M_JUPITER,
  M_SUN,
  collapseMesh,
  collapseOutlines,
  collapseRadius,
  collapseRegions,
  collapseSlice,
  foamLoad,
  type MassPoint
} from '@malevo/core'

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

describe('collapse outlines in the system plane', () => {
  const O: [number, number, number] = [0, 0, 0]
  const outlines = (bodies: MassPoint[]) => collapseOutlines(bodies, s, O, X, Y, { grid: 160 })
  const xs = (loop: readonly (readonly number[])[]) => loop.map((p) => p[0] / AU)

  it('is the collapse circle for a lone star', () => {
    const [o] = outlines([star])
    expect(o.loops).toHaveLength(1)
    for (const p of o.loops[0]) expect(Math.hypot(p[0], p[1]) / AU).toBeCloseTo(2.7, 1)
  })

  it('keeps a massive planet past the star’s bubble apart until the load between them reaches 1', () => {
    // At 5.4 AU, 0.05 M☉: its own bubble is about 1 AU, with a gap of about 1.7 AU to the star's.
    const apart = outlines([star, { pos: [5.4 * AU, 0, 0], mass: 0.05 * M_SUN }])
    expect(apart.map((o) => o.body)).toEqual([0, 1])
    expect(Math.max(...xs(apart[0].loops[0]))).toBeLessThan(3)
    expect(Math.min(...xs(apart[1].loops[0]))).toBeGreaterThan(4)
    for (const p of apart[1].loops[0]) expect(foamLoad(p, [star, { pos: [5.4 * AU, 0, 0], mass: 0.05 * M_SUN }], s)).toBeCloseTo(1, 1)
  })

  it('joins them through a smooth neck once it does, not a straight spike', () => {
    const planet: MassPoint = { pos: [5.4 * AU, 0, 0], mass: 0.6 * M_SUN }
    // The load on the line between them reaches 1 everywhere: one area.
    const joined = outlines([star, planet])
    expect(joined).toHaveLength(1)
    const loop = joined[0].loops[0]
    // The neck: its narrowest half-width between the two is positive and wider than a grid cell, and the outline
    // narrows to it gradually (no jump of more than a few cells from one x to the next).
    const halfWidthAt = (x: number) => Math.max(...loop.filter((p) => Math.abs(p[0] / AU - x) < 0.08).map((p) => Math.abs(p[1] / AU)), 0)
    const widths = [1.5, 2, 2.5, 3, 3.5, 4].map(halfWidthAt)
    expect(Math.min(...widths)).toBeGreaterThan(0.2)
    for (let k = 1; k < widths.length; k++) expect(Math.abs(widths[k] - widths[k - 1])).toBeLessThan(0.6)
    for (const p of loop) expect(foamLoad(p, [star, planet], s)).toBeCloseTo(1, 1)
  })
})

describe('collapse outlines of inclined orbits', () => {
  it('cuts a planet’s bubble through its own height, not the star’s plane', () => {
    // Saturn-like: 0.18 AU bubble, 0.4 AU above the star's plane.
    const planet: MassPoint = { pos: [9.5 * AU, 0, 0.4 * AU], mass: 2.857e-4 * M_SUN }
    const o = collapseOutlines([star, planet], s, [0, 0, 0], X, Y)
    expect(o.map((x) => x.body)).toEqual([0, 1])
    const r = o[1].loops[0].map((p) => Math.hypot(p[0] - 9.5 * AU, p[1]) / AU)
    expect(Math.min(...r)).toBeGreaterThan(0.15)
    expect(Math.max(...r)).toBeLessThan(0.22)
    expect(o[1].loops[0][0][2] / AU).toBeCloseTo(0.4, 5)
  })
})
