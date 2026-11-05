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

// ---- the collapse surface ----

/**
 * One connected region where the foam collapses, seen from the body at its
 * heart. A giant far enough from its star has a region of its own; one close
 * enough lies inside the star's region, which then bulges to take it in.
 * The surface is found along rays from the centre, so a region is assumed to
 * be star-shaped about it: each ray's crossing is the outermost one (a lee's
 * dent shows; a hole deep inside does not). That fails for bubbles side by
 * side: a ray from the star through a separate bubble reaches its far side.
 * For the true outline in a plane, use `collapseOutlines`.
 */
export interface CollapseRegion {
  /** Index of the body at its heart. */
  body: number
  center: Vec3
  /** How far out from the centre the region can reach (it takes in any body whose own region might touch it), m. */
  reach: number
  /** Distance along a unit direction from the centre to the surface, m. */
  radial(dir: Vec3): number
}

/**
 * The collapse regions of a set of bodies, biggest first. A body whose centre
 * lies inside a bigger body's region adds to that region and has none of its
 * own. Bodies too small to matter (collapse radius under `minRadius`) are
 * never centres, though their tides still count.
 */
export function collapseRegions(
  bodies: readonly MassPoint[],
  s: Pick<FoamSettings, 'collapseRadius' | 'rule'>,
  opts: { minRadius?: number; steps?: number } = {}
): CollapseRegion[] {
  const own = bodies.map((b) => collapseRadius(b.mass, s))
  const order = bodies.map((_, i) => i).sort((a, b) => bodies[b].mass - bodies[a].mass || a - b)
  const steps = opts.steps ?? 240
  const regions: CollapseRegion[] = []
  const inside = (r: CollapseRegion, p: Vec3): boolean => {
    const d: Vec3 = [p[0] - r.center[0], p[1] - r.center[1], p[2] - r.center[2]]
    const n = Math.hypot(d[0], d[1], d[2])
    return n === 0 || n < r.radial([d[0] / n, d[1] / n, d[2] / n])
  }
  for (const i of order) {
    if (own[i] < (opts.minRadius ?? 0)) continue
    const c = bodies[i].pos
    if (regions.some((r) => inside(r, c))) continue
    // How far out to look: the body's own radius, stretched to take in any body whose region might touch it.
    let reach = 1.6 * own[i]
    for (let changed = true; changed;) {
      changed = false
      bodies.forEach((b, j) => {
        if (j === i) return
        const d = Math.hypot(b.pos[0] - c[0], b.pos[1] - c[1], b.pos[2] - c[2])
        const far = d + 1.6 * own[j]
        if (d - 1.6 * own[j] < reach && far > reach) {
          reach = far
          changed = true
        }
      })
    }
    const cache = new Map<string, number>()
    regions.push({
      body: i,
      center: c,
      reach,
      radial(dir) {
        const key = `${dir[0].toFixed(6)},${dir[1].toFixed(6)},${dir[2].toFixed(6)}`
        const hit = cache.get(key)
        if (hit !== undefined) return hit
        const s0 = firstCollapseAlong(c, dir, bodies, s, reach, 0, reach / steps)
        const r = s0 ?? 0
        cache.set(key, r)
        return r
      }
    })
  }
  return regions
}

/** The region's surface as a mesh: `lat` × `lon` vertices on rays from its centre, and the triangles between them. */
export function collapseMesh(r: CollapseRegion, lat = 24, lon = 48): { vertices: Vec3[]; triangles: [number, number, number][] } {
  const vertices: Vec3[] = []
  for (let a = 0; a <= lat; a++) {
    const th = (Math.PI * a) / lat
    for (let b = 0; b < lon; b++) {
      const ph = (2 * Math.PI * b) / lon
      const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]
      const k = r.radial(d)
      vertices.push([r.center[0] + d[0] * k, r.center[1] + d[1] * k, r.center[2] + d[2] * k])
    }
  }
  const triangles: [number, number, number][] = []
  for (let a = 0; a < lat; a++)
    for (let b = 0; b < lon; b++) {
      const p = a * lon + b
      const q = a * lon + ((b + 1) % lon)
      triangles.push([p, p + lon, q], [q, p + lon, q + lon])
    }
  return { vertices, triangles }
}

/**
 * The region's outline in a plane through `origin` spanned by unit vectors
 * `u` and `v` (the system plane: origin at the star, u = x, v = y): the
 * slice of its surface, as points in that plane. Empty when the plane misses
 * the region.
 */
