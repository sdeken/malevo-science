import { describe, expect, it } from 'vitest'
import {
  AU,
  C,
  DAY,
  DEG,
  ECLIPTIC_TO_EQUATORIAL,
  EQUATORIAL_TO_GALACTIC,
  GALACTIC_TO_EQUATORIAL,
  GM_SUN,
  LY,
  M_SUN,
  PC,
  angleBetween,
  bodyFixedFrame,
  chance,
  convert,
  formatDuration,
  formatQuantity,
  fromJulianDate,
  fromSpherical,
  galacticFromRaDec,
  hashInts,
  hashString,
  intBetween,
  julianDate,
  keyedStream,
  mulMat,
  mulVec,
  mulberry32,
  normal,
  parseDuration,
  poisson,
  quatFromAxisAngle,
  rotZ,
  rotateByQuat,
  shuffled,
  streamSeed,
  toSpherical,
  weightedIndex,
  type Mat3,
  type Vec3
} from '@malevo/core'

// The prototypes' functions, copied from story-thing/tools/star-map/star-gen.js and settle.js (reformatted only).
// The ports must match them bit for bit, or data made by those tools would not reproduce.

function protoRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function protoHash(...v: number[]) {
  let h = 2166136261 >>> 0
  for (const x of v) {
    h ^= (x | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
function protoHashStr(s: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}
function protoGauss(r: () => number) {
  let u = 0,
    v = 0
  while (u === 0) u = r()
  v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const protoPickW = (r: () => number, items: unknown[], w: number[]) => {
  let tot = 0
  for (const x of w) tot += x
  if (!(tot > 0)) return -1
  let u = r() * tot
  for (let k = 0; k < items.length; k++) {
    u -= w[k]
    if (u <= 0) return k
  }
  return items.length - 1
}

const close = (a: number, b: number, tol: number): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)
}
const closeVec = (a: Vec3, b: Vec3, tol: number): void => a.forEach((x, i) => close(x, b[i], tol))

describe('rng: bit-identical to the prototypes', () => {
  it('mulberry32 matches for many seeds', () => {
    for (const seed of [0, 1, 42, 4242, 0xffffffff, 2 ** 31, 123456789]) {
      const a = mulberry32(seed)
      const b = protoRng(seed)
      for (let i = 0; i < 1000; i++) expect(a()).toBe(b())
    }
  })

  it('hashInts and hashString match', () => {
    expect(hashInts(1, 2, 3)).toBe(protoHash(1, 2, 3))
    expect(hashInts(4242, -3, 7, 0)).toBe(protoHash(4242, -3, 7, 0))
    expect(hashInts()).toBe(protoHash())
    for (const s of ['', 'a', '4242:funicular', 'ünïcødé ✓', 'x'.repeat(500)]) expect(hashString(s)).toBe(protoHashStr(s))
  })

  it('normal and weightedIndex match gauss and pickW', () => {
    const a = mulberry32(9)
    const b = protoRng(9)
    for (let i = 0; i < 500; i++) expect(normal(a)).toBe(protoGauss(b))
    const w = [0.2, 0, 3, 1.5]
    for (let i = 0; i < 500; i++) expect(weightedIndex(a, w)).toBe(protoPickW(b, w, w))
    expect(weightedIndex(a, [0, 0])).toBe(-1)
  })

  it('pins known values, so a change to the algorithm cannot slip through', () => {
    const r = mulberry32(1)
    expect([r(), r(), r()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522])
    expect(hashString('malevo')).toBe(protoHashStr('malevo'))
    expect(streamSeed(1, 'stars', 'cell:0,0,0', 'count')).toBe(
      protoHash(1, protoHashStr('stars'), protoHashStr('cell:0,0,0'), protoHashStr('count'))
    )
  })
})

describe('keyed streams', () => {
  it('depend only on their key', () => {
    const a = keyedStream(7, 'names', 'sys-a', 'name')
    const b = keyedStream(7, 'names', 'sys-a', 'name')
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('differ by seed, generator, entity and purpose', () => {
    const first = (seed: number, gen: string, id: string, purpose: string): number => keyedStream(seed, gen, id, purpose)()
    const base = first(7, 'names', 'sys-a', 'name')
    expect(first(8, 'names', 'sys-a', 'name')).not.toBe(base)
    expect(first(7, 'terrain', 'sys-a', 'name')).not.toBe(base)
    expect(first(7, 'names', 'sys-b', 'name')).not.toBe(base)
    expect(first(7, 'names', 'sys-a', 'moons')).not.toBe(base)
  })
})

describe('distributions', () => {
  it('have the right shape', () => {
    const r = mulberry32(3)
    const n = 20000
    let sum = 0
    let sq = 0
    for (let i = 0; i < n; i++) {
      const x = normal(r)
      sum += x
      sq += x * x
    }
    close(sum / n, 0, 0.03)
    close(Math.sqrt(sq / n), 1, 0.03)
    for (const mean of [0.5, 4, 25, 80]) {
      let s = 0
      for (let i = 0; i < 5000; i++) s += poisson(r, mean)
      close(s / 5000, mean, Math.max(0.1, mean * 0.04))
    }
    expect(poisson(r, 0)).toBe(0)
    for (let i = 0; i < 1000; i++) {
      const k = intBetween(r, -2, 2)
      expect(k).toBeGreaterThanOrEqual(-2)
      expect(k).toBeLessThanOrEqual(2)
    }
    expect(typeof chance(r, 0.5)).toBe('boolean')
    expect(shuffled(r, [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('units', () => {
  it('uses the IAU definitions', () => {
    expect(AU).toBe(149_597_870_700)
    close(LY / 9.4607304725808e15, 1, 1e-14)
    close(PC / 30856775814913672, 1, 1e-14)
    close(M_SUN / 1.98841e30, 1, 1e-4)
    close(convert(1, 'pc', 'ly'), 3.261564, 1e-6)
    close(GM_SUN / AU ** 3 / ((2 * Math.PI) / (365.256363004 * DAY)) ** 2, 1, 1e-4)
    expect(C).toBe(299792458)
  })

  it('formats quantities and durations', () => {
    expect(formatQuantity(1.5 * AU, 'au')).toBe('1.5 AU')
    expect(formatQuantity(6500 * C, 'c')).toBe('6,500 c')
    expect(formatDuration(3 * DAY + 4 * 3600 + 5 * 60)).toBe('3 d 4 h 05 m')
    expect(formatDuration(2 * 3600 + 47 * 60)).toBe('2 h 47 m')
    expect(formatDuration(-90 * 60)).toBe('−1 h 30 m')
    expect(formatDuration(12.5)).toBe('12.5 s')
  })
})

describe('time', () => {
  it('maps the epoch and Julian dates', () => {
    expect(julianDate(0)).toBe(2451545)
    expect(fromJulianDate(2451545.5)).toBe(DAY / 2)
  })

  it('parses fixed-length durations only', () => {
    expect(parseDuration('90 s')).toBe(90)
    expect(parseDuration('3 d 4 h')).toBe(3 * DAY + 4 * 3600)
    expect(parseDuration('-1 w')).toBe(-7 * DAY)
    expect(parseDuration('2.5h')).toBe(9000)
    expect(parseDuration('1 y')).toBeNull()
    expect(parseDuration('3 d banana')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
})

describe('vectors and frames', () => {
  it('round-trips spherical coordinates', () => {
    const v = fromSpherical(1.2, -0.4)
    const s = toSpherical(v)
    close(s.lon, 1.2, 1e-12)
    close(s.lat, -0.4, 1e-12)
  })

  it('puts the galactic centre, pole and anticentre where they belong', () => {
    // Sgr A*-direction: the galactic centre at RA 266.405°, Dec −28.936° (J2000).
    closeVec(galacticFromRaDec(266.40499 * DEG, -28.93617 * DEG), [1, 0, 0], 1e-5)
    // North galactic pole: RA 192.85948°, Dec +27.12825°.
    closeVec(galacticFromRaDec(192.85948 * DEG, 27.12825 * DEG), [0, 0, 1], 1e-6)
    const m = mulMat(EQUATORIAL_TO_GALACTIC, GALACTIC_TO_EQUATORIAL)
    m.forEach((x, i) => close(x, [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-12))
  })

  it('tilts the ecliptic by the obliquity', () => {
    const pole = mulVec(ECLIPTIC_TO_EQUATORIAL, [0, 0, 1])
    // IAU 2006: 84381.406″ = 23.43927944°.
    close(angleBetween(pole, [0, 0, 1]), 23.43927944 * DEG, 1e-9)
  })

  it('agrees between quaternions and matrices', () => {
    const q = quatFromAxisAngle([0, 0, 1], 0.7)
    closeVec(rotateByQuat(q, [1, 0, 0]), mulVec(rotZ(0.7), [1, 0, 0]), 1e-15)
  })

  it('builds body-fixed frames', () => {
    // A body whose pole is the parent's z and W = 0: the parent's x is the prime meridian's direction rotated by 90° + α (α = 0).
    const frame: Mat3 = bodyFixedFrame([0, 0, 1], 0)
    closeVec(mulVec(frame, [0, 0, 1]), [0, 0, 1], 1e-15)
    // Spinning by W moves a fixed parent direction backward in body longitude.
    const p = mulVec(bodyFixedFrame([0, 0, 1], 0.5), [0, 1, 0])
    const q = mulVec(bodyFixedFrame([0, 0, 1], 0), [0, 1, 0])
    const dLon = (((toSpherical(q).lon - toSpherical(p).lon) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    close(dLon, 0.5, 1e-12)
    // The pole always maps to body z.
    const tilted = fromSpherical(0.3, 1.1)
    closeVec(mulVec(bodyFixedFrame(tilted, 2.2), tilted), [0, 0, 1], 1e-12)
  })
})
