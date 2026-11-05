/**
 * cityplan@1: a city plan turned into geometry (boxes, ground, water, the
 * vertical faces where ground at different heights meets), ported from the
 * prototype bluff-planner's city-gen.js. Nothing in it is about one city: the
 * plan file says where everything is.
 *
 * - Ground areas are painted in order (a later one covers an earlier one);
 *   where two meet at different heights, the edge is a vertical face.
 * - Regions generate buildings by preset: `buildings` (blocks on a grid, with
 *   height profiles: random, flat, tiers, or a peak with the odd supertall),
 *   `cliff` (stacks bolted to the vertical faces, built up in terraces),
 *   `yards` (hulls in cradles, cranes, floodlights), `scatter` (houses and
 *   trees), `empty`.
 * - Lines are roads, rail and walls, with pillars under elevated decks and
 *   lamps along roads. Landmarks are boxes placed by hand.
 * - Every object draws from its own stream, keyed by the plan and the
 *   object's id, so editing one object never reshuffles another.
 *
 * Services (cars on a timetable) use @malevo/core's kinematics: `cityServices`
 * and `vehiclesAt` give every car's position at any time.
 */
import { legTime, mulberry32, runPlan, type Random, type RunPlan } from '@malevo/core'
import { defineGenerator, type GenContext } from './generator'

const D2R = Math.PI / 180
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

type XY = [number, number]
type Poly = XY[]

export interface PlanInput {
  /** The plan's id: part of every object's stream key. */
  planId: string
  seed?: number
  defaults: { groundZ: number; surface: string }
  ground?: { id: string; poly: Poly; z?: number; plane?: number[][]; surface?: string; hidden?: boolean }[]
  water?: { id: string; poly: Poly; z?: number; kind?: string; hidden?: boolean }[]
  lines?: PlanLine[]
  regions?: { id: string; preset: string; poly: Poly; params?: unknown; seed?: number; hidden?: boolean }[]
  buildings?: {
    id: string
    center: XY
    size: XY
    angle?: number
    z0?: number
    z1?: number
    h?: number
    colour?: number[]
    kind?: string
    clear?: boolean
    hidden?: boolean
  }[]
}

export interface PlanLine {
  id: string
  kind: string
  pts: number[][]
  width?: number
  mount?: string
  z?: number
  h?: number
  lamps?: boolean
  clear?: boolean
  hidden?: boolean
  service?: {
    headway_s?: number
    speed_ms?: number
    accel_ms2?: number
    dwell_s?: number
    stops?: unknown[]
    stopEvery_m?: number
    cars?: number
    carLength_m?: number
    tracks?: number
    phase_s?: number
    hours?: number[]
    colour?: number[]
  }
}

export interface Box {
  /** Footprint centre, half-width along `ang`, half-depth across it. */
  cx: number
  cy: number
  hw: number
  hd: number
  ang: number
  z0: number
  z1: number
  /** Colour, 0–1. */
  alb: number[]
  emit?: number[]
  kind: string
  /** The object that made it. */
  src: string
}

export interface Face {
  a: XY
  b: XY
  zLo: number
  zHi: number
  /** Unit normal pointing toward the low side. */
  n: XY
  src: string
}

export interface PlanOutput {
  boxes: Box[]
  faces: Face[]
  stats: { boxes: number; byKind: Record<string, number> }
}

// ---- geometry ----

export function bbox(poly: Poly): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of poly) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

export function inPoly(x: number, y: number, poly: Poly): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

const inBox = (x: number, y: number, b: number[]): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L = dx * dx + dy * dy
  const t = clamp(L ? ((px - ax) * dx + (py - ay) * dy) / L : 0, 0, 1)
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

export function distToLine(px: number, py: number, pts: number[][]): number {
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSeg(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]))
  return d
}

function inFootprint(x: number, y: number, b: { cx: number; cy: number; hw: number; hd: number; ang: number }, m: number): boolean {
  const c = Math.cos(b.ang)
  const s = Math.sin(b.ang)
  const dx = x - b.cx
  const dy = y - b.cy
  return Math.abs(dx * c + dy * s) <= b.hw + m && Math.abs(-dx * s + dy * c) <= b.hd + m
}

/** A box's footprint corners, for drawing. */
export function corners(b: Pick<Box, 'cx' | 'cy' | 'hw' | 'hd' | 'ang'>): XY[] {
  const c = Math.cos(b.ang)
  const s = Math.sin(b.ang)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([u, v]) => [b.cx + u * b.hw * c - v * b.hd * s, b.cy + u * b.hw * s + v * b.hd * c])
}

// ---- terrain ----

export interface PlanTerrain {
  heightAt(x: number, y: number): number
  surfaceAt(x: number, y: number): string
  faces: Face[]
}

