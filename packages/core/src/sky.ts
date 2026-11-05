/**
 * Looking up from a body's surface (docs/PLAN.md §4 `sky`): the observer's
 * frame on a spinning, tilted body; altitude and azimuth; apparent magnitudes
 * of stars, of sunlit bodies and of torches; where a torch is along its crawl.
 * SI throughout; angles in radians unless a name says degrees.
 *
 * Conventions (each body's are world data, not constants):
 * - A body's north pole is tilted from its orbit's normal by its axial tilt,
 *   leaning so that its northern spring equinox falls when the body is at
 *   orbital longitude `equinox` (from the orbit's ascending node). After that
 *   equinox the north leans toward the star.
 * - Its prime meridian is at angle W from the equinox direction (in the
 *   equator), W = meridian + 2π·t/rotation. A tidally locked body keeps
 *   longitude 0 facing what it orbits.
 */
import { AU, DAY, PC, L_SUN } from './units'
import { cross, dot, normalize, scale, sub, type Vec3 } from './vec'
import type { OrbitalElements } from './orbit'

// ---- orientation ----

/** The orbit's normal and the unit direction of orbital longitude λ (from the ascending node), in the parent's frame. */
export function orbitDirections(el: Pick<OrbitalElements, 'i' | 'node'>, lambda: number): { normal: Vec3; dir: Vec3 } {
  const N: Vec3 = [Math.cos(el.node), Math.sin(el.node), 0]
  const normal: Vec3 = [Math.sin(el.i) * Math.sin(el.node), -Math.sin(el.i) * Math.cos(el.node), Math.cos(el.i)]
  const M = cross(normal, N)
  return {
    normal,
    dir: normalize([
      N[0] * Math.cos(lambda) + M[0] * Math.sin(lambda),
      N[1] * Math.cos(lambda) + M[1] * Math.sin(lambda),
      N[2] * Math.cos(lambda) + M[2] * Math.sin(lambda)
    ])
  }
}

export interface Spin {
  /** North pole, unit vector. */
  pole: Vec3
  /** The equinox direction: in the equator, the reference for longitudes. */
  ref: Vec3
}

/** A body's spin axis from its orbit, tilt and equinox longitude. */
export function spinAxis(el: Pick<OrbitalElements, 'i' | 'node'>, tilt: number, equinox: number): Spin {
  const { normal, dir: e } = orbitDirections(el, equinox)
  const f = cross(normal, e)
  const pole = normalize([
    normal[0] * Math.cos(tilt) - f[0] * Math.sin(tilt),
    normal[1] * Math.cos(tilt) - f[1] * Math.sin(tilt),
    normal[2] * Math.cos(tilt) - f[2] * Math.sin(tilt)
  ])
  return { pole, ref: e }
}

/** The prime meridian's direction (unit, in the equator) at rotation angle W. */
export function meridianAt(spin: Spin, W: number): Vec3 {
  const e1 = normalize(sub(spin.ref, scale(spin.pole, dot(spin.ref, spin.pole))))
  const e2 = cross(spin.pole, e1)
  return [e1[0] * Math.cos(W) + e2[0] * Math.sin(W), e1[1] * Math.cos(W) + e2[1] * Math.sin(W), e1[2] * Math.cos(W) + e2[2] * Math.sin(W)]
}

/** The meridian of a tidally locked body: longitude 0 faces what it orbits (`toParent`, from the body). */
export function lockedMeridian(spin: Spin, toParent: Vec3): Vec3 {
  return normalize(sub(toParent, scale(spin.pole, dot(toParent, spin.pole))))
}

export interface LocalFrame {
  up: Vec3
  north: Vec3
  east: Vec3
}

/** The local frame at latitude `lat`, east longitude `lon`, on a body with this pole and prime meridian. */
export function localFrame(pole: Vec3, meridian: Vec3, lat: number, lon: number): LocalFrame {
  const q = cross(pole, meridian)
  const eq: Vec3 = [
    meridian[0] * Math.cos(lon) + q[0] * Math.sin(lon),
    meridian[1] * Math.cos(lon) + q[1] * Math.sin(lon),
    meridian[2] * Math.cos(lon) + q[2] * Math.sin(lon)
  ]
  const up: Vec3 = [
    eq[0] * Math.cos(lat) + pole[0] * Math.sin(lat),
    eq[1] * Math.cos(lat) + pole[1] * Math.sin(lat),
    eq[2] * Math.cos(lat) + pole[2] * Math.sin(lat)
  ]
  const east = cross(pole, eq)
  const north = cross(up, east)
  return { up, north, east }
}

