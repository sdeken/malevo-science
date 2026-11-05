/**
 * Working on the surface of a sphere: latitude/longitude, even point sets,
 * great-circle distances, polygons and strokes in latitude/longitude (the
 * form hand shaping is stored in), gradient noise in 3D for terrain, and how
 * sunlight falls with latitude over a year. Angles in radians unless a name
 * says degrees; points on the unit sphere.
 */
import type { Random } from './rng'
import type { Vec3 } from './vec'

export const fromLatLon = (lat: number, lon: number): Vec3 => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]

export function toLatLon(p: Vec3): { lat: number; lon: number } {
  const n = Math.hypot(p[0], p[1], p[2])
  return { lat: Math.asin(Math.max(-1, Math.min(1, p[2] / n))), lon: Math.atan2(p[1], p[0]) }
}

/** Great-circle angle between two unit vectors. */
export function arc(a: Vec3, b: Vec3): number {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
}

/** `n` points spread evenly over the unit sphere (a Fibonacci lattice): the same for every caller. */
export function fibonacciSphere(n: number): Vec3[] {
  const out: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - z * z)
    out.push([r * Math.cos(golden * i), r * Math.sin(golden * i), z])
  }
  return out
}

/** A random point on the unit sphere. */
export function randomOnSphere(r: Random): Vec3 {
  const z = 2 * r() - 1
  const t = 2 * Math.PI * r()
  const s = Math.sqrt(1 - z * z)
  return [s * Math.cos(t), s * Math.sin(t), z]
}

/** Angle from p to the great-circle segment a–b. */
export function arcToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const nn = Math.hypot(n[0], n[1], n[2])
  if (nn < 1e-12) return arc(p, a)
  const u: Vec3 = [n[0] / nn, n[1] / nn, n[2] / nn]
  const d = p[0] * u[0] + p[1] * u[1] + p[2] * u[2]
  // The foot of the perpendicular on the great circle, and whether it lies between a and b.
  const f: Vec3 = [p[0] - u[0] * d, p[1] - u[1] * d, p[2] - u[2] * d]
  const fl = Math.hypot(f[0], f[1], f[2])
  if (fl > 1e-12) {
    const q: Vec3 = [f[0] / fl, f[1] / fl, f[2] / fl]
    if (Math.abs(arc(a, q) + arc(q, b) - arc(a, b)) < 1e-9) return Math.abs(Math.asin(Math.max(-1, Math.min(1, d))))
  }
  return Math.min(arc(p, a), arc(p, b))
}

/**
 * Whether p lies inside a polygon whose vertices are unit vectors (edges are
 * great-circle arcs; the inside is the smaller side). Winding-angle test.
 */
export function insideSphericalPolygon(p: Vec3, poly: readonly Vec3[]): boolean {
  if (poly.length < 3) return false
  let total = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    // Signed angle at p between a and b, in the tangent plane at p.
    const ta = tangentTo(p, a)
    const tb = tangentTo(p, b)
    const cr = [ta[1] * tb[2] - ta[2] * tb[1], ta[2] * tb[0] - ta[0] * tb[2], ta[0] * tb[1] - ta[1] * tb[0]]
    const sign = cr[0] * p[0] + cr[1] * p[1] + cr[2] * p[2]
    total += Math.atan2(sign, ta[0] * tb[0] + ta[1] * tb[1] + ta[2] * tb[2])
  }
  return Math.abs(total) > Math.PI
}

function tangentTo(p: Vec3, q: Vec3): Vec3 {
  const d = p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  return [q[0] - p[0] * d, q[1] - p[1] * d, q[2] - p[2] * d]
}

// ---- gradient noise ----

/** Improved Perlin noise in 3D, its permutation drawn from a stream: about −1 to 1. */
export function perlin3(r: Random): (x: number, y: number, z: number) => number {
  const p = new Uint8Array(512)
  const base = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[base[i], base[j]] = [base[j], base[i]]
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (t: number, a: number, b: number): number => a + t * (b - a)
  const grad = (h: number, x: number, y: number, z: number): number => {
    const k = h & 15
    const u = k < 8 ? x : y
    const v = k < 4 ? y : k === 12 || k === 14 ? x : z
    return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v)
  }
  return (x, y, z) => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)
    const u = fade(x)
    const v = fade(y)
    const w = fade(z)
    const A = p[X] + Y
    const AA = p[A] + Z
    const AB = p[A + 1] + Z
    const B = p[X + 1] + Y
    const BA = p[B] + Z
    const BB = p[B + 1] + Z
    return lerp(
      w,
      lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)), lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
      lerp(
        v,
        lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))
      )
    )
  }
}

/** Fractal sum of noise octaves at a point (frequency doubles, amplitude scales by `gain`). About −1 to 1. */
export function fbm(noise: (x: number, y: number, z: number) => number, p: Vec3, octaves: number, frequency: number, gain = 0.5): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = frequency
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(p[0] * f + o * 17.3, p[1] * f - o * 9.1, p[2] * f + o * 3.7)
    norm += amp
    amp *= gain
    f *= 2
  }
  return sum / norm
}

// ---- sunlight by latitude ----

/**
 * Yearly mean sunlight at latitude `lat` on a body tilted `tilt` to its orbit,
 * relative to the body's global mean (1 on average over the sphere). For a
 * circular orbit.
 */
export function annualInsolationFactor(lat: number, tilt: number, steps = 48): number {
  let sum = 0
  for (let k = 0; k < steps; k++) {
    const L = (2 * Math.PI * (k + 0.5)) / steps
    const dec = Math.asin(Math.sin(tilt) * Math.sin(L))
    const x = -Math.tan(lat) * Math.tan(dec)
    const H = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x)
    // Daily mean, relative to S: (H sinφ sinδ + cosφ cosδ sin H) / π.
    sum += (H * Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.sin(H)) / Math.PI
  }
  // The global mean is S/4.
  return (sum / steps) * 4
}

/** Sunlight on a tidally locked body, relative to its global mean: by angle from the point under the star. */
export function lockedInsolationFactor(fromSubstellar: number): number {
  return Math.max(0, Math.cos(fromSubstellar)) * 4
}