export function planTerrain(plan: Pick<PlanInput, 'ground' | 'defaults'>): PlanTerrain {
  const dflt = plan.defaults.groundZ
  const dSurf = plan.defaults.surface
  const areas = (plan.ground ?? [])
    .filter((g) => !g.hidden)
    .map((g) => {
      let f: (x: number, y: number) => number
      if (g.plane && g.plane.length === 3) {
        const [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]] = g.plane
        const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)
        const a = ((z2 - z1) * (y3 - y1) - (z3 - z1) * (y2 - y1)) / (det || 1)
        const b = ((x2 - x1) * (z3 - z1) - (x3 - x1) * (z2 - z1)) / (det || 1)
        const c = z1 - a * x1 - b * y1
        f = (x, y) => a * x + b * y + c
      } else {
        const z = g.z ?? 0
        f = () => z
      }
      return { g, f, bb: bbox(g.poly) }
    })
  const areaAt = (x: number, y: number): (typeof areas)[number] | null => {
    for (let i = areas.length - 1; i >= 0; i--) {
      const A = areas[i]
      if (inBox(x, y, A.bb) && inPoly(x, y, A.g.poly)) return A
    }
    return null
  }
  const heightAt = (x: number, y: number): number => {
    const A = areaAt(x, y)
    return A ? A.f(x, y) : dflt
  }
  const surfaceAt = (x: number, y: number): string => areaAt(x, y)?.g.surface ?? (areaAt(x, y) ? 'grass' : dSurf)
  // Vertical faces: walk every area's edge in short pieces and compare the ground either side.
  const steps: Face[] = []
  const STEP = 25
  const MIN = 1
  for (const A of areas) {
    const P = A.g.poly
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i]
      const [bx, by] = P[(i + 1) % P.length]
      const L = Math.hypot(bx - ax, by - ay)
      if (L < 1e-6) continue
      const ux = (bx - ax) / L
      const uy = (by - ay) / L
      const nx = -uy
      const ny = ux
      const n = Math.max(1, Math.ceil(L / STEP))
      let run: Face | null = null
      for (let k = 0; k < n; k++) {
        const t0 = k / n
        const t1 = (k + 1) / n
        const mx = ax + ((t0 + t1) / 2) * (bx - ax)
        const my = ay + ((t0 + t1) / 2) * (by - ay)
        const zl = heightAt(mx + nx * 0.5, my + ny * 0.5)
        const zr = heightAt(mx - nx * 0.5, my - ny * 0.5)
        const p0: XY = [ax + t0 * (bx - ax), ay + t0 * (by - ay)]
        const p1: XY = [ax + t1 * (bx - ax), ay + t1 * (by - ay)]
        if (Math.abs(zl - zr) >= MIN) {
          const lowLeft = zl < zr
          const zLo = Math.min(zl, zr)
          const zHi = Math.max(zl, zr)
          const N: XY = lowLeft ? [nx, ny] : [-nx, -ny]
          if (run && Math.abs(run.zLo - zLo) < 0.5 && Math.abs(run.zHi - zHi) < 0.5 && run.n[0] === N[0] && run.n[1] === N[1]) run.b = p1
          else {
            if (run) steps.push(run)
            run = { a: p0, b: p1, zLo, zHi, n: N, src: A.g.id }
          }
        } else if (run) {
          steps.push(run)
          run = null
        }
      }
      if (run) steps.push(run)
    }
  }
  // The same face found from both neighbouring areas: keep one.
  const seen = new Set<string>()
  const faces: Face[] = []
  for (const s of steps) {
    const k =
      [s.a, s.b]
        .map((p) => p.map((v) => Math.round(v)).join(','))
        .sort()
        .join('|') + `|${Math.round(s.zLo)}|${Math.round(s.zHi)}`
    if (!seen.has(k)) {
      seen.add(k)
      faces.push(s)
    }
  }
  return { heightAt, surfaceAt, faces }
}

// ---- presets ----

const LIME = [
  [0.42, 0.39, 0.33],
  [0.36, 0.32, 0.27],
  [0.3, 0.27, 0.24],
  [0.45, 0.37, 0.29],
  [0.26, 0.26, 0.27],
  [0.33, 0.24, 0.18]
]
const TOWER = [
  [0.22, 0.24, 0.27],
  [0.3, 0.31, 0.33],
  [0.5, 0.48, 0.44],
  [0.16, 0.19, 0.22]
]
const between = (r: Random, a: number, b: number): number => a + (b - a) * r()
const lerpR = (u: number, v: unknown): number => (Array.isArray(v) ? v[0] + (v[1] - v[0]) * u : (v as number))
const pickRange = (r: Random, v: unknown, dflt: number): number =>
  Array.isArray(v) ? between(r, v[0], v[1]) : v != null ? (v as number) : dflt