export function collapseSlice(
  r: CollapseRegion,
  s: Pick<FoamSettings, 'collapseRadius' | 'rule'>,
  bodies: readonly MassPoint[],
  u: Vec3,
  v: Vec3,
  n = 180
): Vec3[] {
  // Rays go out within the plane from the centre's foot in it.
  const nrm: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const off = r.center[0] * nrm[0] + r.center[1] * nrm[1] + r.center[2] * nrm[2]
  const foot: Vec3 = [r.center[0] - nrm[0] * off, r.center[1] - nrm[1] * off, r.center[2] - nrm[2] * off]
  if (foamLoad(foot, bodies, s) < 1) return []
  // Within the region's own reach, so a separate region beyond it is not mistaken for this one's edge.
  const reach = r.reach + Math.abs(off)
  const out: Vec3[] = []
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n
    const d: Vec3 = [
      u[0] * Math.cos(a) + v[0] * Math.sin(a),
      u[1] * Math.cos(a) + v[1] * Math.sin(a),
      u[2] * Math.cos(a) + v[2] * Math.sin(a)
    ]
    const t = firstCollapseAlong(foot, d, bodies, s, reach, 0, reach / 300) ?? 0
    out.push([foot[0] + d[0] * t, foot[1] + d[1] * t, foot[2] + d[2] * t])
  }
  return out
}

/** One connected collapse area in a plane: its outer boundary and any holes in it (lees). */
export interface CollapseOutline {
  /** Index of the most massive body inside it. */
  body: number
  /** The body's foot in the plane. */
  center: Vec3
  /** Closed loops in the plane: the outer boundary first, then holes. */
  loops: Vec3[][]
}

/**
 * Where the foam collapses in a plane through `origin` spanned by unit
 * vectors `u` and `v`: the contour where the load is 1, traced as it is.
 *
 * This is the exact slice of the 3D collapse surface, whatever its shape: two
 * bubbles stay apart until the load between them reaches 1, then join through
 * a smooth neck; a lee shows as a dent or a hole. For each body big enough
 * to matter (own collapse radius at least `minRadius`), biggest first, the
 * load is sampled on a grid around it (wide enough to take in any body whose
 * collapse could touch it) and contoured by marching squares on the log of
 * the load. A body inside an area already traced has none of its own.
 */
export function collapseOutlines(
  bodies: readonly MassPoint[],
  s: Pick<FoamSettings, 'collapseRadius' | 'rule'>,
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  opts: { minRadius?: number; grid?: number } = {}
): CollapseOutline[] {
  const n = Math.max(16, Math.round(opts.grid ?? 160))
  const nrm: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const to2 = (p: Vec3): [number, number] => {
    const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]]
  }
  const to3 = (x: number, y: number): Vec3 => [
    origin[0] + x * u[0] + y * v[0],
    origin[1] + x * u[1] + y * v[1],
    origin[2] + x * u[2] + y * v[2]
  ]
  const own = bodies.map((b) => collapseRadius(b.mass, s))
  const order = bodies.map((_, i) => i).sort((a, b) => bodies[b].mass - bodies[a].mass || a - b)
  const out: CollapseOutline[] = []
  const flat = bodies.map((b) => to2(b.pos))
  // Where the foam collapses, within a sum-of-loads bound: |T₁ + T₂| ≤ |T₁| + |T₂|, so a point in collapse has
  // some body's own load ≥ 1/N there; 1.6 × own radius covers any pair (2^(1/3) ≈ 1.26) with room to spare.
  for (const i of order) {
    if (own[i] < (opts.minRadius ?? 0)) continue
    const [cx, cy] = flat[i]
    const off = (bodies[i].pos[0] - origin[0]) * nrm[0] + (bodies[i].pos[1] - origin[1]) * nrm[1] + (bodies[i].pos[2] - origin[2]) * nrm[2]
    if (Math.abs(off) >= 1.6 * own[i]) continue
    if (out.some((o) => pointInLoop([cx, cy], o.loops[0].map(to2)) && !o.loops.slice(1).some((h) => pointInLoop([cx, cy], h.map(to2)))))
      continue
    let reach = 1.6 * own[i]
    for (let changed = true; changed;) {
      changed = false
      bodies.forEach((_, j) => {
        if (j === i) return
        const d = Math.hypot(flat[j][0] - cx, flat[j][1] - cy)
        const far = d + 1.6 * own[j]
        if (d - 1.6 * own[j] < reach && far > reach) {
          reach = far
          changed = true
        }
      })
    }
    // log load on an (n+1)² grid over the square of half-width `reach` about the body.
    const h = (2 * reach) / n
    const f = new Float64Array((n + 1) * (n + 1))
    for (let a = 0; a <= n; a++)
      for (let b = 0; b <= n; b++) {
        const L = foamLoad(to3(cx - reach + b * h, cy - reach + a * h), bodies, s)
        // On a body itself the load is unbounded (NaN from 0/0): inside.
        f[a * (n + 1) + b] = Number.isNaN(L) || L === Infinity ? 700 : L > 0 ? Math.log(L) : -700
      }
    const loops = marchingSquares(f, n, cx - reach, cy - reach, h)
    const outer = loops.filter((l) => pointInLoop([cx, cy], l)).sort((p, q) => Math.abs(loopArea(p)) - Math.abs(loopArea(q)))[0]
    if (!outer) continue
    const holes = loops.filter((l) => l !== outer && !pointInLoop([cx, cy], l) && pointInLoop(l[0], outer))
    out.push({ body: i, center: to3(cx, cy), loops: [outer, ...holes].map((l) => l.map(([x, y]) => to3(x, y))) })
  }
  return out
}

