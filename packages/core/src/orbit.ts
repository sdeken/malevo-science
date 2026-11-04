/**
 * Orbits and the planet-scale quantities that follow from them.
 *
 * Two-body Keplerian motion: each body moves on fixed elements around its
 * parent. That is the right level for worldbuilding (and it is what the
 * prototypes used); perturbations are not modelled. All quantities are SI.
 */
import type { Instant } from './time'
import { DEG, L_SUN } from './units'
import { add, cross, dot, norm, scale, type Vec3 } from './vec'

export interface OrbitalElements {
  /** Semi-major axis, m. */
  a: number
  /** Eccentricity, 0 ≤ e < 1. */
  e: number
  /** Inclination to the reference plane, rad. */
  i: number
  /** Longitude of the ascending node, rad. */
  node: number
  /** Argument of periapsis, rad. */
  peri: number
  /** Mean anomaly at `epoch`, rad. */
  meanAnomaly: number
  epoch: Instant
  /** Gravitational parameter G(M + m) of the pair, m³/s². */
  mu: number
}

const TAU = 2 * Math.PI
const wrap = (x: number): number => ((x % TAU) + TAU) % TAU

export function period(a: number, mu: number): number {
  return TAU * Math.sqrt((a * a * a) / mu)
}

export function semiMajorAxisForPeriod(p: number, mu: number): number {
  return Math.cbrt((mu * p * p) / (TAU * TAU))
}

export function meanMotion(a: number, mu: number): number {
  return Math.sqrt(mu / (a * a * a))
}

/** Eccentric anomaly E from mean anomaly M (Newton–Raphson; converges for all 0 ≤ e < 1). */
export function solveKepler(M: number, e: number): number {
  if (!(e >= 0 && e < 1)) throw new RangeError(`Eccentricity ${e} is not elliptic.`)
  const m = wrap(M)
  let E = e < 0.8 ? m : Math.PI
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - m
    const step = f / (1 - e * Math.cos(E))
    E -= step
    if (Math.abs(step) < 1e-15) break
  }
  return E
}

export function trueAnomalyFromEccentric(E: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))
}

/** Position and velocity relative to the parent, in the reference frame of the elements. */
export function stateAt(el: OrbitalElements, t: Instant): { r: Vec3; v: Vec3 } {
  const M = el.meanAnomaly + meanMotion(el.a, el.mu) * (t - el.epoch)
  const E = solveKepler(M, el.e)
  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  const b = el.a * Math.sqrt(1 - el.e * el.e)
  // Perifocal coordinates.
  const x = el.a * (cosE - el.e)
  const y = b * sinE
  const rLen = el.a * (1 - el.e * cosE)
  const n = meanMotion(el.a, el.mu)
  const vx = (-el.a * n * sinE * el.a) / rLen
  const vy = (b * n * cosE * el.a) / rLen
  const toFrame = (px: number, py: number): Vec3 => {
    const cO = Math.cos(el.node)
    const sO = Math.sin(el.node)
    const cw = Math.cos(el.peri)
    const sw = Math.sin(el.peri)
    const ci = Math.cos(el.i)
    const si = Math.sin(el.i)
    return [
      (cO * cw - sO * sw * ci) * px + (-cO * sw - sO * cw * ci) * py,
      (sO * cw + cO * sw * ci) * px + (-sO * sw + cO * cw * ci) * py,
      sw * si * px + cw * si * py
    ]
  }
  return { r: toFrame(x, y), v: toFrame(vx, vy) }
}

export function positionAt(el: OrbitalElements, t: Instant): Vec3 {
  return stateAt(el, t).r
}

/** Elements from a state vector (elliptic orbits). Angles that are undefined for circular or flat orbits are taken as 0. */
export function elementsFromState(r: Vec3, v: Vec3, mu: number, epoch: Instant): OrbitalElements {
  const rLen = norm(r)
  const h = cross(r, v)
  const hLen = norm(h)
  const eVec = add(scale(cross(v, h), 1 / mu), scale(r, -1 / rLen))
  const e = norm(eVec)
  const energy = dot(v, v) / 2 - mu / rLen
  const a = -mu / (2 * energy)
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hLen)))
  const nodeVec: Vec3 = [-h[1], h[0], 0]
  const nLen = norm(nodeVec)
  const node = nLen > 1e-12 * hLen ? wrap(Math.atan2(nodeVec[1], nodeVec[0])) : 0
  // Argument of latitude u (node → body) and of periapsis.
  const nodeDir: Vec3 = nLen > 1e-12 * hLen ? scale(nodeVec, 1 / nLen) : [1, 0, 0]
  const inPlane = cross(scale(h, 1 / hLen), nodeDir)
  const angleIn = (vec: Vec3): number => Math.atan2(dot(vec, inPlane), dot(vec, nodeDir))
  const peri = e > 1e-12 ? wrap(angleIn(eVec)) : 0
  const u = angleIn(r)
  const nu = wrap(u - peri)
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2))
  return { a, e, i, node, peri, meanAnomaly: wrap(E - e * Math.sin(E)), epoch, mu }
}