const jit = (r: Random, c: number[], j: number): number[] => c.map((v) => clamp(v * (1 - j + 2 * j * r()), 0, 1))
const pick = <T>(r: Random, a: T[]): T => a[Math.floor(r() * a.length) % a.length]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>

function heightFrom(prof: Params | undefined, r: Random, x: number, y: number): number {
  const p = prof ?? { kind: 'random', min: 10, max: 30 }
  if (p.kind === 'flat') return p.h
  if (p.kind === 'tiers') {
    const u = r()
    let acc = 0
    for (const t of p.tiers) {
      acc += t.p
      if (u <= acc) return pickRange(r, t.h, 10)
    }
    return pickRange(r, p.tiers[p.tiers.length - 1].h, 10)
  }
  if (p.kind === 'peak') {
    const d2 = (x - p.at[0]) ** 2 + (y - p.at[1]) ** 2
    const f = Math.exp(-d2 / (p.radius * p.radius))
    const v = r()
    let h = p.min + f * (p.max - p.min) * Math.pow(v, p.skew || 1) + r() * (p.jitter || 0)
    if (p.spike && f > (p.spike.within || 0.55) && r() < p.spike.chance) h += pickRange(r, p.spike.add, 0)
    return h
  }
  return p.min + (p.max - p.min) * Math.pow(r(), p.skew || 1)
}

interface Ctx {
  add(b: Omit<Box, 'src'>): void
  avoid(x: number, y: number, m: number): boolean
}
type Region = NonNullable<PlanInput['regions']>[number]

function genBuildingField(reg: Region, T: PlanTerrain, ctx: Ctx, r: Random): void {
  const p = (reg.params ?? {}) as Params
  const bb = bbox(reg.poly)
  const ang = (p.gridAngle || 0) * D2R
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const cx0 = (bb[0] + bb[2]) / 2
  const cy0 = (bb[1] + bb[3]) / 2
  const R = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 1
  const blk = p.block || [90, 90]
  const st = p.street == null ? 0 : p.street
  const lot = p.lot || [26, 62]
  const per = p.perBlock || [1, 2]
  const pal: number[][] = p.palette || TOWER
  for (let u = -R; u < R; u += blk[0] + st)
    for (let v = -R; v < R; v += blk[1] + st) {
      if (r() < (p.vacancy || 0)) continue
      const n = Math.max(1, Math.round(between(r, per[0], per[1] + 0.999) - 0.499))
      for (let k = 0; k < n; k++) {
        const w = Math.min(blk[0], pickRange(r, lot, 30))
        const d = Math.min(blk[1], pickRange(r, p.lotDepth || lot, 30))
        const ou = u + r() * (blk[0] - w) + w / 2
        const ov = v + r() * (blk[1] - d) + d / 2
        const x = cx0 + ou * c - ov * s
        const y = cy0 + ou * s + ov * c
        if (!inPoly(x, y, reg.poly) || ctx.avoid(x, y, 2)) continue
        if (p.coverage != null && r() > p.coverage) continue
        const h = heightFrom(p.height, r, x, y)
        const z0 = T.heightAt(x, y)
        ctx.add({
          cx: x,
          cy: y,
          hw: w / 2,
          hd: d / 2,
          ang,
          z0,
          z1: z0 + h,
          alb: jit(r, pick(r, pal), p.colourJitter == null ? 0.1 : p.colourJitter),
          kind: 'building'
        })
      }
    }
}

function genCliffStrips(reg: Region, T: PlanTerrain, ctx: Ctx, r: Random): void {
  const p = (reg.params ?? {}) as Params
  const minStep = p.minStep || 20
  const wr = p.stripWidth || [14, 44]
  const dB = p.depthBottom == null ? 38 : p.depthBottom
  const dT = p.depthTop == null ? 10 : p.depthTop
  const dj = p.depthJitter == null ? 0.35 : p.depthJitter
  const dn = p.depthNoise == null ? 5 : p.depthNoise
  const tr = p.terrace || [12, 21]
  const pal: number[][] = p.palette || LIME
  const bb = bbox(reg.poly)
  for (const S of T.faces) {
    if (S.zHi - S.zLo < minStep) continue
    const L = Math.hypot(S.b[0] - S.a[0], S.b[1] - S.a[1])
    const ux = (S.b[0] - S.a[0]) / L
    const uy = (S.b[1] - S.a[1]) / L
    const ang = Math.atan2(uy, ux)
    for (let t = 0; t < L;) {
      const w = Math.min(L - t, pickRange(r, wr, 25))
      const mx = S.a[0] + ux * (t + w / 2)
      const my = S.a[1] + uy * (t + w / 2)
      t += w
      if (w < 4 || !inBox(mx, my, bb) || !inPoly(mx, my, reg.poly) || ctx.avoid(mx + S.n[0] * 6, my + S.n[1] * 6, 3)) {
        r()
        continue
      }
      const base = pick(r, pal)
      const zLo = S.zLo
      const zTop = Math.min(S.zHi, p.top != null ? zLo + p.top : S.zHi)
      for (let z = zLo; z < zTop - 0.5;) {
        const top = Math.min(zTop, z + pickRange(r, tr, 15))
        const f = (z - zLo) / Math.max(1, zTop - zLo)
        let dep = dT + (dB - dT) * (1 - f) * (1 - dj + dj * r()) + r() * dn
        if (p.maxDepth) dep = Math.min(dep, p.maxDepth)
        ctx.add({
          cx: mx + (S.n[0] * dep) / 2,
          cy: my + (S.n[1] * dep) / 2,
          hw: w / 2,
          hd: dep / 2,
          ang,
          z0: z,
          z1: top,
          alb: jit(r, base, 0.15),
          kind: 'cliff'
        })
        z = top
      }
    }
  }
}

