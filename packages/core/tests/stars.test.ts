import { describe, expect, it } from 'vitest'
import {
  SOL,
  bolometricCorrection,
  cellsNear,
  classOf,
  generateCell,
  generatedId,
  isGiant,
  mainSequenceMass,
  parseGeneratedId,
  starFromRow,
  starPhysics,
  teffFromBV,
  type StarfieldParams
} from '@malevo/core'

/* eslint-disable */
// The prototype's genCell and helpers (story-thing/tools/star-map/star-gen.js), reformatted only.
const LY_PER_PC = 3.261564
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(...v: number[]) {
  let h = 2166136261 >>> 0
  for (const x of v) {
    h ^= (x | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
const CLASSES = [
  { c: 'M', share: 0.73, M: [8.8, 16], mass: [0.08, 0.5], ci: [1.4, 1.9] },
  { c: 'K', share: 0.12, M: [5.9, 8.8], mass: [0.5, 0.8], ci: [0.82, 1.4] },
  { c: 'G', share: 0.065, M: [4.4, 5.9], mass: [0.8, 1.05], ci: [0.59, 0.82] },
  { c: 'F', share: 0.03, M: [2.4, 4.4], mass: [1.05, 1.4], ci: [0.3, 0.59] },
  { c: 'A', share: 0.006, M: [0.6, 2.4], mass: [1.4, 2.1], ci: [0.0, 0.3] },
  { c: 'B', share: 0.0012, M: [-2.5, 0.6], mass: [2.1, 10], ci: [-0.25, 0.0] },
  { c: 'D', share: 0.048, M: [10.5, 15.5], mass: [0.5, 0.8], ci: [-0.1, 0.6] }
]
function gauss(r: () => number) {
  let u = 0,
    v = 0
  while (u === 0) u = r()
  v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function genCell(p: any, ix: number, iy: number, iz: number) {
  const r = rng(hash(p.seed, ix, iy, iz)),
    out: any[] = [],
    vol = p.cell ** 3,
    mean = p.density * vol
  let n = Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss(r)))
  for (let k = 0; k < n; k++) {
    const x = (ix + r()) * p.cell,
      y = (iy + r()) * p.cell,
      z = (iz + r()) * p.cell,
      u = r(),
      a = r(),
      b = r(),
      h = r()
    if (r() > Math.exp(-Math.abs(z) / p.scaleHeight)) continue
    let acc = 0,
      C = CLASSES[0]
    for (const q of CLASSES) {
      acc += q.share
      if (u <= acc) {
        C = q
        break
      }
    }
    const M = C.M[0] + (C.M[1] - C.M[0]) * a,
      dly = Math.hypot(x, y, z)
    if (dly < p.catalogNear) continue
    const m = M + 5 * Math.log10(dly / LY_PER_PC) - 5
    if (m < p.catalogMag) continue
    const f = (C.M[1] - M) / (C.M[1] - C.M[0])
    const mass = C.mass[0] + (C.mass[1] - C.mass[0]) * f,
      ci = C.ci[1] - (C.ci[1] - C.ci[0]) * f
    const sub = C.c === 'D' ? 'DA' : C.c + Math.min(9, Math.floor((1 - f) * 10)) + 'V'
    out.push({
      id: `g:${ix},${iy},${iz}:${k}`,
      x,
      y,
      z,
      absmag: M,
      mag: m,
      spect: sub,
      cls: C.c,
      ci,
      mass,
      gen: true,
      hab: h < (p.habitable[C.c] || 0)
    })
  }
  return out
}
/* eslint-enable */

const params: StarfieldParams = { seed: 1, density: 0.004, scaleHeight: 1000, cell: 25, catalogMag: 8, catalogNear: 25 }

describe('generated stars', () => {
  it('are exactly the prototype’s, cell by cell', () => {
    let compared = 0
    for (const seed of [1, 7, 4242]) {
      for (const [ix, iy, iz] of [
        [0, 0, 0],
        [3, -2, 1],
        [-5, 4, -1],
        [9, 9, 0],
        [-1, -1, -1]
      ] as const) {
        const want = genCell({ ...params, seed, habitable: {} }, ix, iy, iz)
        const got = generateCell({ ...params, seed }, ix, iy, iz)
        expect(got.length).toBe(want.length)
        got.forEach((s, i) => {
          const w = want[i]
          expect(s.id).toBe(generatedId(ix, iy, iz, Number(w.id.split(':')[2])))
          expect(s.pos).toEqual([w.x, w.y, w.z])
          expect([s.absmag, s.mag, s.spect, s.cls, s.ci, s.mass]).toEqual([w.absmag, w.mag, w.spect, w.cls, w.ci, w.mass])
        })
        compared += got.length
      }
    }
    expect(compared).toBeGreaterThan(200)
  })

  it('round-trip their ids and find the cells near a point', () => {
    expect(parseGeneratedId('g.-3_0_12.7')).toEqual({ cell: [-3, 0, 12], k: 7 })
    expect(parseGeneratedId('hip.1')).toBeNull()
    const cells = cellsNear(params, [0, 0, 0], 30)
    expect(cells).toContainEqual([0, 0, 0])
    expect(cells).toContainEqual([-2, 0, 0])
    expect(cells).not.toContainEqual([2, 2, 2]) // its nearest corner is 86 ly away
  })
})

describe('star physics', () => {
  it('reproduces the Sun', () => {
    const p = starPhysics(SOL)
    expect(Math.abs(p.teff - 5772)).toBeLessThan(40)
    expect(Math.abs(p.luminosity - 1)).toBeLessThan(0.05)
    expect(Math.abs(p.radius - 1)).toBeLessThan(0.05)
    expect(Math.abs(p.mass! - 1)).toBeLessThan(0.02)
    expect(Math.abs(bolometricCorrection(5772) - -0.07)).toBeLessThan(0.05)
  })

  it('gives sensible values for familiar stars', () => {
    // Proxima Centauri: M5.5V, L ≈ 0.0017 L☉, M ≈ 0.12 M☉, T ≈ 3000 K.
    const proxima = starPhysics(starFromRow([2.93, -3.04, -0.14, 15.45, 11.01, 'M5Ve', 1.81, 'Proxima Centauri', 70890, 70666]))
    expect(proxima.teff).toBeGreaterThan(2800)
    expect(proxima.teff).toBeLessThan(3300) // from the M-dwarf sequence, since B−V saturates
    expect(proxima.luminosity).toBeGreaterThan(0.0008)
    expect(proxima.luminosity).toBeLessThan(0.004)
    expect(proxima.mass!).toBeGreaterThan(0.08)
    expect(proxima.mass!).toBeLessThan(0.2)
    // Sirius A: A1V, L ≈ 25 L☉, M ≈ 2.0 M☉.
    const sirius = starPhysics(starFromRow([-5.77, -6.24, -1.33, 1.45, -1.44, 'A0m...', 0.01, 'Sirius', 32349, 32263]))
    expect(sirius.luminosity).toBeGreaterThan(18)
    expect(sirius.luminosity).toBeLessThan(35)
    expect(sirius.mass!).toBeGreaterThan(1.7)
    expect(sirius.mass!).toBeLessThan(2.6)
    // Arcturus is a giant: no main-sequence mass.
    const arcturus = starPhysics(starFromRow([12.64, 3.4, 34.3, -0.31, -0.05, 'K2IIIp', 1.24, 'Arcturus', 69673, 69451]))
    expect(arcturus.mass).toBeNull()
    expect(arcturus.radius).toBeGreaterThan(15)
  })

  it('classifies spectra and luminosity classes', () => {
    expect(classOf('O9V', 0)).toBe('B')
    expect(classOf('DA2', 11)).toBe('D')
    expect(classOf('', 12)).toBe('M')
    expect(isGiant('K2IIIp')).toBe(true)
    expect(isGiant('F0Ib')).toBe(true)
    expect(isGiant('G2V')).toBe(false)
    expect(isGiant('M5Ve')).toBe(false)
    expect(isGiant('A0m...')).toBe(false)
    expect(isGiant('K0IV')).toBe(false)
    expect(mainSequenceMass(1)).toBe(1)
    expect(teffFromBV(0.65)).toBeGreaterThan(5700)
  })
})