/** Time between successive identical alignments of two bodies orbiting the same parent. */
export function synodicPeriod(p1: number, p2: number): number {
  const d = Math.abs(1 / p1 - 1 / p2)
  return d === 0 ? Infinity : 1 / d
}

/**
 * Length of the solar day (noon to noon) from the sidereal rotation period
 * and the orbital period. A negative rotation period means retrograde
 * rotation. Infinity for a tidally locked body.
 */
export function solarDayLength(rotationPeriod: number, orbitalPeriod: number): number {
  const d = 1 / rotationPeriod - 1 / orbitalPeriod
  return d === 0 ? Infinity : Math.abs(1 / d)
}

/** Stellar flux at distance d from a star of luminosity L (W), W/m². */
export function insolation(luminosity: number, d: number): number {
  return luminosity / (4 * Math.PI * d * d)
}

/** Blackbody equilibrium temperature, K, for a rapidly rotating body with the given Bond albedo. */
export function equilibriumTemperature(luminosity: number, d: number, albedo: number): number {
  const SIGMA = 5.670374419e-8
  return Math.pow((insolation(luminosity, d) * (1 - albedo)) / (4 * SIGMA), 0.25)
}

/**
 * The conservative habitable zone (Kopparapu et al. 2014, 1 Earth mass):
 * inner edge at the runaway greenhouse limit, outer at the maximum greenhouse
 * limit. Valid for effective temperatures of about 2600–7200 K. Distances in m.
 */
export function habitableZone(luminosity: number, teff = 5780): { inner: number; outer: number } {
  const T = teff - 5780
  const seff = (s0: number, a: number, b: number, c: number, d: number): number => s0 + a * T + b * T ** 2 + c * T ** 3 + d * T ** 4
  const inner = seff(1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15)
  const outer = seff(0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16)
  const AU_M = 149_597_870_700
  const l = luminosity / L_SUN
  return { inner: Math.sqrt(l / inner) * AU_M, outer: Math.sqrt(l / outer) * AU_M }
}

/** Peak tidal acceleration across a body of radius R raised by a mass GM at distance d, m/s². */
export function tidalAcceleration(gm: number, radius: number, d: number): number {
  return (2 * gm * radius) / (d * d * d)
}

/** Hill sphere radius of a body of mass m orbiting a primary of mass M. */
export function hillRadius(a: number, e: number, m: number, M: number): number {
  return a * (1 - e) * Math.cbrt(m / (3 * M))
}

/** Solar declination for a planet with axial tilt `tilt` at solar longitude `ls` (0 at its northern spring equinox). */
export function solarDeclination(tilt: number, ls: number): number {
  return Math.asin(Math.sin(tilt) * Math.sin(ls))
}

/** The Sun's centre at −0.833°: the usual sunrise/sunset definition (refraction plus the solar radius, for an Earth-like atmosphere). */
export const SUNRISE_ALTITUDE = -0.833 * DEG

/**
 * Fraction of the solar day the Sun's centre spends above `altitude`, at
 * latitude `lat` with solar declination `dec`. 0 in polar night, 1 in
 * midnight sun.
 */
export function daylightFraction(lat: number, dec: number, altitude = SUNRISE_ALTITUDE): number {
  const cosH = (Math.sin(altitude) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec))
  if (cosH >= 1) return 0
  if (cosH <= -1) return 1
  return Math.acos(cosH) / Math.PI
}

/**
 * Intervals in [t0, t1] where `test` holds, found by sampling every `step`
 * and bisecting each edge to within `tolerance`. Windows shorter than `step`
 * can be missed; choose the step accordingly.
 */
export function findWindows(test: (t: Instant) => boolean, t0: Instant, t1: Instant, step: number, tolerance = 1): [Instant, Instant][] {
  const edge = (a: number, b: number, inside: boolean): number => {
    // test(a) === inside, test(b) !== inside
    while (b - a > tolerance) {
      const m = (a + b) / 2
      if (test(m) === inside) a = m
      else b = m
    }
    return (a + b) / 2
  }
  const out: [Instant, Instant][] = []
  let prevT = t0
  let prev = test(t0)
  let start: number | null = prev ? t0 : null
  for (let t = t0 + step; ; t += step) {
    const tt = Math.min(t, t1)
    const cur = test(tt)
    if (cur !== prev) {
      const at = edge(prevT, tt, prev)
      if (cur) start = at
      else if (start !== null) {
        out.push([start, at])
        start = null
      }
    }
    prevT = tt
    prev = cur
    if (tt >= t1) break
  }
  if (start !== null) out.push([start, t1])
  return out
}