function genYards(reg: Region, T: PlanTerrain, ctx: Ctx, r: Random): void {
  const p = (reg.params ?? {}) as Params
  const bb = bbox(reg.poly)
  const ang = (p.angle || 0) * D2R
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const cx0 = (bb[0] + bb[2]) / 2
  const cy0 = (bb[1] + bb[3]) / 2
  const R = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 1
  const pitch = p.pitch || 75
  const row = p.row || 300
  const Lr = p.length || [110, 260]
  const Wr = p.width || [22, 44]
  const Hr = p.height || [20, 46]
  for (let u = -R; u < R; u += pitch)
    for (let v = -R; v < R; v += row) {
      if (r() > (p.fill == null ? 0.85 : p.fill)) continue
      const L = pickRange(r, Lr, 150)
      const W = pickRange(r, Wr, 30)
      const H = pickRange(r, Hr, 30)
      const ou = u + r() * 20
      const ov = v - r() * (row - L)
      const x = cx0 + ou * c - ov * s
      const y = cy0 + ou * s + ov * c
      if (!inPoly(x, y, reg.poly) || ctx.avoid(x, y, 2)) continue
      const z0 = T.heightAt(x, y) + 2
      ctx.add({ cx: x, cy: y, hw: W / 2, hd: L / 2, ang, z0, z1: z0 + H, alb: jit(r, [0.17, 0.17, 0.18], 0.3), kind: 'hull' })
      if (r() < (p.cranes == null ? 0.7 : p.cranes)) {
        const k = (r() - 0.5) * L
        const qx = x + (W / 2 + 10) * c - k * s
        const qy = y + (W / 2 + 10) * s + k * c
        const z = T.heightAt(qx, qy)
        ctx.add({ cx: qx, cy: qy, hw: 2.5, hd: 2.5, ang, z0: z, z1: z + 55 + r() * 30, alb: [0.45, 0.32, 0.15], kind: 'crane' })
      }
      if (r() < (p.lights == null ? 0.8 : p.lights)) {
        const k = (r() - 0.5) * L
        const qx = x - (W / 2 + 12) * c - k * s
        const qy = y - (W / 2 + 12) * s + k * c
        const z = T.heightAt(qx, qy)
        ctx.add({ cx: qx, cy: qy, hw: 1, hd: 1, ang, z0: z, z1: z + 28, alb: [0.3, 0.3, 0.3], kind: 'mast' })
        ctx.add({
          cx: qx,
          cy: qy,
          hw: 2,
          hd: 2,
          ang,
          z0: z + 28,
          z1: z + 31,
          alb: [0.3, 0.3, 0.3],
          emit: [1, 0.72, 0.42],
          kind: 'floodlight'
        })
      }
    }
}

