/**
 * Sky brightness and colour, ported from the prototype torchlight.
 *
 * - Single scattering (Rayleigh, Mie, ozone) along the view ray, with the
 *   Chapman approximation for the sunlight's path.
 * - An empirical multiple-scattering term, fitted to measured twilight.
 * - The natural night sky (airglow, zodiacal light, faint stars, after
 *   Krisciunas & Schaefer 1991), the Milky Way along the galactic plane, and
 *   moonlight on the sky (K&S 1991).
 * - Extinction (mag per airmass) and the faintest visible point against the
 *   local sky (Schaefer 1990), for the naked eye or an instrument.
 *
 * The constants are Earth's. Another planet's atmosphere is Earth's scaled:
 * by its column of air (surface pressure over gravity, relative to Earth), by
 * its scale height, by the planet's radius, and by the starlight reaching it.
 * That is a sketch, not a radiative-transfer model; a thin, cold or exotic
 * atmosphere will not be right in detail.
 *
 * Local directions are unit vectors with x east, y north, z up. Luminances
 * are in cd/m²-like units (the prototype's scale); colours are linear RGB.
 */
import { DEG } from './units'
import type { Vec3 } from './vec'

export type RGB = [number, number, number]

/** Earth's atmosphere as the prototype models it. */
export const EARTH_AIR = {
  radius: 6371e3,
  rayleighHeight: 8000,
  mieHeight: 1200,
  rayleigh: [5.802e-6, 13.558e-6, 33.1e-6] as RGB,
  mieScatter: 3.996e-6,
  mieExtinct: 4.44e-6,
  /**
   * Ozone absorption, applied with the air's own density profile (as the
   * prototype does). The prototype's values, 3.66/10.6/0.48 × 10⁻⁶, put about
   * three times Earth's ozone column on that profile and turned twilight
   * purple; these are Bruneton's (2017) coefficients rescaled to the same
   * column (his ozone layer integrates to about 15 km at peak density, the
   * Rayleigh profile to 8 km).
   */
  ozone: [1.22e-6, 3.53e-6, 0.16e-6] as RGB,
  mieG: 0.8,
  /** Sunlight at the top of Earth's atmosphere, in the model's units. */
  sun: 1.27e5,
  /** V-band extinction, mag per airmass. */
  extinction: 0.2,
  /** Natural night-sky zenith brightness, mag/arcsec². */
  nightZenith_magArcsec2: 21.8
}

export interface Atmosphere {
  /** Planet radius, m. */
  radius: number
  /** Column of air relative to Earth's (pressure/gravity relative to Earth's). 0 for none. */
  column: number
  /** Rayleigh scale height, m. */
  scaleHeight: number
  /** Starlight at the planet relative to sunlight at Earth (flux ratio). */
  light: number
}

/** The scattering coefficients the model uses for an atmosphere (what the shader is given, too). */
export interface AirParams {
  R: number
  RA: number
  HR: number
  HM: number
  BR: RGB
  BO: RGB
  BMs: number
  BMe: number
  g: number
  E: number
  /** Extinction, mag per airmass. */
  k: number
}

