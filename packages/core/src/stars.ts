/**
 * Stars: catalogue records, generated faint stars, and physical estimates.
 *
 * Frame: galactic light-years with the Sun at the origin (x toward the
 * galactic centre, y toward galactic rotation, z to the north galactic pole).
 *
 * Ids appear in world files, so they never change:
 * - a catalogue star is `hip.<n>`, or `hyg.<n>` without a Hipparcos number;
 *   Sol is `hyg.0`;
 * - a generated star is `g.<ix>_<iy>_<iz>.<k>`: the k-th star of grid cell
 *   (ix, iy, iz). (The prototype wrote these `g:ix,iy,iz:k`.)
 *
 * `generateCell` is the prototype's genCell (story-thing star-map/star-gen.js)
 * ported exactly, so a cell holds the same stars for the same seed and
 * parameters. Frozen as the generator `starfield@1`.
 */
import { hashInts, mulberry32, normal } from './rng'

export const LY_PER_PC = 3.261564

/** One star, real or generated. */
export interface StarRecord {
  id: string
  /** Galactic light-years. */
  pos: [number, number, number]
  /** Absolute visual magnitude. */
  absmag: number
  /** Apparent visual magnitude from Sol (not meaningful for Sol itself). */
  mag: number
  spect: string
  /** B−V colour index. */
  ci: number
  name: string | null
  generated: boolean
  /** Spectral class letter used for estimates: B, A, F, G, K, M or D (white dwarf). */
  cls: string
  /** Mass, solar masses, where the source gives one (generated stars). */
  mass: number | null
}

/** A catalogue row: [x, y, z, absmag, mag, spect, ci, name, hip, hyg]. */
export type CatalogRow = [number, number, number, number, number, string | null, number | null, string | null, number | null, number]

export function catalogId(hip: number | null, hyg: number): string {
  return hip ? `hip.${hip}` : `hyg.${hyg}`
}

/** The Sun, which a catalogue built from distances leaves out. Values: IAU 2015 nominal / Willmer 2018. */
export const SOL: StarRecord = {
  id: 'hyg.0',
  pos: [0, 0, 0],
  absmag: 4.83,
  mag: -26.74,
  spect: 'G2V',
  ci: 0.656,
  name: 'Sol',
  generated: false,
  cls: 'G',
  mass: 1
}

export function starFromRow(row: CatalogRow): StarRecord {
  const [x, y, z, absmag, mag, spect, ci, name, hip, hyg] = row
  const cls = classOf(spect ?? '', absmag)
  return {
    id: catalogId(hip, hyg),
    pos: [x, y, z],
    absmag,
    mag,
    spect: spect ?? '',
    ci: ci ?? ciOf(cls),
    name: name || null,
    generated: false,
    cls,
    mass: null
  }
}

// ---- the stellar population (the prototype's table; part of starfield@1) ----

export interface StarClass {
  c: string
  share: number
  /** Absolute visual magnitude range. */
  M: [number, number]
  mass: [number, number]
  ci: [number, number]
}

export const STAR_CLASSES: readonly StarClass[] = [
  { c: 'M', share: 0.73, M: [8.8, 16], mass: [0.08, 0.5], ci: [1.4, 1.9] },
  { c: 'K', share: 0.12, M: [5.9, 8.8], mass: [0.5, 0.8], ci: [0.82, 1.4] },
  { c: 'G', share: 0.065, M: [4.4, 5.9], mass: [0.8, 1.05], ci: [0.59, 0.82] },
  { c: 'F', share: 0.03, M: [2.4, 4.4], mass: [1.05, 1.4], ci: [0.3, 0.59] },
  { c: 'A', share: 0.006, M: [0.6, 2.4], mass: [1.4, 2.1], ci: [0.0, 0.3] },
  { c: 'B', share: 0.0012, M: [-2.5, 0.6], mass: [2.1, 10], ci: [-0.25, 0.0] },
  { c: 'D', share: 0.048, M: [10.5, 15.5], mass: [0.5, 0.8], ci: [-0.1, 0.6] }
]

export function classOf(spect: string, absmag: number): string {
  const c = spect.trim().toUpperCase()[0]
  if (c && 'OBAFGKM'.includes(c)) return c === 'O' ? 'B' : c
  if (c === 'D' || /^W/.test(spect)) return 'D'
  if (absmag > 10) return 'M'
  if (absmag > 6) return 'K'
  if (absmag > 4.4) return 'G'
  if (absmag > 2.4) return 'F'
  if (absmag > 0.6) return 'A'
  return 'B'
}