function genScatter(reg: Region, T: PlanTerrain, ctx: Ctx, r: Random): void {
  const p = (reg.params ?? {}) as Params
  const bb = bbox(reg.poly)
  const area = ((bb[2] - bb[0]) * (bb[3] - bb[1])) / 1e6
  const n = Math.round((p.density || 30) * area)
  const hs = p.houseShare == null ? 0.45 : p.houseShare
  for (let i = 0; i < n; i++) {
    const x = between(r, bb[0], bb[2])
    const y = between(r, bb[1], bb[3])
    const house = r() < hs
    // Drawn whether or not the spot is used, so moving one corner does not reshuffle the rest.
    const a = r()
    const b = r()
    const c2 = r()
    const d = r()
    if (!inPoly(x, y, reg.poly) || ctx.avoid(x, y, 4)) continue
    const z0 = T.heightAt(x, y)
    if (house) {
      const w = lerpR(a, p.houseWidth || [14, 36])
      const dd = lerpR(b, p.houseDepth || [10, 26])
      const h = lerpR(c2, p.houseHeight || [6, 13])
      ctx.add({
        cx: x,
        cy: y,
        hw: w / 2,
        hd: dd / 2,
        ang: (p.angle || 0) * D2R + (d - 0.5) * (p.angleJitter || 0) * D2R,
        z0,
        z1: z0 + h,
        alb: jit(r, p.houseColour || [0.62, 0.58, 0.52], 0.12),
        kind: 'house'
      })
    } else {
      const w = lerpR(a, p.treeWidth || [6, 14])
      const h = lerpR(c2, p.treeHeight || [8, 18])
      ctx.add({ cx: x, cy: y, hw: w / 2, hd: w / 2, ang: 0, z0, z1: z0 + h, alb: jit(r, [0.07, 0.09, 0.05], 0.3), kind: 'tree' })
    }
  }
}

const PRESETS: Record<string, (reg: Region, T: PlanTerrain, ctx: Ctx, r: Random) => void> = {
  buildings: genBuildingField,
  cliff: genCliffStrips,
  yards: genYards,
  scatter: genScatter,
  empty: () => {}
}

// ---- lines ----

export const LINE_STYLE: Record<
  string,
  { width: number; t?: number; h?: number; z?: number; alb: number[]; lamps?: number; mount?: string }
> = {
  street: { width: 12, t: 0.3, alb: [0.1, 0.1, 0.1], lamps: 30 },
  avenue: { width: 24, t: 0.3, alb: [0.1, 0.1, 0.1], lamps: 30 },
  highway: { width: 30, t: 0.3, alb: [0.11, 0.11, 0.11], lamps: 45 },
  stairs: { width: 4, t: 0.5, alb: [0.4, 0.38, 0.35] },
  lightrail: { width: 7, t: 0.6, alb: [0.2, 0.2, 0.2] },
  heavyrail: { width: 10, t: 0.8, alb: [0.22, 0.2, 0.18] },
  fieldline: { width: 8, t: 0.6, alb: [0.2, 0.2, 0.2] },
  funicular: { width: 6, t: 0.6, alb: [0.25, 0.25, 0.26] },
  seawall: { width: 10, h: 5, alb: [0.4, 0.38, 0.34] },
  barrage: { width: 30, h: 9, alb: [0.28, 0.2, 0.15] },
  breakwater: { width: 15, h: 4, alb: [0.35, 0.34, 0.32] },
  pier: { width: 20, t: 1, z: 5, alb: [0.3, 0.26, 0.2], mount: 'elevated' },
  siding: { width: 5, t: 0.6, alb: [0.22, 0.2, 0.18] }
}

