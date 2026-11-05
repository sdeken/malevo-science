/**
 * terrain@1: a planet's surface height, evaluated at points on the unit
 * sphere (docs/PLAN.md §7.6). Because it is a function of the point in 3D,
 * resolution never changes the result: a map at any size, or a single spot,
 * reads the same heights.
 *
 * - Plates: Voronoi cells on the sphere, their borders roughened by noise.
 *   Some are continental (high), the rest oceanic (low).
 * - Each plate drifts. Where plates converge, mountains rise (higher where a
 *   continent meets a continent); where they part, a low ridge.
 * - Fractal noise adds hills and detail, scaled by roughness.
 * - Sea level is set so that the share of the surface under water is the
 *   ocean fraction asked for (measured on a fixed lattice of points).
 *
 * Heights are kilometres relative to sea level. The stream is keyed by the
 * body and the roll, so re-rolling one body never moves another.
 */
import { arc, fbm, fibonacciSphere, perlin3, randomOnSphere, type Vec3 } from '@malevo/core'
import { defineGenerator } from './generator'

export interface TerrainParams {
  /** How many tectonic plates. */
  plates: number
  /** Share of the plates that are continental, 0–1. */
  continents: number
  /** Share of the surface under water, 0–1. */
  ocean: number
  /** Height of the highest ranges above the land, km. */
  mountains_km: number
  /** How rugged the land is, 0–1. */
  roughness: number
}

export const DEFAULT_TERRAIN: TerrainParams = { plates: 12, continents: 0.35, ocean: 0.7, mountains_km: 6, roughness: 0.5 }

export interface TerrainInput {
  body: string
  roll: number
  params: TerrainParams
  /** Unit vectors to evaluate. */
  points: Vec3[]
}

/** A terrain ready to evaluate anywhere: built once per body, roll and parameters. */
export interface TerrainField {
  /** Height above sea level at a unit vector, km. */
  height(p: Vec3): number
  /** The plate a point lies on, and whether it is continental. */
  plate(p: Vec3): { index: number; continental: boolean }
}

/** Build the field (the generator's work, reusable for rasters without going through `generate` for each point). */
export function terrainField(params: TerrainParams, stream: (purpose: string) => () => number): TerrainField {
  const r = stream('plates')
  const n = Math.max(2, Math.min(60, Math.round(params.plates)))
  const plates: { c: Vec3; continental: boolean; v: Vec3; base: number }[] = []
  for (let k = 0; k < n; k++) {
    const c = randomOnSphere(r)
    // A drift: a random direction in the tangent plane.
    const q = randomOnSphere(r)
    const d = q[0] * c[0] + q[1] * c[1] + q[2] * c[2]
    const t: Vec3 = [q[0] - c[0] * d, q[1] - c[1] * d, q[2] - c[2] * d]
    const tl = Math.hypot(t[0], t[1], t[2]) || 1
    const continental = r() < params.continents
    plates.push({ c, continental, v: [t[0] / tl, t[1] / tl, t[2] / tl], base: continental ? 0.6 + r() * 0.5 : -4 - r() * 1.2 })
  }
  if (!plates.some((p) => p.continental)) plates[0].continental = true
  const warp = perlin3(stream('warp'))
  const hills = perlin3(stream('hills'))
  const rough = Math.max(0, Math.min(1, params.roughness))

  const nearest = (p: Vec3): { i: number; j: number; di: number; dj: number } => {
    // Roughen the borders: look up the plate from a slightly displaced point.
    const w: Vec3 = [
      p[0] + 0.3 * fbm(warp, p, 4, 1.5),
      p[1] + 0.3 * fbm(warp, [p[1], p[2], p[0]], 4, 1.5),
      p[2] + 0.3 * fbm(warp, [p[2], p[0], p[1]], 4, 1.5)
    ]
    const wl = Math.hypot(w[0], w[1], w[2])
    const q: Vec3 = [w[0] / wl, w[1] / wl, w[2] / wl]
    let i = 0
    let j = 1
    let di = Infinity
    let dj = Infinity
    // Nearest two by dot product (the same order as by angle), then the angles for those two only.
    let bi = -Infinity
    let bj = -Infinity
    plates.forEach((pl, k) => {
      const d = q[0] * pl.c[0] + q[1] * pl.c[1] + q[2] * pl.c[2]
      if (d > bi) {
        j = i
        bj = bi
        i = k
        bi = d
      } else if (d > bj) {
        j = k
        bj = d
      }
    })
    di = arc(q, plates[i].c)
    dj = arc(q, plates[j].c)
    return { i, j, di, dj }
  }

  const raw = (p: Vec3): number => {
    const { i, j, di, dj } = nearest(p)
    const a = plates[i]
    const b = plates[j]
    // Near a border, blend the two plates' bases and add what the border does.
    const gap = dj - di
    const border = Math.exp(-gap / 0.06)
    let h = a.base * (1 - 0.5 * border) + b.base * 0.5 * border
    // Convergence: how fast the plates close on each other across the border.
    const across: Vec3 = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]]
    const al = Math.hypot(across[0], across[1], across[2]) || 1
    const conv = ((a.v[0] - b.v[0]) * across[0] + (a.v[1] - b.v[1]) * across[1] + (a.v[2] - b.v[2]) * across[2]) / al
    if (conv > 0) {
      const scale = a.continental && b.continental ? 1 : a.continental || b.continental ? 0.7 : 0.25
      h += border * conv * scale * params.mountains_km * (0.7 + 0.6 * Math.abs(fbm(hills, p, 3, 6)))
    } else h += border * -conv * (a.continental ? -0.4 : 1.2)
    // Hills and detail, more on land.
    // Broad swells, so coasts do not follow plate borders, then hills and detail (more on land).
    h += 2.2 * fbm(warp, [p[1] + 3.1, p[2] - 1.7, p[0] + 0.5], 4, 1.3)
    const land = h > 0 ? 1 : 0.35
    h += land * (0.4 + 1.6 * rough) * fbm(hills, p, 6, 3, 0.45 + 0.2 * rough)
    return h
  }

  // Sea level: the height below which the asked-for share of the surface lies.
  const lattice = fibonacciSphere(2048)
    .map(raw)
    .sort((x, y) => x - y)
  const ocean = Math.max(0, Math.min(1, params.ocean))
  const sea =
    ocean <= 0
      ? lattice[0] - 1
      : ocean >= 1
        ? lattice[lattice.length - 1] + 1
        : lattice[Math.min(lattice.length - 1, Math.floor(ocean * lattice.length))]

  return {
    height: (p) => raw(p) - sea,
    plate: (p) => {
      const { i } = nearest(p)
      return { index: i, continental: plates[i].continental }
    }
  }
}

const round = (x: number): number => Math.round(x * 1e4) / 1e4

export const terrain = defineGenerator<TerrainInput, number[]>({
  name: 'terrain',
  version: 1,
  description: 'Planet surface heights on the sphere: plates, mountains where they meet, noise, sea level by ocean share',
  frozen: true,
  generate(inp, ctx) {
    const field = terrainField(inp.params, (purpose) => ctx.stream(inp.body, `roll-${inp.roll}:${purpose}`))
    return inp.points.map((p) => round(field.height(p)))
  }
})