function pointInLoop(p: readonly [number, number] | readonly number[], loop: readonly (readonly number[])[]): boolean {
  let inside = false
  for (let k = 0, j = loop.length - 1; k < loop.length; j = k++) {
    const [xi, yi] = loop[k]
    const [xj, yj] = loop[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function loopArea(loop: readonly (readonly number[])[]): number {
  let a = 0
  for (let k = 0, j = loop.length - 1; k < loop.length; j = k++) a += loop[j][0] * loop[k][1] - loop[k][0] * loop[j][1]
  return a / 2
}

/**
 * The closed contours where `f` (on an (n+1)² grid, row a at y0 + a·h, column
 * b at x0 + b·h) crosses 0, with crossings placed by linear interpolation.
 * Lines that run off the grid are returned open (read as closed by a straight edge).
 */
function marchingSquares(f: Float64Array, n: number, x0: number, y0: number, h: number): [number, number][][] {
  const W = n + 1
  const val = (a: number, b: number): number => f[a * W + b]
  // A crossing point on an edge, keyed so neighbouring cells share it: horizontal edges "h:a:b", vertical "v:a:b".
  const pts = new Map<string, [number, number]>()
  const point = (key: string, a0: number, b0: number, a1: number, b1: number): string => {
    if (!pts.has(key)) {
      const p = val(a0, b0)
      const q = val(a1, b1)
      const t = p === q ? 0.5 : Math.max(0, Math.min(1, p / (p - q)))
      pts.set(key, [x0 + (b0 + (b1 - b0) * t) * h, y0 + (a0 + (a1 - a0) * t) * h])
    }
    return key
  }
  const next = new Map<string, string[]>()
  const link = (p: string, q: string): void => {
    next.set(p, [...(next.get(p) ?? []), q])
    next.set(q, [...(next.get(q) ?? []), p])
  }
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      // Corners: 0 (a,b), 1 (a,b+1), 2 (a+1,b+1), 3 (a+1,b); inside where f ≥ 0.
      const c = [val(a, b) >= 0, val(a, b + 1) >= 0, val(a + 1, b + 1) >= 0, val(a + 1, b) >= 0]
      const idx = (c[0] ? 1 : 0) | (c[1] ? 2 : 0) | (c[2] ? 4 : 0) | (c[3] ? 8 : 0)
      if (idx === 0 || idx === 15) continue
      const e = [
        () => point(`h:${a}:${b}`, a, b, a, b + 1),
        () => point(`v:${a}:${b + 1}`, a, b + 1, a + 1, b + 1),
        () => point(`h:${a + 1}:${b}`, a + 1, b, a + 1, b + 1),
        () => point(`v:${a}:${b}`, a, b, a + 1, b)
      ]
      const centre = (val(a, b) + val(a, b + 1) + val(a + 1, b + 1) + val(a + 1, b)) / 4 >= 0
      const pairs: [number, number][] =
        idx === 5
          ? centre
            ? [
                [0, 1],
                [2, 3]
              ]
            : [
                [0, 3],
                [1, 2]
              ]
          : idx === 10
            ? centre
              ? [
                  [0, 3],
                  [1, 2]
                ]
              : [
                  [0, 1],
                  [2, 3]
                ]
            : [CASES[idx]]
      for (const [p, q] of pairs) link(e[p](), e[q]())
    }
  // Chain the segments into loops (or open lines at the grid's edge).
  const used = new Set<string>()
  const lines: [number, number][][] = []
  const walk = (start: string): string[] => {
    const line = [start]
    used.add(start)
    for (let cur = start; ;) {
      const nx = (next.get(cur) ?? []).find((k) => !used.has(k))
      if (nx === undefined) break
      used.add(nx)
      line.push(nx)
      cur = nx
    }
    return line
  }
  // Open lines first (ends have one neighbour), then closed loops.
  for (const k of next.keys()) if (!used.has(k) && next.get(k)!.length === 1) lines.push(walk(k).map((x) => pts.get(x)!))
  for (const k of next.keys()) if (!used.has(k)) lines.push(walk(k).map((x) => pts.get(x)!))
  return lines.filter((l) => l.length >= 3)
}

/** Marching-squares edge pairs for the single-segment cases (edges 0 top, 1 right, 2 bottom, 3 left). */
const CASES: Record<number, [number, number]> = {
  1: [3, 0],
  2: [0, 1],
  3: [3, 1],
  4: [1, 2],
  6: [0, 2],
  7: [3, 2],
  8: [2, 3],
  9: [0, 2],
  11: [1, 2],
  12: [1, 3],
  13: [0, 1],
  14: [3, 0]
}