function genLine(ln: PlanLine, T: PlanTerrain, ctx: Ctx): void {
  const st = LINE_STYLE[ln.kind] ?? LINE_STYLE.street
  const w = ln.width || st.width
  const mount = ln.mount || st.mount || 'grade'
  const pts = ln.pts
  const vz = (i: number): number | null => (pts[i].length > 2 ? pts[i][2] : ln.z != null ? ln.z : st.z != null ? st.z : null)
  let lampAcc = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const L = Math.hypot(bx - ax, by - ay)
    if (L < 0.01) continue
    const ang = Math.atan2(by - ay, bx - ax)
    const za = vz(i - 1)
    const zb = vz(i)
    const sloped = za != null && zb != null && Math.abs(zb - za) > 0.5
    const piece = sloped ? Math.max(1, L / Math.ceil(Math.abs(zb - za) / 1.5)) : mount === 'grade' ? 40 : L
    const n = Math.max(1, Math.ceil(L / piece - 1e-9))
    const spans: { t0: number; t1: number; g: number }[] = []
    for (let k = 0; k < n; k++) {
      const t0 = k / n
      const t1 = (k + 1) / n
      const g = T.heightAt(ax + ((t0 + t1) / 2) * (bx - ax), ay + ((t0 + t1) / 2) * (by - ay))
      const last = spans[spans.length - 1]
      if (!sloped && mount === 'grade' && last && Math.abs(last.g - g) < 0.05) last.t1 = t1
      else spans.push({ t0, t1, g })
    }
    for (const sp of spans) {
      const { t0, t1 } = sp
      const tm = (t0 + t1) / 2
      const x = ax + tm * (bx - ax)
      const y = ay + tm * (by - ay)
      const seg = L * (t1 - t0)
      const ground = T.heightAt(x, y)
      if (st.h != null || ln.h != null) {
        const h = ln.h != null ? ln.h : st.h!
        ctx.add({ cx: x, cy: y, hw: seg / 2 + 0.05, hd: w / 2, ang, z0: ground, z1: ground + h, alb: st.alb, kind: ln.kind })
        continue
      }
      let zTop: number
      if (mount === 'grade' && za == null) zTop = ground + (st.t ?? 0.3)
      else zTop = za != null && zb != null ? za + tm * (zb - za) : za != null ? za : zb != null ? zb : ground + (st.t ?? 0.3)
      ctx.add({
        cx: x,
        cy: y,
        hw: seg / 2 + 0.05,
        hd: w / 2,
        ang,
        z0: zTop - (mount === 'grade' && za == null ? (st.t ?? 0.3) : st.t || 0.6),
        z1: zTop,
        alb: st.alb,
        kind: ln.kind
      })
      if (mount === 'elevated')
        for (let q = 0; q * 25 < seg; q++) {
          const tq = t0 + (q * 25 + 2) / L
          const px = ax + tq * (bx - ax)
          const py = ay + tq * (by - ay)
          const g = T.heightAt(px, py)
          if (zTop - 1 > g + 0.5)
            ctx.add({
              cx: px,
              cy: py,
              hw: 1.2,
              hd: Math.min(2, w / 3),
              ang,
              z0: g,
              z1: zTop - (st.t || 0.6),
              alb: [0.32, 0.31, 0.3],
              kind: 'pillar'
            })
        }
      if (st.lamps && ln.lamps !== false) {
        lampAcc += seg
        while (lampAcc >= st.lamps) {
          lampAcc -= st.lamps
          const tq = t1 - lampAcc / L
          const px = ax + tq * (bx - ax) - Math.sin(ang) * (w / 2 + 1)
          const py = ay + tq * (by - ay) + Math.cos(ang) * (w / 2 + 1)
          ctx.add({
            cx: px,
            cy: py,
            hw: 0.6,
            hd: 0.6,
            ang,
            z0: zTop + 7.5,
            z1: zTop + 8.2,
            alb: [0.2, 0.2, 0.2],
            emit: [1, 0.7, 0.38],
            kind: 'lamp'
          })
        }
      }
    }
  }
}

// ---- the whole plan ----

function streamFor(plan: PlanInput, ctx: GenContext, obj: { id: string; seed?: number }): Random {
  return obj.seed != null ? mulberry32(obj.seed) : ctx.stream(plan.planId, `${plan.seed ?? 0}:${obj.id}`)
}

export function generatePlan(plan: PlanInput, gen: GenContext): PlanOutput {
  const T = planTerrain(plan)
  const fixed = (plan.buildings ?? [])
    .filter((b) => b.clear !== false && !b.hidden)
    .map((b) => ({ cx: b.center[0], cy: b.center[1], hw: b.size[0] / 2, hd: b.size[1] / 2, ang: (b.angle || 0) * D2R }))
  const cuts = (plan.lines ?? [])
    .filter((l) => !l.hidden && (l.kind === 'funicular' || l.clear))
    .map((l) => ({ pts: l.pts, r: ((l.width || 6) + 8) / 2 }))
  const boxes: Box[] = []
  const ctxFor = (src: string): Ctx => ({
    add: (b) => boxes.push({ ...b, src }),
    avoid(x, y, m) {
      for (const f of fixed) if (inFootprint(x, y, f, m)) return true
      for (const c of cuts) if (distToLine(x, y, c.pts) < c.r + m) return true
      return false
    }
  })
  for (const b of plan.buildings ?? []) {
    if (b.hidden) continue
    const z0 = b.z0 != null ? b.z0 : T.heightAt(b.center[0], b.center[1])
    const z1 = b.z1 != null ? b.z1 : z0 + (b.h || 10)
    ctxFor(b.id).add({
      cx: b.center[0],
      cy: b.center[1],
      hw: b.size[0] / 2,
      hd: b.size[1] / 2,
      ang: (b.angle || 0) * D2R,
      z0,
      z1,
      alb: b.colour ?? [0.4, 0.4, 0.4],
      emit: b.kind === 'lamp' ? (b.colour ?? [1, 0.8, 0.5]) : undefined,
      kind: b.kind ?? 'landmark'
    })
  }
  for (const reg of plan.regions ?? []) {
    if (reg.hidden || !PRESETS[reg.preset]) continue
    PRESETS[reg.preset](reg, T, ctxFor(reg.id), streamFor(plan, gen, reg))
  }
  for (const ln of plan.lines ?? []) if (!ln.hidden && ln.pts.length > 1) genLine(ln, T, ctxFor(ln.id))
  const byKind: Record<string, number> = {}
  for (const b of boxes) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1
  return { boxes, faces: T.faces, stats: { boxes: boxes.length, byKind } }
}

const round = (x: number): number => Math.round(x * 1000) / 1000

