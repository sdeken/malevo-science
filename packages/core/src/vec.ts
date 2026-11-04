/**
 * Vectors, matrices, quaternions and reference frames.
 *
 * Vec3 is a plain [x, y, z] tuple; Mat3 is row-major, 9 numbers. Functions
 * never mutate their arguments.
 *
 * Frames used across the app:
 * - galactic: x toward the galactic centre, y toward galactic rotation, z to
 *   the north galactic pole (the star map's frame; Sol at the origin).
 * - equatorial: ICRS/J2000 (x toward the March equinox, z to the north
 *   celestial pole).
 * - ecliptic: J2000 mean ecliptic.
 * - a planet's body-fixed frame: z along its rotation pole, x through its
 *   prime meridian.
 */
import { DEG } from './units'

export type Vec3 = readonly [number, number, number]
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]
/** Unit quaternion [w, x, y, z]. */
export type Quat = readonly [number, number, number, number]

export const vec = (x: number, y: number, z: number): Vec3 => [x, y, z]
export const ZERO: Vec3 = [0, 0, 0]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  if (n === 0) throw new Error('normalize() of a zero vector')
  return [a[0] / n, a[1] / n, a[2] / n]
}

/** Angle between two vectors, radians, numerically stable at 0 and π. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(norm(cross(a, b)), dot(a, b))
}

// ---- matrices ----

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return out as unknown as Mat3
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

/** Rotation matrices that rotate *vectors* by `angle` (right-handed, counterclockwise looking down the axis). */
export function rotX(angle: number): Mat3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}
export function rotY(angle: number): Mat3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}
export function rotZ(angle: number): Mat3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

// ---- quaternions ----

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = normalize(axis)
  const s = Math.sin(angle / 2)
  return [Math.cos(angle / 2), x * s, y * s, z * s]
}

export function mulQuat(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ]
}

export function quatToMat(q: Quat): Mat3 {
  const [w, x, y, z] = q
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y)
  ]
}

export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  return mulVec(quatToMat(q), v)
}

// ---- spherical coordinates ----

/** Unit vector from longitude/latitude (or RA/Dec), radians. */
export function fromSpherical(lon: number, lat: number): Vec3 {
  const cl = Math.cos(lat)
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)]
}

/** Longitude in [0, 2π) and latitude in [−π/2, π/2] of any non-zero vector. */
export function toSpherical(v: Vec3): { lon: number; lat: number; r: number } {
  const r = norm(v)
  let lon = Math.atan2(v[1], v[0])
  if (lon < 0) lon += 2 * Math.PI
  return { lon, lat: Math.asin(Math.max(-1, Math.min(1, v[2] / r))), r }
}

// ---- standard frames ----

/** J2000 mean obliquity of the ecliptic (IAU 2006), radians. */
export const OBLIQUITY_J2000 = 84381.406 * (DEG / 3600)

/** Equatorial (ICRS) → galactic rotation (Hipparcos, ESA 1997 vol. 1 §1.5.3). */
export const EQUATORIAL_TO_GALACTIC: Mat3 = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132, 0.4941094278755837, -0.4448296299600112, 0.746982244497219,
  -0.8676661490190047, -0.1980763734312015, 0.4559837761750669
]
export const GALACTIC_TO_EQUATORIAL: Mat3 = transpose(EQUATORIAL_TO_GALACTIC)
export const ECLIPTIC_TO_EQUATORIAL: Mat3 = rotX(OBLIQUITY_J2000)
export const EQUATORIAL_TO_ECLIPTIC: Mat3 = transpose(ECLIPTIC_TO_EQUATORIAL)

/** Unit vector toward RA/Dec (radians) in the galactic frame. */
export function galacticFromRaDec(ra: number, dec: number): Vec3 {
  return mulVec(EQUATORIAL_TO_GALACTIC, fromSpherical(ra, dec))
}

/**
 * The rotation from a parent frame into a body-fixed frame, for a body whose
 * north pole points along `pole` (unit vector in the parent frame) and whose
 * prime meridian has rotated by `w` radians from the ascending node of its
 * equator on the parent's xy-plane (the IAU W angle).
 * Multiply a parent-frame vector by the result to get body-fixed coordinates.
 */
export function bodyFixedFrame(pole: Vec3, w: number): Mat3 {
  const { lon: ra, lat: dec } = toSpherical(pole)
  // IAU convention: R = Rz(W) · Rx(90° − δ) · Rz(90° + α), applied as frame rotations (transposes of vector rotations).
  return mulMat(transpose(rotZ(w)), mulMat(transpose(rotX(Math.PI / 2 - dec)), transpose(rotZ(Math.PI / 2 + ra))))
}