export function ciOf(cls: string): number {
  return ({ M: 1.6, K: 1.1, G: 0.7, F: 0.45, A: 0.15, B: -0.15, D: 0.2 } as Record<string, number>)[cls] ?? 0.6
}

// ---- generated stars ----

export interface StarfieldParams {
  seed: number
  /** Stars per cubic light-year near the plane. */
  density: number
  /** Light-years: the disk thins exponentially above and below the plane. */
  scaleHeight: number
  /** Light-years: the edge of each cube that has its own seed. */
  cell: number
  /** Generated stars are never brighter than this from Sol (the catalogue has those). */
  catalogMag: number
  /** Light-years: within this the catalogue is taken as complete. */
  catalogNear: number
}

export function generatedId(ix: number, iy: number, iz: number, k: number): string {
  return `g.${ix}_${iy}_${iz}.${k}`
}

/** The cell and index a generated id names, or null. */
export function parseGeneratedId(id: string): { cell: [number, number, number]; k: number } | null {
  const m = /^g\.(-?\d+)_(-?\d+)_(-?\d+)\.(\d+)$/.exec(id)
  return m ? { cell: [Number(m[1]), Number(m[2]), Number(m[3])], k: Number(m[4]) } : null
}

/**
 * The generated stars of one cell (the prototype's genCell, exactly). The
 * index k counts every candidate drawn, including ones that were rejected,
 * so ids are stable and may have gaps.
 */
export function generateCell(p: StarfieldParams, ix: number, iy: number, iz: number): StarRecord[] {
  const r = mulberry32(hashInts(p.seed, ix, iy, iz))
  const out: StarRecord[] = []
  const vol = p.cell ** 3
  const mean = p.density * vol
  const n = Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(r)))
  for (let k = 0; k < n; k++) {
    const x = (ix + r()) * p.cell
    const y = (iy + r()) * p.cell
    const z = (iz + r()) * p.cell
    const u = r()
    const a = r()
    r() // b: drawn by the prototype and unused; kept so the stream stays aligned
    r() // h: the prototype's habitable-candidate draw; planets@1 decides habitability now
    if (r() > Math.exp(-Math.abs(z) / p.scaleHeight)) continue
    let acc = 0
    let C = STAR_CLASSES[0]
    for (const q of STAR_CLASSES) {
      acc += q.share
      if (u <= acc) {
        C = q
        break
      }
    }
    const M = C.M[0] + (C.M[1] - C.M[0]) * a
    const dly = Math.hypot(x, y, z)
    if (dly < p.catalogNear) continue
    const m = M + 5 * Math.log10(dly / LY_PER_PC) - 5
    if (m < p.catalogMag) continue
    const f = (C.M[1] - M) / (C.M[1] - C.M[0])
    const mass = C.mass[0] + (C.mass[1] - C.mass[0]) * f
    const ci = C.ci[1] - (C.ci[1] - C.ci[0]) * f
    const spect = C.c === 'D' ? 'DA' : `${C.c}${Math.min(9, Math.floor((1 - f) * 10))}V`
    out.push({ id: generatedId(ix, iy, iz, k), pos: [x, y, z], absmag: M, mag: m, spect, ci, name: null, generated: true, cls: C.c, mass })
  }
  return out
}

/** Every cell index whose cube comes within `radius` of `center`. */
export function cellsNear(p: Pick<StarfieldParams, 'cell'>, center: [number, number, number], radius: number): [number, number, number][] {
  const out: [number, number, number][] = []
  const lo = center.map((c) => Math.floor((c - radius) / p.cell))
  const hi = center.map((c) => Math.floor((c + radius) / p.cell))
  for (let ix = lo[0]; ix <= hi[0]; ix++)
    for (let iy = lo[1]; iy <= hi[1]; iy++)
      for (let iz = lo[2]; iz <= hi[2]; iz++) {
        // Nearest point of the cube to the centre.
        const d = Math.hypot(
          Math.max(ix * p.cell - center[0], 0, center[0] - (ix + 1) * p.cell),
          Math.max(iy * p.cell - center[1], 0, center[1] - (iy + 1) * p.cell),
          Math.max(iz * p.cell - center[2], 0, center[2] - (iz + 1) * p.cell)
        )
        if (d <= radius) out.push([ix, iy, iz])
      }
  return out
}

// ---- physical estimates ----

export interface StarPhysics {
  /** Effective temperature, K. */
  teff: number
  /** Bolometric luminosity, L☉. */
  luminosity: number
  /** Radius, R☉. */
  radius: number
  /** Mass, M☉; null when no estimate applies (giants, supergiants). */
  mass: number | null
  /** Where the mass came from. */
  massSource: 'given' | 'white dwarf' | 'main sequence' | 'none'
}

