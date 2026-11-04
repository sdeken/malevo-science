/**
 * The foam drive's collapse rule, ported from the prototype lee-planner.
 *
 * The foam fails where the local tidal curvature is too steep. The load at a
 * point is a norm of the tidal tensor summed over every body, scaled so that
 * a load of 1 sits exactly at the world's collapse radius for one solar mass.
 * A single body's collapse radius therefore grows as the cube root of its
 * mass. Which norm counts is a world setting:
 *
 * - 'max-eigen': the strongest stretch (largest eigenvalue magnitude, halved)
 * - 'rss': the overall magnitude (root of the summed squares, over √6)
 *
 * Both give the same answer for a single body; they differ where two bodies'
 * tides partly cancel (a giant planet's "lee").
 *
 * Every number that describes a particular setting (the collapse radius, the
 * top speed, the leg limit) is a world setting passed in, never a constant here.
 */
import { M_SUN } from './units'
import { type Vec3 } from './vec'

export type LoadRule = 'max-eigen' | 'rss'

export interface FoamSettings {
  /** Collapse radius around one solar mass, m. */
  collapseRadius: number
  rule: LoadRule
  /** Top speed through the foam with no artificial gravity, m/s. */
  topSpeed: number
  /** Longest single leg, m. */
  legLimit: number
  /** Artificial gravity at which the top speed falls to zero, m/s². */
  gravityLimit: number
}

export interface MassPoint {
  /** Position, m, in any common frame. */
  pos: Vec3
  /** Mass, kg. */
  mass: number
}

/** Collapse radius around a single body of the given mass. */
export function collapseRadius(mass: number, s: Pick<FoamSettings, 'collapseRadius'>): number {
  return s.collapseRadius * Math.cbrt(mass / M_SUN)
}

/** The tidal tensor's six independent components [xx, yy, zz, xy, xz, yz], in units of mass/length³. */
export function tidalTensor(point: Vec3, bodies: readonly MassPoint[]): number[] {
  const T = [0, 0, 0, 0, 0, 0]
  for (const b of bodies) {
    const dx = point[0] - b.pos[0]
    const dy = point[1] - b.pos[1]
    const dz = point[2] - b.pos[2]
    const r2 = dx * dx + dy * dy + dz * dz
    const r = Math.sqrt(r2)
    const k = b.mass / (r2 * r)
    const nx = dx / r
    const ny = dy / r
    const nz = dz / r
    T[0] += k * (3 * nx * nx - 1)
    T[1] += k * (3 * ny * ny - 1)
    T[2] += k * (3 * nz * nz - 1)
    T[3] += 3 * k * nx * ny
    T[4] += 3 * k * nx * nz
    T[5] += 3 * k * ny * nz
  }
  return T
}

/** The norm of a tidal tensor under a load rule (lee-planner's loadAt, unscaled). */
export function tensorNorm(T: readonly number[], rule: LoadRule): number {
  const [a, b, c, d, e, f] = T
  const p2 = a * a + b * b + c * c + 2 * (d * d + e * e + f * f)
  if (rule === 'rss') return Math.sqrt(p2 / 6)
  const p = Math.sqrt(p2 / 6)
  if (p < 1e-300) return 0
  // Eigenvalues of a symmetric, traceless 3×3 matrix (trigonometric solution).
  const A11 = a / p
  const A22 = b / p
  const A33 = c / p
  const A12 = d / p
  const A13 = e / p
  const A23 = f / p
  let r = (A11 * (A22 * A33 - A23 * A23) - A12 * (A12 * A33 - A23 * A13) + A13 * (A12 * A23 - A22 * A13)) / 2
  r = Math.max(-1, Math.min(1, r))
  const ph = Math.acos(r) / 3
  const l1 = 2 * p * Math.cos(ph)
  const l3 = 2 * p * Math.cos(ph + (2 * Math.PI) / 3)
  const l2 = -l1 - l3
  return Math.max(Math.abs(l1), Math.abs(l2), Math.abs(l3)) / 2
}

/** Foam load at a point: 1 means the foam collapses there. */
export function foamLoad(point: Vec3, bodies: readonly MassPoint[], s: Pick<FoamSettings, 'collapseRadius' | 'rule'>): number {
  return (tensorNorm(tidalTensor(point, bodies), s.rule) * s.collapseRadius ** 3) / M_SUN
}

/**
 * Where a ship first collapses on the line `origin + s·dir` (dir a unit
 * vector), travelling toward decreasing s: it comes in from `sFrom` and is
 * scanned toward `sTo` in steps of `step`, then the edge is bisected to
 * within `tolerance`. Returns the s of the collapse (on the side the ship came
 * from), or null if the foam holds the whole way. (The prototype's sNat,
 * generalized.)
 */
export function firstCollapseAlong(
  origin: Vec3,
  dir: Vec3,
  bodies: readonly MassPoint[],
  s: Pick<FoamSettings, 'collapseRadius' | 'rule'>,
  sFrom: number,
  sTo: number,
  step: number,
  tolerance = step / 8192
): number | null {
  const load = (x: number): number => foamLoad([origin[0] + x * dir[0], origin[1] + x * dir[1], origin[2] + x * dir[2]], bodies, s)
  for (let x = sFrom; x > sTo; x -= step) {
    if (load(x) >= 1) {
      let hi = x + step
      let lo = x
      while (hi - lo > tolerance) {
        const m = (hi + lo) / 2
        if (load(m) >= 1) lo = m
        else hi = m
      }
      return hi
    }
  }
  return null
}

/** Top speed with artificial gravity g: the push and the tilt share one budget. */
export function topSpeedWithGravity(s: Pick<FoamSettings, 'topSpeed' | 'gravityLimit'>, g: number): number {
  const f = g / s.gravityLimit
  return f >= 1 ? 0 : s.topSpeed * Math.sqrt(1 - f * f)
}

/** Legs needed to cover a distance under the leg limit. */
export function legsNeeded(distance: number, s: Pick<FoamSettings, 'legLimit'>): number {
  return Math.max(1, Math.ceil(distance / s.legLimit))
}

/** Time in the foam for a distance at a given artificial gravity. */
export function foamTime(distance: number, s: Pick<FoamSettings, 'topSpeed' | 'gravityLimit'>, g = 0): number {
  return distance / topSpeedWithGravity(s, g)
}