export const cityplan = defineGenerator<PlanInput, PlanOutput>({
  name: 'cityplan',
  version: 1,
  description: "A city plan's geometry: ground and its faces, generated building regions, roads and rail, landmarks",
  frozen: true,
  generate(plan, ctx) {
    const out = generatePlan(plan, ctx)
    // Rounded to the millimetre, so the output is stable to compare.
    return {
      boxes: out.boxes.map((b) => ({
        ...b,
        cx: round(b.cx),
        cy: round(b.cy),
        hw: round(b.hw),
        hd: round(b.hd),
        ang: round(b.ang),
        z0: round(b.z0),
        z1: round(b.z1),
        alb: b.alb.map(round)
      })),
      faces: out.faces,
      stats: out.stats
    }
  }
})

// ---- services: cars on a timetable ----

export interface PlanPath {
  L: number
  at(s: number): { x: number; y: number; z: number; head: number; slope: number }
}

/** A line as a path: distance along it (3D for funiculars) to position, heading and slope. */
export function linePath(ln: PlanLine, T: PlanTerrain, threeD: boolean): PlanPath {
  const st = LINE_STYLE[ln.kind] ?? {}
  const P = ln.pts
  const vz = (i: number): number | null => (P[i].length > 2 ? P[i][2] : ln.z != null ? ln.z : null)
  const zAt = (i: number, f: number, x: number, y: number): number => {
    const a = vz(i)
    const b = vz(i + 1)
    if (a != null && b != null) return a + (b - a) * f
    if (a != null) return a
    if (b != null) return b
    return T.heightAt(x, y) + ((st as { t?: number }).t || 0.6)
  }
  const segs: { i: number; s0: number; L: number; h: number; dx: number; dy: number; za: number; zb: number }[] = []
  let acc = 0
  for (let i = 0; i < P.length - 1; i++) {
    const dx = P[i + 1][0] - P[i][0]
    const dy = P[i + 1][1] - P[i][1]
    const h = Math.hypot(dx, dy)
    const za = zAt(i, 0, P[i][0], P[i][1])
    const zb = zAt(i, 1, P[i + 1][0], P[i + 1][1])
    const L = threeD ? Math.hypot(h, zb - za) : h
    segs.push({ i, s0: acc, L, h, dx, dy, za, zb })
    acc += L
  }
  return {
    L: acc,
    at(s) {
      s = clamp(s, 0, acc)
      let g = segs[segs.length - 1]
      for (const q of segs)
        if (s <= q.s0 + q.L) {
          g = q
          break
        }
      const f = g.L ? (s - g.s0) / g.L : 0
      const x = P[g.i][0] + g.dx * f
      const y = P[g.i][1] + g.dy * f
      return { x, y, z: zAt(g.i, f, x, y), head: Math.atan2(g.dy, g.dx), slope: Math.atan2(g.zb - g.za, g.h || 1e-9) }
    }
  }
}

