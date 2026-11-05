import { describe, expect, it } from 'vitest'
import {
  DEG,
  annualInsolationFactor,
  arc,
  arcToSegment,
  fbm,
  fibonacciSphere,
  fromLatLon,
  insideSphericalPolygon,
  mulberry32,
  perlin3,
  toLatLon
} from '@malevo/core'

describe('the sphere', () => {
  it('converts, measures and spreads points', () => {
    const p = fromLatLon(30 * DEG, 45 * DEG)
    expect(toLatLon(p).lat / DEG).toBeCloseTo(30, 9)
    expect(arc(fromLatLon(0, 0), fromLatLon(0, 90 * DEG)) / DEG).toBeCloseTo(90, 9)
    const pts = fibonacciSphere(1000)
    const mean = pts.reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0])
    expect(Math.hypot(...mean) / 1000).toBeLessThan(0.01)
    // Distance to the equator segment from 0° to 90° E, from a point 10° north of it.
    expect(arcToSegment(fromLatLon(10 * DEG, 40 * DEG), fromLatLon(0, 0), fromLatLon(0, 90 * DEG)) / DEG).toBeCloseTo(10, 6)
    expect(arcToSegment(fromLatLon(0, 120 * DEG), fromLatLon(0, 0), fromLatLon(0, 90 * DEG)) / DEG).toBeCloseTo(30, 6)
  })

  it('tells inside from outside a polygon drawn in latitude and longitude', () => {
    const square = [
      [10, 10],
      [10, 30],
      [30, 30],
      [30, 10]
    ].map(([a, b]) => fromLatLon(a * DEG, b * DEG))
    expect(insideSphericalPolygon(fromLatLon(20 * DEG, 20 * DEG), square)).toBe(true)
    expect(insideSphericalPolygon(fromLatLon(-20 * DEG, 20 * DEG), square)).toBe(false)
    expect(insideSphericalPolygon(fromLatLon(20 * DEG, 200 * DEG), square)).toBe(false)
  })

  it('makes repeatable noise', () => {
    const a = perlin3(mulberry32(3))
    const b = perlin3(mulberry32(3))
    const p = fromLatLon(0.3, 1.2)
    expect(fbm(a, p, 5, 2)).toBe(fbm(b, p, 5, 2))
    expect(Math.abs(fbm(a, p, 5, 2))).toBeLessThan(1)
  })

  it('spreads sunlight by latitude as on Earth', () => {
    // Earth: the equator gets about 1.2× the mean over a year, the poles about 0.5×.
    expect(annualInsolationFactor(0, 23.44 * DEG)).toBeCloseTo(1.21, 1)
    expect(annualInsolationFactor(89.9 * DEG, 23.44 * DEG)).toBeCloseTo(0.52, 1)
    // The factors average to 1 over the sphere (weighting by cos latitude).
    let s = 0
    let w = 0
    for (let lat = -89.5; lat < 90; lat += 1) {
      s += annualInsolationFactor(lat * DEG, 23.44 * DEG) * Math.cos(lat * DEG)
      w += Math.cos(lat * DEG)
    }
    expect(s / w).toBeCloseTo(1, 2)
  })
})