/** A direction in the local frame: x east, y north, z up. */
export function toLocal(f: LocalFrame, d: Vec3): Vec3 {
  return [dot(d, f.east), dot(d, f.north), dot(d, f.up)]
}

export function altAz(local: Vec3): { alt: number; az: number } {
  return { alt: Math.asin(Math.max(-1, Math.min(1, local[2]))), az: (Math.atan2(local[0], local[1]) + 2 * Math.PI) % (2 * Math.PI) }
}

/** Atmospheric refraction, radians to add to the true altitude (Bennett/Sæmundsson, for Earth's air; scaled by the column). */
export function refraction(alt: number, column = 1): number {
  const h = Math.max(alt / (Math.PI / 180), -1.5)
  const arcmin = 1.02 / Math.tan(((h + 10.3 / (h + 5.11)) * Math.PI) / 180)
  return (Math.max(0, arcmin) / 60) * (Math.PI / 180) * column
}

// ---- brightness ----

/** A star's apparent magnitude from its absolute magnitude, at a distance in metres. */
export function starMagnitudeAt(absmag: number, distance: number): number {
  return absmag + 5 * Math.log10(distance / PC) - 5
}

/** Lambert sphere phase function at phase angle α (1 when full). */
export function lambertPhase(alpha: number): number {
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI
}

/**
 * Apparent magnitude of a sunlit body: the star's magnitude as seen from the
 * body, dimmed by the body's size, albedo, distance and phase. A Lambert
 * sphere's geometric albedo is ⅔ of its Bond albedo.
 */
export function reflectedMagnitude(
  starMagAtBody: number,
  radius: number,
  bondAlbedo: number,
  distance: number,
  phaseAngle: number
): number {
  const phi = lambertPhase(phaseAngle)
  if (phi <= 1e-9) return Infinity
  const p = (2 / 3) * bondAlbedo
  return starMagAtBody - 2.5 * Math.log10(p * (radius / distance) ** 2 * phi)
}

/** Apparent magnitude of a source of visible power L, W, at distance d, m. */
export function pointMagnitude(L: number, d: number): number {
  return -26.74 - 2.5 * Math.log10(L / L_SUN) + 5 * Math.log10(d / AU)
}

export interface TorchLight {
  /** Ship mass, kg. */
  mass: number
  /** Acceleration, m/s². */
  accel: number
  exhaustSpeed: number
  /** Fraction of the jet's power radiated as visible light. */
  visibleFraction: number
  /** Brightness seen from ahead of the ship (the exhaust pointing away), relative to from behind. */
  frontFactor: number
}

/**
 * Visible power of a torch, W, seen from a direction. `facing` is the cosine
 * between the exhaust's direction and the direction to the observer: the
 * plume seen from behind is full brightness, from ahead the front factor.
 */
export function torchLuminosity(t: TorchLight, facing: number): number {
  const P = 0.5 * t.mass * t.accel * t.exhaustSpeed * t.visibleFraction
  return P * (facing > 0 ? 1 : t.frontFactor)
}

// ---- torches along a crawl ----

/**
 * Distance covered τ seconds into a crawl of length L at acceleration a.
 * Inbound ships flip and brake at the midpoint; outbound ships burn all the
 * way. Also whether the ship is still accelerating (its exhaust trails
 * behind it, toward where it came from).
 */
export function crawlProgress(kind: 'in' | 'out', tau: number, L: number, a: number): { s: number; accelerating: boolean } {
  if (kind === 'out') return { s: Math.min(L, 0.5 * a * tau * tau), accelerating: true }
  const T = 2 * Math.sqrt(L / a)
  if (tau <= T / 2) return { s: 0.5 * a * tau * tau, accelerating: true }
  const r = Math.max(0, T - tau)
  return { s: L - 0.5 * a * r * r, accelerating: false }
}

/**
 * Ships of a steady flow (`perDay`) that are part way through a stage lasting
 * `duration` s, at instant t: one every 1/λ, offset by `phase` (0–1) so that
 * different flows do not march in step. Returns each ship's time into the
 * stage. On average there are λ·duration of them (Little's law); at any
 * instant, the whole number either side.
 */
export function shipsUnderway(perDay: number, duration: number, t: number, phase: number): number[] {
  if (perDay <= 0 || duration <= 0) return []
  const gap = DAY / perDay
  const first = (((t / gap - phase) % 1) + 1) % 1
  const out: number[] = []
  for (let k = 0; ; k++) {
    const tau = (first + k) * gap
    if (tau >= duration) break
    out.push(tau)
  }
  return out
}