function nearestS(path: PlanPath, pt: number[]): number {
  let best = 0
  let bd = Infinity
  const N = Math.max(50, Math.ceil(path.L / 20))
  for (let k = 0; k <= N; k++) {
    const s = (path.L * k) / N
    const q = path.at(s)
    const d = Math.hypot(q.x - pt[0], q.y - pt[1])
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

export interface CityService {
  id: string
  kind: 'funicular' | 'train'
  path: PlanPath
  /** Stops, as distances along the line. */
  stops: number[]
  /** Seconds into a run when it leaves each stop (forward run), and the reverse run's. */
  departs: number[]
  departsBack: number[]
  /** Seconds into a run when it reaches each stop (forward, reverse). */
  arrives: number[]
  arrivesBack: number[]
  /** Departures the other way are offset by this from `phase` (half a headway; none for a funicular, whose cars pass). */
  backPhase: number
  run: RunPlan
  runBack: RunPlan
  headway: number
  phase: number
  tracks: number
  offset: number
  cars: number
  car: { length: number; width: number; height: number; colour: number[] }
  /** Running hours, local; null for all day. */
  hours: [number, number] | null
}

/** Leave times at each stop for a run through stops S with dwell dw (time it pulls away from stop i). */
function departTimes(S: number[], dw: number[], v: number, a: number): number[] {
  const out: number[] = []
  let t = 0
  for (let i = 0; i < S.length; i++) {
    t += dw[i] || 0
    out.push(t)
    if (i < S.length - 1) t += legTime(S[i + 1] - S[i], v, a)
  }
  return out
}

/** Every service on the plan's lines, ready to place cars or route passengers. */
export function cityServices(plan: Pick<PlanInput, 'lines' | 'ground' | 'defaults'>): CityService[] {
  const T = planTerrain(plan)
  const out: CityService[] = []
  for (const ln of plan.lines ?? []) {
    const sv = ln.service
    if (!sv || ln.hidden || ln.pts.length < 2) continue
    const funi = ln.kind === 'funicular'
    const path = linePath(ln, T, funi)
    const v = sv.speed_ms || (funi ? 5 : 15)
    const a = sv.accel_ms2 || (funi ? 0.6 : 1)
    let S = [0, path.L]
    for (const p of sv.stops ?? []) S.push(Array.isArray(p) ? nearestS(path, p as number[]) : Number(p))
    if (sv.stopEvery_m) for (let s = sv.stopEvery_m; s < path.L - sv.stopEvery_m / 2; s += sv.stopEvery_m) S.push(s)
    S = [...new Set(S.map((x) => Math.round(x * 10) / 10))].filter((x) => x >= 0 && x <= path.L + 0.1).sort((x, y) => x - y)
    const dwell = sv.dwell_s ?? 30
    const dw = S.map((_, i) => (i === 0 || i === S.length - 1 ? 0 : dwell))
    const back = S.map((x) => path.L - x).reverse()
    const dwBack = dw.slice().reverse()
    out.push({
      id: ln.id,
      kind: funi ? 'funicular' : 'train',
      path,
      stops: S,
      departs: departTimes(S, dw, v, a),
      departsBack: departTimes(back, dwBack, v, a),
      arrives: departTimes(S, dw, v, a).map((t, i) => t - (dw[i] || 0)),
      arrivesBack: departTimes(back, dwBack, v, a).map((t, i) => t - (dwBack[i] || 0)),
      backPhase: funi ? 0 : (sv.headway_s || 600) / 2,
      run: runPlan(S, dw, v, a),
      runBack: runPlan(back, dwBack, v, a),
      headway: funi ? runPlan(S, dw, v, a).duration : sv.headway_s || 600,
      phase: sv.phase_s || 0,
      tracks: funi ? 2 : sv.tracks || 2,
      offset: 2,
      cars: sv.cars || 1,
      car: {
        length: sv.carLength_m || (funi ? 12 : 20),
        width: funi ? 3 : 2.8,
        height: funi ? 3 : 3.6,
        colour: sv.colour ?? (funi ? [0.62, 0.18, 0.14] : [0.75, 0.76, 0.78])
      },
      hours: sv.hours && sv.hours.length === 2 ? [sv.hours[0], sv.hours[1]] : null
    })
  }
  return out
}

export interface Vehicle {
  line: string
  x: number
  y: number
  z: number
  head: number
  length: number
  width: number
  height: number
  colour: number[]
}

/** The cars at time t (seconds since local midnight, or any steady clock). */
export function vehiclesAt(services: readonly CityService[], t: number): Vehicle[] {
  const out: Vehicle[] = []
  const carAt = (sv: CityService, s: number, lat: number, dir: number): void => {
    const q = sv.path.at(s)
    const n = [-Math.sin(q.head), Math.cos(q.head)]
    out.push({
      line: sv.id,
      x: q.x + n[0] * lat,
      y: q.y + n[1] * lat,
      z: q.z,
      head: q.head + (dir < 0 ? Math.PI : 0),
      length: sv.car.length,
      width: sv.car.width,
      height: sv.car.height,
      colour: sv.car.colour
    })
  }
  for (const sv of services) {
    if (sv.kind === 'funicular') {
      const R = sv.run
      const cyc = ((t % (2 * R.duration)) + 2 * R.duration) % (2 * R.duration)
      const up = cyc < R.duration
      const d = R.at(up ? cyc : cyc - R.duration).s
      const sA = up ? d : sv.path.L - d
      const half = sv.car.length / 2
      carAt(sv, clamp(sA, half, sv.path.L - half), -1.7, 1)
      carAt(sv, clamp(sv.path.L - sA, half, sv.path.L - half), 1.7, -1)
      continue
    }
    for (const [dir, R, lat] of [
      [1, sv.run, -sv.offset],
      [-1, sv.runBack, sv.offset]
    ] as const) {
      if (sv.tracks < 2 && dir < 0) continue
      const ph = sv.phase + (dir < 0 ? sv.backPhase : 0)
      for (let k = Math.floor((t - ph - R.duration) / sv.headway); k <= Math.floor((t - ph) / sv.headway); k++) {
        const u = t - ph - k * sv.headway
        if (u < 0 || u > R.duration) continue
        const d = R.at(u).s
        const front = dir > 0 ? d : sv.path.L - d
        for (let j = 0; j < sv.cars; j++) {
          const off = j * (sv.car.length + 1) + sv.car.length / 2
          const sc = dir > 0 ? front - off : front + off
          if (sc >= 0 && sc <= sv.path.L) carAt(sv, sc, lat, dir)
        }
      }
    }
  }
  return out
}
