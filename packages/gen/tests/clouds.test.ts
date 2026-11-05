import { describe, expect, it } from 'vitest'
import { fibonacciSphere, mulberry32, type Vec3 } from '@malevo/core'
import { cloudsField, DEFAULT_CLOUDS } from '@malevo/gen'

const field = (params = DEFAULT_CLOUDS) =>
  cloudsField(params, (purpose) => mulberry32([...purpose].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)))
const pts = fibonacciSphere(4000)
const mean = (f: (p: Vec3) => number, sel = (_p: Vec3) => true): number => {
  const xs = pts.filter(sel).map(f)
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

describe('clouds@1', () => {
  it('covers the fraction of the sky asked for', () => {
    for (const cover of [0.2, 0.6, 0.9]) {
      const f = field({ ...DEFAULT_CLOUDS, cover })
      expect(Math.abs(mean((p) => f.cover(p)) - cover)).toBeLessThan(0.05)
    }
  })

  it('with three cells, is cloudier at the equator and near 60° than near 30°', () => {
    const f = field({ ...DEFAULT_CLOUDS, storms: 0 })
    const near = (deg: number) => (p: Vec3) => Math.abs(Math.abs(Math.asin(p[2]) * (180 / Math.PI)) - deg) < 6
    const eq = mean((p) => f.cover(p), near(0))
    const sub = mean((p) => f.cover(p), near(30))
    const mid = mean((p) => f.cover(p), near(60))
    expect(eq).toBeGreaterThan(sub)
    expect(mid).toBeGreaterThan(sub)
  })

  it('is clear at zero cover and overcast at full cover', () => {
    expect(field({ ...DEFAULT_CLOUDS, cover: 0 }).cover([1, 0, 0])).toBe(0)
    expect(field({ ...DEFAULT_CLOUDS, cover: 1 }).cover([0, 0, 1])).toBe(1)
  })
})
