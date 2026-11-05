import { describe, expect, it } from 'vitest'
import { findPath, insideEllipsoid, lightYears, mulberry32, segmentHitsEllipsoid, type RouteNode } from '@malevo/core'

// The prototype's segment test (story-thing/tools/star-map/star-gen.js), reformatted only.
function protoSegHits(p: number[], q: number[], n: { c: number[]; r: number[] }) {
  const [rx, ry, rz] = n.r,
    a = [(p[0] - n.c[0]) / rx, (p[1] - n.c[1]) / ry, (p[2] - n.c[2]) / rz],
    b = [(q[0] - n.c[0]) / rx, (q[1] - n.c[1]) / ry, (q[2] - n.c[2]) / rz]
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
  let t = dd ? -(a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) / dd : 0
  t = Math.max(0, Math.min(1, t))
  const c = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]
  return c[0] * c[0] + c[1] * c[1] + c[2] * c[2] < 1
}

describe('nebulae', () => {
  it('matches the prototype’s segment test', () => {
    const r = mulberry32(8)
    for (let k = 0; k < 2000; k++) {
      const p = [r() * 40 - 20, r() * 40 - 20, r() * 10 - 5] as const
      const q = [r() * 40 - 20, r() * 40 - 20, r() * 10 - 5] as const
      const n = { center: [r() * 10 - 5, r() * 10 - 5, 0] as const, radii: [1 + r() * 6, 1 + r() * 6, 1 + r() * 3] as const }
      expect(segmentHitsEllipsoid(p, q, n)).toBe(protoSegHits([...p], [...q], { c: [...n.center], r: [...n.radii] }))
    }
    expect(insideEllipsoid([0, 0, 0], { center: [0, 0, 0], radii: [1, 1, 1] })).toBe(true)
  })
})

describe('findPath', () => {
  // A line of stars 8 ly apart, plus a shortcut star.
  const line: RouteNode[] = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, pos: [i * 8, 0, 0] as const }))
  const opts = { legLimit: 15, legCost: (ly: number) => ly, stopCost: () => 2 }

  it('finds the cheapest chain under the leg limit', () => {
    const p = findPath(line, 's0', 's5', opts)!
    // With 8 ly spacing and a 15 ly limit, every leg is one 8 ly step: five legs, four stops.
    expect(p.ids).toEqual(['s0', 's1', 's2', 's3', 's4', 's5'])
    expect(p.legs.every((l) => l.ly === 8)).toBe(true)
    expect(p.cost).toBe(40 + 4 * 2)
    // A 16 ly limit lets it skip stops: two 16 ly legs and one 8 ly leg.
    const q = findPath(line, 's0', 's5', { ...opts, legLimit: 16 })!
    expect(q.legs.length).toBe(3)
    expect(q.cost).toBe(40 + 2 * 2)
  })

  it('returns null when the leg limit cannot be met, and routes around nebulae', () => {
    expect(findPath(line, 's0', 's5', { ...opts, legLimit: 7 })).toBeNull()
    const nodes: RouteNode[] = [
      { id: 'a', pos: [0, 0, 0] },
      { id: 'b', pos: [10, 0, 0] },
      { id: 'detour', pos: [5, 6, 0] }
    ]
    const nebula = { center: [5, 0, 0] as const, radii: [2, 2, 2] as const }
    expect(findPath(nodes, 'a', 'b', opts)!.ids).toEqual(['a', 'b'])
    expect(findPath(nodes, 'a', 'b', { ...opts, nebulae: [nebula] })!.ids).toEqual(['a', 'detour', 'b'])
  })

  it('does not depend on the order of its input', () => {
    const r = mulberry32(4)
    const stars: RouteNode[] = Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, pos: [r() * 100, r() * 100, r() * 20] as const }))
    const a = findPath(stars, 'n0', 'n1', opts)
    const b = findPath([...stars].reverse(), 'n0', 'n1', opts)
    expect(a).toEqual(b)
    if (a) expect(a.cost).toBeGreaterThanOrEqual(lightYears(stars[0].pos, stars[1].pos))
  })
})