export function airParams(a: Atmosphere): AirParams {
  const e = EARTH_AIR
  const HR = a.scaleHeight
  const HM = (a.scaleHeight * e.mieHeight) / e.rayleighHeight
  // Keep the column (β × H) proportional to the air's column.
  const f = (a.column * e.rayleighHeight) / HR
  return {
    R: a.radius,
    RA: a.radius + 12.5 * HR,
    HR,
    HM,
    BR: e.rayleigh.map((b) => b * f) as RGB,
    BO: e.ozone.map((b) => b * f) as RGB,
    BMs: e.mieScatter * f,
    BMe: e.mieExtinct * f,
    g: e.mieG,
    E: e.sun * a.light,
    k: e.extinction * a.column
  }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
export const luminanceOf = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const altDeg = (d: Vec3): number => Math.asin(clamp(d[2], -1, 1)) / DEG

/** Chapman's grazing-incidence integral (the prototype's chapman()). */
export function chapman(X: number, h: number, cz: number): number {
  const c = Math.sqrt(1.5707963 * (X + h))
  if (cz >= 0) return (c / (c * cz + 1)) * Math.exp(-h)
  const x0 = Math.sqrt(1 - cz * cz) * (X + h)
  const c0 = Math.sqrt(1.5707963 * x0)
  return 2 * c0 * Math.exp(X - x0) - (c / (1 - c * cz)) * Math.exp(-h)
}

/** Fraction of sunlight (per channel) reaching an observer at height `hObs` with the Sun at cos(zenith) `cz`. */
export function sunTransmission(p: AirParams, cz: number, hObs = 0): RGB {
  if (cz < 0 && (p.R + hObs) * Math.sqrt(1 - cz * cz) < p.R) return [0, 0, 0]
  const lR = p.HR * chapman(p.R / p.HR, hObs / p.HR, cz)
  const lM = p.HM * chapman(p.R / p.HM, hObs / p.HM, cz)
  return [0, 1, 2].map((i) => Math.exp(-(p.BR[i] + p.BO[i]) * lR - p.BMe * lM)) as RGB
}

/** Singly scattered skylight along local direction d, with the Sun along s (the prototype's ssRGB). */
export function singleScatter(p: AirParams, d: Vec3, s: Vec3, hObs = 0): RGB {
  const N = 16
  const o: Vec3 = [0, 0, p.R + hObs]
  const b = dot(o, d)
  const c = dot(o, o) - p.RA * p.RA
  let tmax = -b + Math.sqrt(Math.max(b * b - c, 0))
  const dg = b * b - (dot(o, o) - p.R * p.R)
  if (dg > 0) {
    const tg = -b - Math.sqrt(dg)
    if (tg > 0) tmax = Math.min(tmax, tg)
  }
  const mu = dot(d, s)
  const g = p.g
  const pR = 0.0596831 * (1 + mu * mu)
  const pM = (0.1193662 * (1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5))
  const sR = [0, 0, 0]
  const sM = [0, 0, 0]
  let oR = 0
  let oM = 0
  for (let i = 0; i < N; i++) {
    const f = (i + 0.5) / N
    const t = tmax * f * f
    const dt = (tmax * 2 * f) / N
    const q: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
    const r = Math.hypot(q[0], q[1], q[2])
    const h = r - p.R
    const dR = Math.exp(-h / p.HR) * dt
    const dM = Math.exp(-h / p.HM) * dt
    oR += dR * 0.5
    oM += dM * 0.5
    const cz = dot(q, s) / r
    if (!(cz < 0 && r * Math.sqrt(1 - cz * cz) < p.R)) {
      const lR = p.HR * chapman(p.R / p.HR, h / p.HR, cz)
      const lM = p.HM * chapman(p.R / p.HM, h / p.HM, cz)
      for (let k = 0; k < 3; k++) {
        const at = Math.exp(-(p.BR[k] + p.BO[k]) * (oR + lR) - p.BMe * (oM + lM))
        sR[k] += at * dR
        sM[k] += at * dM
      }
    }
    oR += dR * 0.5
    oM += dM * 0.5
  }
  return [0, 1, 2].map((k) => p.E * (sR[k] * p.BR[k] * pR + sM[k] * p.BMs * pM)) as RGB
}

/** Krisciunas & Schaefer's airmass for scattered light, from zenith distance in degrees. */
export const scatterAirmass = (zd: number): number => 1 / Math.sqrt(1 - 0.96 * Math.sin(Math.min(zd, 90) * DEG) ** 2)

/** Airmass for a star's light at altitude `alt` degrees (Kasten & Young 1989). */
export function airmass(alt: number): number {
  if (alt <= -1) return Infinity
  const a = Math.max(alt, 0)
  return 1 / (Math.sin(a * DEG) + 0.50572 * (a + 6.07995) ** -1.6364)
}

/** Zenith luminance of the multiple-scattering term against the Sun's altitude (degrees), for Earth's air. */
const MS_TABLE: [number, number][] = [
  [-20, -6],
  [-18, -4.7],
  [-15, -3.8],
  [-12, -2.6],
  [-9, -1.3],
  [-6, -0.5],
  [-3, 0.7],
  [0, 1.6],
  [5, 2.78],
  [15, 3.1],
  [30, 3.34],
  [60, 3.43],
  [90, 3.45]
]

export function multipleScatterZenith(sunAlt: number): number {
  const T = MS_TABLE
  if (sunAlt <= T[0][0]) return 0
  for (let i = 1; i < T.length; i++)
    if (sunAlt <= T[i][0]) {
      const f = (sunAlt - T[i - 1][0]) / (T[i][0] - T[i - 1][0])
      return 10 ** (T[i - 1][1] + f * (T[i][1] - T[i - 1][1]))
    }
  return 10 ** T[T.length - 1][1]
}

/** How much the multiple-scattering term brightens toward the Sun's side in twilight. */
export const multipleScatterAsymmetry = (sunAlt: number): number => clamp((6 - Math.abs(sunAlt + 3)) / 6, 0, 1) * 3 + 0.6

export const muToCd = (mu: number): number => 1.08e5 * 10 ** (-0.4 * mu)
export const cdToMu = (L: number): number => -2.5 * Math.log10(L / 1.08e5)

const nrmY = (c: RGB): RGB => {
  const y = luminanceOf(c)
  return [c[0] / y, c[1] / y, c[2] / y]
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export interface SkyInputs {
  air: AirParams
  /** Column of air relative to Earth's: scales the twilight and night terms. 0 for none. */
  column: number
  /** Unit vector to the star, local frame. */
  sun: Vec3
  /** Galactic north pole and the galactic centre, as local unit vectors (for the Milky Way). */
  galPole: Vec3
  galCentre: Vec3
  /** The brightest moon, if one is up: direction and apparent magnitude. */
  moon?: { dir: Vec3; mag: number } | null
  hObs?: number
}

/**
 * The sky's brightness and colour in every direction (the prototype's skyL),
 * with single scattering precomputed on a grid of altitude and azimuth from
 * the Sun. Build once per instant; then `light(d)` is cheap.
 */
export interface SkyModel {
  /** Luminance of the sky background along d, linear RGB. */
  light(d: Vec3): RGB
  /** The faintest point visible along d (naked eye unless an instrument is given). */
  limitingMagnitude(d: Vec3, instrument?: Instrument | null): number
  /** Extinction of a point source along d, magnitudes. */
  extinction(d: Vec3): number
  sunAlt: number
}

const GRID_ALT = [-1, 0, 1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 35, 45, 57, 70, 90]

export function skyModel(inp: SkyInputs): SkyModel {
  const { air, sun } = inp
  const sunAlt = altDeg(sun)
  const sunAz = Math.atan2(sun[0], sun[1])
  const hObs = inp.hObs ?? 0
  const scatter = inp.column > 0 && sunAlt > -14
  const n = GRID_ALT.length
  const grid: RGB[] = []
  if (scatter) {
    const s: Vec3 = [0, Math.cos(sunAlt * DEG), Math.sin(sunAlt * DEG)]
    for (let i = 0; i < 31; i++)
      for (let j = 0; j < n; j++) {
        const a = i * 6 * DEG
        const b = GRID_ALT[j] * DEG
        const c = singleScatter(air, [Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b), Math.sin(b)], s, hObs)
        grid.push(c.map((v) => Math.log(v + 1e-12)) as RGB)
      }
  }
  const ss = (d: Vec3): RGB => {
    if (!scatter) return [0, 0, 0]
    const alt = clamp(altDeg(d), -1, 90)
    const daz = Math.abs((((Math.atan2(d[0], d[1]) - sunAz) / DEG + 540) % 360) - 180) / 6
    const i = Math.min(29, Math.floor(daz))
    const fi = daz - i
    let j = 0
    while (j < n - 2 && GRID_ALT[j + 1] < alt) j++
    const fj = clamp((alt - GRID_ALT[j]) / (GRID_ALT[j + 1] - GRID_ALT[j]), 0, 1)
    const at = (ii: number, jj: number): RGB => grid[ii * n + jj]
    return [0, 1, 2].map((k) =>
      Math.exp((at(i, j)[k] * (1 - fi) + at(i + 1, j)[k] * fi) * (1 - fj) + (at(i, j + 1)[k] * (1 - fi) + at(i + 1, j + 1)[k] * fi) * fj)
    ) as RGB
  }
  const ms = inp.column > 0 ? multipleScatterZenith(sunAlt) * Math.min(1, inp.column) * Math.min(1, air.E / EARTH_AIR.sun) : 0
  const msa = multipleScatterAsymmetry(sunAlt)
  // The natural night sky: airglow needs air; with none, zodiacal light and faint stars alone (about 22.5 mag/arcsec²).
  const nightZ = muToCd(inp.column > 0 ? EARTH_AIR.nightZenith_magArcsec2 : 22.5)
  const k = air.k
  const moon = inp.moon && altDeg(inp.moon.dir) > 0 && inp.column > 0 ? inp.moon : null

  const light = (d: Vec3): RGB => {
    const alt = altDeg(d)
    const zd = 90 - Math.max(alt, 0)
    const X = scatterAirmass(zd)
    let L: RGB = ss(d)
    const psi = Math.acos(clamp(dot(d, sun), -1, 1))
    const lo = 1 - Math.max(d[2], 0)
    const add = (c: RGB, w: number): void => {
      L = [L[0] + c[0] * w, L[1] + c[1] * w, L[2] + c[2] * w]
    }
    if (ms > 0) {
      const warm = Math.exp(-psi / 0.6) * lo * lo * clamp((4 - sunAlt) / 8, 0, 1)
      add(nrmY(mix([0.36, 0.55, 1], [1, 0.62, 0.38], warm)), ms * (1 + msa * Math.exp(-psi / 0.7) * lo * lo) * Math.sqrt(X))
    }
    const ext = inp.column > 0 ? 10 ** (-0.4 * k * (X - 1)) : 1
    add(nrmY([0.8, 0.9, 1]), nightZ * (inp.column > 0 ? X : 1) * ext)
    // The Milky Way along the real galactic plane.
    const gb = Math.asin(clamp(dot(d, inp.galPole), -1, 1))
    const gy: Vec3 = [
      inp.galPole[1] * inp.galCentre[2] - inp.galPole[2] * inp.galCentre[1],
      inp.galPole[2] * inp.galCentre[0] - inp.galPole[0] * inp.galCentre[2],
      inp.galPole[0] * inp.galCentre[1] - inp.galPole[1] * inp.galCentre[0]
    ]
    const gl = Math.atan2(dot(d, gy), dot(d, inp.galCentre))
    const patch = 0.65 + 0.2 * Math.sin(3 * gl + 0.5) + 0.15 * Math.sin(7 * gl + 2) + 0.1 * Math.sin(13 * gl)
    add(
      nrmY([0.85, 0.88, 1]),
      muToCd(21.8) *
        ext *
        (0.7 * Math.exp(-((gb / (10 * DEG)) ** 2)) * patch + 1.6 * Math.exp(-((gl / (25 * DEG)) ** 2) - (gb / (7 * DEG)) ** 2))
    )
    if (moon) {
      const rho = Math.acos(clamp(dot(d, moon.dir), -1, 1)) / DEG
      const cr = Math.cos(rho * DEG)
      const f = 10 ** 5.36 * (1.06 + cr * cr) + 10 ** (6.15 - Math.max(rho, 3) / 40)
      const I = 10 ** (-0.4 * (moon.mag + 16.57))
      const Zm = 90 - altDeg(moon.dir)
      add(
        nrmY([0.52, 0.7, 1]),
        f * I * 10 ** (-0.4 * k * scatterAirmass(Zm)) * (1 - 10 ** (-0.4 * k * scatterAirmass(zd))) * 3.183e-6 * Math.min(1, inp.column * 4)
      )
    }
    return L
  }

  return {
    sunAlt,
    light,
    extinction: (d) => (inp.column > 0 ? k * airmass(altDeg(d)) : 0),
    limitingMagnitude: (d, inst) => limitingMagnitude(luminanceOf(light(d)), inst ?? null)
  }
}

export interface Instrument {
  /** Aperture, mm. */
  aperture: number
  magnification: number
  /** Transmission, 0–1. */
  transmission: number
}

export const BINOCULARS: Instrument = { aperture: 50, magnification: 10, transmission: 0.85 }
export const TELESCOPE: Instrument = { aperture: 100, magnification: 40, transmission: 0.8 }

/** The eye's pupil, mm, adapted to luminance La. */
export const pupil = (La: number): number => 4.9 - 3 * Math.tanh(0.4 * (Math.log10(Math.max(La, 1e-7)) + 1))

/** The faintest point source visible against sky luminance Y (Schaefer 1990), with an optional instrument. */
export function limitingMagnitude(Y: number, o: Instrument | null): number {
  let B = Y / 3.183e-6
  let gain = 1
  if (o) {
    const pe = pupil(Y)
    const De = Math.min(o.aperture, pe * o.magnification)
    gain = o.transmission * (De / pe) ** 2
    B *= o.transmission * (De / (o.magnification * pe)) ** 2
  }
  const night = B < 1500
  const C1 = night ? 10 ** -9.8 : 10 ** -8.35
  const C2 = night ? 10 ** -1.9 : 10 ** -5.9
  const I = C1 * (1 + Math.sqrt(C2 * B)) ** 2
  return -16.57 - 2.5 * Math.log10(I) + 2.5 * Math.log10(gain)
}

/** The prototype's tone map: linear sky light to display RGB, 0–1, going blue-grey and dark at night. */
export function toneMap(L: RGB): RGB {
  const Y = luminanceOf(L)
  if (Y <= 1e-9) return [0, 0, 0]
  const lg = Math.log10(Y)
  const b = clamp((lg + 4.5) / 8.5, 0, 1) ** 1.5
  const mx = Math.max(...L)
  let c = L.map((v) => (v / mx) ** 0.65) as RGB
  const s = clamp((lg + 1) / -2, 0, 1)
  const t = s * s * (3 - 2 * s)
  c = c.map((v, i) => v * (1 - t) + [0.74, 0.82, 1][i] * t) as RGB
  return c.map((v) => v * b) as RGB
}
