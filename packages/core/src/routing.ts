/**
 * Galactic routing: legs between stars under the leg limit, kept clear of
 * nebulae, found with A* (the prototype star map's route search, moved here
 * and made independent of any one map). Positions are light-years.
 */
import { compareStrings } from './strings'

export type Point3 = readonly [number, number, number]

/** An axis-aligned ellipsoid the foam cannot cross (a nebula). */
export interface Ellipsoid {
  center: Point3
  radii: Point3
}

/** Does the segment p→q pass through the ellipsoid? (Scale to a unit sphere, then a segment–sphere test; the prototype's.) */
export function segmentHitsEllipsoid(p: Point3, q: Point3, n: Ellipsoid): boolean {
  const [rx, ry, rz] = n.radii
  const a = [(p[0] - n.center[0]) / rx, (p[1] - n.center[1]) / ry, (p[2] - n.center[2]) / rz]
  const b = [(q[0] - n.center[0]) / rx, (q[1] - n.center[1]) / ry, (q[2] - n.center[2]) / rz]
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
  let t = dd ? -(a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) / dd : 0
  t = Math.max(0, Math.min(1, t))
  const c = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]
  return c[0] * c[0] + c[1] * c[1] + c[2] * c[2] < 1
}

export function insideEllipsoid(p: Point3, n: Ellipsoid): boolean {
  return ((p[0] - n.center[0]) / n.radii[0]) ** 2 + ((p[1] - n.center[1]) / n.radii[1]) ** 2 + ((p[2] - n.center[2]) / n.radii[2]) ** 2 < 1
}

export const lightYears = (a: Point3, b: Point3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export interface RouteNode {
  id: string
  pos: Point3
}

export interface PathOptions {
  /** Longest single leg, ly. */
  legLimit: number
  /** Cost of a leg of this many light-years (e.g. hours in the foam). */
  legCost(ly: number): number
  /** Cost of stopping at an intermediate node (e.g. the stopover). */
  stopCost(node: RouteNode): number
  /** Lower bound on the cost of covering this many light-years (for A*); legCost itself if it is monotone and stops cost ≥ 0. */
  heuristic?(ly: number): number
  nebulae?: readonly Ellipsoid[]
  /** Give up after visiting this many nodes. */
  maxVisits?: number
}

export interface FoundPath {
  /** Node ids from start to goal. */
  ids: string[]
  legs: { from: string; to: string; ly: number }[]
  cost: number
}

/**
 * The cheapest chain of legs from `from` to `to` through `nodes`, every leg
 * within the leg limit and clear of nebulae; null if there is none. Ties are
 * broken by node id, so the answer never depends on input order.
 */
export function findPath(nodes: readonly RouteNode[], from: string, to: string, o: PathOptions): FoundPath | null {
  const sorted = [...nodes].sort((a, b) => compareStrings(a.id, b.id))
  const index = new Map(sorted.map((n, i) => [n.id, i]))
  const start = index.get(from)
  const goal = index.get(to)
  if (start === undefined || goal === undefined) return null
  const L = o.legLimit
  // Grid with cells the size of the leg limit.
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`
  sorted.forEach((n, i) => {
    const k = key(Math.floor(n.pos[0] / L), Math.floor(n.pos[1] / L), Math.floor(n.pos[2] / L))
    let cell = grid.get(k)
    if (!cell) grid.set(k, (cell = []))
    cell.push(i)
  })
  const h = (i: number): number => (o.heuristic ?? o.legCost)(lightYears(sorted[i].pos, sorted[goal].pos))
  const g = new Float64Array(sorted.length).fill(Infinity)
  const prev = new Int32Array(sorted.length).fill(-1)
  const done = new Uint8Array(sorted.length)
  // Binary heap of [f, tie-break index].
  const heap: [number, number][] = []
  const push = (f: number, i: number): void => {
    heap.push([f, i])
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heap[p][0] < heap[k][0] || (heap[p][0] === heap[k][0] && heap[p][1] <= heap[k][1])) break
      ;[heap[p], heap[k]] = [heap[k], heap[p]]
      k = p
    }
  }
  const pop = (): [number, number] => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        const less = (x: number, y: number): boolean => heap[x][0] < heap[y][0] || (heap[x][0] === heap[y][0] && heap[x][1] < heap[y][1])
        if (l < heap.length && less(l, m)) m = l
        if (r < heap.length && less(r, m)) m = r
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]
        k = m
      }
    }
    return top
  }
  g[start] = 0
  push(h(start), start)
  let visits = 0
  const max = o.maxVisits ?? 500_000
  while (heap.length) {
    const [, i] = pop()
    if (done[i]) continue
    done[i] = 1
    if (i === goal || ++visits > max) break
    const a = sorted[i].pos
    const cx = Math.floor(a[0] / L)
    const cy = Math.floor(a[1] / L)
    const cz = Math.floor(a[2] / L)
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++) {
          for (const j of grid.get(key(x, y, z)) ?? []) {
            if (done[j] || j === i) continue
            const b = sorted[j].pos
            const d = lightYears(a, b)
            if (d > L) continue
            if (o.nebulae?.some((n) => segmentHitsEllipsoid(a, b, n))) continue
            const cost = g[i] + o.legCost(d) + (j === goal ? 0 : o.stopCost(sorted[j]))
            if (cost < g[j]) {
              g[j] = cost
              prev[j] = i
              push(cost + h(j), j)
            }
          }
        }
  }
  if (!Number.isFinite(g[goal])) return null
  const path: number[] = []
  for (let i = goal; i !== -1; i = prev[i]) path.unshift(i)
  const legs = path
    .slice(1)
    .map((j, k) => ({ from: sorted[path[k]].id, to: sorted[j].id, ly: lightYears(sorted[path[k]].pos, sorted[j].pos) }))
  return { ids: path.map((i) => sorted[i].id), legs, cost: g[goal] }
}