/**
 * Effective temperature from B−V (Ballesteros 2012). Good across F–K; for
 * cool M dwarfs B−V saturates and this runs a few hundred kelvin warm, which a
 * system's star override can correct.
 */
export function teffFromBV(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
}

/** Bolometric correction BC_V from effective temperature (Flower 1996 as corrected by Torres 2010). */
export function bolometricCorrection(teff: number): number {
  const lt = Math.log10(teff)
  const poly = (c: number[]): number => c.reduce((s, k, i) => s + k * lt ** i, 0)
  if (lt < 3.7) return poly([-0.190537291496456e5, 0.155144866764412e5, -0.421278819301717e4, 0.381476328422343e3])
  if (lt < 3.9) return poly([-0.370510203809015e5, 0.385672629965804e5, -0.150651486316025e5, 0.261724637119416e4, -0.170623810323864e3])
  return poly([
    -0.118115450538963e6, 0.137145973583929e6, -0.636233812100225e5, 0.147412923562646e5, -0.170587278406872e4, 0.78873172180499e2
  ])
}

/** Solar absolute bolometric magnitude (IAU 2015 B2). */
export const MBOL_SUN = 4.74

/** Main-sequence mass from luminosity (the usual piecewise mass–luminosity relation, inverted). */
export function mainSequenceMass(luminosity: number): number {
  if (luminosity < 0.033) return Math.pow(luminosity / 0.23, 1 / 2.3)
  if (luminosity < 16) return Math.pow(luminosity, 0.25)
  return Math.pow(luminosity / 1.4, 1 / 3.5)
}

/** Is the spectral type a giant or supergiant (luminosity class I, II or III) rather than a dwarf? */
export function isGiant(spect: string): boolean {
  // Look past the temperature class ("K2", "F0.5") for a luminosity class I, II or III (Ia, Iab, Ib too).
  const rest = spect.replace(/^[A-Za-z]+[\d.]*/, ' ')
  return /(?:^|[^A-Za-z])(?:Iab|Ia|Ib|III|II|I)(?![IV])/.test(rest) && !/V/.test(spect)
}

/**
 * The M-dwarf main sequence: absolute visual magnitude, effective
 * temperature and log luminosity, M0V to M8V (after Pecaut & Mamajek 2013;
 * approximate). Used instead of colour for cool dwarfs, where B−V saturates.
 */
const M_DWARFS: readonly [number, number, number][] = [
  [8.9, 3850, -1.07],
  [9.6, 3660, -1.24],
  [10.3, 3560, -1.4],
  [11.2, 3430, -1.62],
  [12.7, 3210, -2.01],
  [14.3, 3060, -2.47],
  [16.6, 2810, -2.94],
  [18.4, 2680, -3.13],
  [19.6, 2570, -3.3]
]

function interpolate(rows: readonly (readonly number[])[], x: number, col: number): number {
  if (x <= rows[0][0]) return rows[0][col]
  for (let i = 1; i < rows.length; i++) {
    if (x <= rows[i][0]) {
      const f = (x - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0])
      return rows[i - 1][col] + f * (rows[i][col] - rows[i - 1][col])
    }
  }
  return rows[rows.length - 1][col]
}

/** Temperature, luminosity, radius and (where it applies) mass, from magnitude, colour and spectral type. */
export function starPhysics(s: Pick<StarRecord, 'absmag' | 'ci' | 'spect' | 'cls' | 'mass'>): StarPhysics {
  const coolDwarf = s.cls === 'M' && s.absmag >= M_DWARFS[0][0] && !isGiant(s.spect)
  const teff = coolDwarf ? interpolate(M_DWARFS, s.absmag, 1) : teffFromBV(Math.max(-0.4, Math.min(2.2, s.ci)))
  const luminosity = coolDwarf
    ? Math.pow(10, interpolate(M_DWARFS, s.absmag, 2))
    : Math.pow(10, -0.4 * (s.absmag + bolometricCorrection(teff) - MBOL_SUN))
  const radius = Math.sqrt(luminosity) / (teff / 5772) ** 2
  if (s.mass !== null && s.mass !== undefined) return { teff, luminosity, radius, mass: s.mass, massSource: 'given' }
  if (s.cls === 'D') return { teff, luminosity, radius, mass: 0.6, massSource: 'white dwarf' }
  if (isGiant(s.spect)) return { teff, luminosity, radius, mass: null, massSource: 'none' }
  return { teff, luminosity, radius, mass: mainSequenceMass(luminosity), massSource: 'main sequence' }
}

/** Distance in light-years between two stars' positions. */
export function starDistance(a: StarRecord, b: StarRecord): number {
  return Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])
}
