/**
 * Planet terrain, worked out from the files (docs/PLAN.md §7.6).
 *
 * The heights are terrain@1's (from the terrain file's parameters and roll)
 * with the author's hand shaping on top. The look is derived: temperature
 * comes from the body's own sunlight, tilt and air (so moving the planet
 * changes its look, unless the terrain file fixes a temperature), and the
 * colours from temperature, height, water and a band of dryness either side
 * of the subtropics. Rasters (height and colour maps) are derived and never
 * stored in the world.
 */
import {
  DEG,
  annualInsolationFactor,
  arc,
  arcToSegment,
  fbm,
  fromLatLon,
  insideSphericalPolygon,
  lockedInsolationFactor,
  perlin3,
  type Vec3
} from '@malevo/core'
import { contextFor, terrain, terrainField, type TerrainField } from '@malevo/gen'
import type { WorldEnv } from './env'
import { bodyKind, terrainKind, type BodyFile, type TerrainFile } from './kinds'
import { entitiesOf, type WorldData } from './load'
import { systemInfo, type BodyInfo } from './systems'

export const TERRAIN_GEN = 'terrain@1'

/** Classes that have a surface to shape. */
export const SURFACE_CLASSES: readonly BodyFile['class'][] = ['rocky', 'ocean', 'dwarf']

export function terrainOf(world: WorldData, bodyId: string): { id: string; file: TerrainFile } | null {
  const e = entitiesOf(world, terrainKind).find((x) => x.value.body === bodyId)
  return e ? { id: e.id, file: e.value } : null
}

type Shape = NonNullable<TerrainFile['shapes']>[number]

/** The hand shaping applied to a height at a point (km in, km out). */
export function applyShapes(h: number, p: Vec3, shapes: readonly Shape[]): number {
  for (const s of shapes) {
    const pts = s.points.map(([lat, lon]) => fromLatLon(lat * DEG, lon * DEG))
    const width = (s.width_deg ?? 3) * DEG
    switch (s.kind) {
      case 'land':
        if (insideSphericalPolygon(p, pts)) h = Math.max(h, 0.15 + 0.05 * Math.abs(h))
        break
      case 'sea':
        if (insideSphericalPolygon(p, pts)) h = Math.min(h, -0.5 - 0.05 * Math.abs(h))
        break
      case 'raise':
      case 'lower': {
        if (!insideSphericalPolygon(p, pts)) break
        let edge = Infinity
        for (let i = 0; i < pts.length; i++) edge = Math.min(edge, arcToSegment(p, pts[i], pts[(i + 1) % pts.length]))
        const w = Math.min(1, edge / width)
        h += (s.kind === 'raise' ? 1 : -1) * (s.height_km ?? 1) * w
        break
      }
      case 'ridge': {
        let d = Infinity
        for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, arcToSegment(p, pts[i], pts[i + 1]))
        h += (s.height_km ?? 3) * Math.exp(-((d / width) ** 2))
        break
      }
    }
  }
  return h
}

export interface ClimateInputs {
  /** Mean surface temperature, K. */
  mean: number
  tilt: number
  /** Locked to its star: sunlight by angle from the substellar point (longitude 0) instead of by latitude. */
  locked: boolean
  transport: number
  /** It has surface water: seas, ice, and the biomes that need them. */
  water: boolean
  air: boolean
  /** Bare rock's colour, if set. */
  rock: [number, number, number] | null
}

const hexRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16)
]

export function climateInputs(b: BodyInfo, file: TerrainFile): ClimateInputs | null {
  if (b.equilibriumTemp === null) return null
  const atm = b.file.atmosphere
  const p = atm?.pressure_atm ?? 0
  const air = p > 0.001
  const greenhouse = file.climate?.greenhouse_K ?? (air ? 33 * Math.pow(p, 0.6) : 0)
  return {
    mean: file.climate?.temperature_K ?? b.equilibriumTemp + greenhouse,
    tilt: b.tilt,
    locked: Boolean(b.file.rotation.locked) && !b.parent,
    transport: file.climate?.heatTransport ?? (air ? 0.35 : 0.05),
    water: file.climate?.water ?? p >= 0.5,
    air,
    rock: file.climate?.rock ? hexRgb(file.climate.rock) : null
  }
}

const insolationMemo = new Map<string, number>()

/** Surface temperature at a point and height, K. */
export function temperatureAt(c: ClimateInputs, p: Vec3, h: number): number {
  const lat = Math.asin(Math.max(-1, Math.min(1, p[2])))
  let f: number
  if (c.locked) f = lockedInsolationFactor(arc(p, [1, 0, 0]))
  else {
    // By latitude only, so a map's rows share it.
    const key = `${c.tilt.toFixed(6)}|${lat.toFixed(5)}`
    let v = insolationMemo.get(key)
    if (v === undefined) {
      if (insolationMemo.size > 20000) insolationMemo.clear()
      insolationMemo.set(key, (v = annualInsolationFactor(lat, c.tilt, 24)))
    }
    f = v
  }
  const local = c.mean * Math.pow(Math.max(f, 0), 0.25)
  const t = c.mean * c.transport + local * (1 - c.transport)
  return t - (c.air ? 6.5 * Math.max(0, h) : 0)
}

export type Biome =
  | 'deep-sea'
  | 'sea'
  | 'shelf'
  | 'sea-ice'
  | 'ice'
  | 'tundra'
  | 'boreal'
  | 'temperate'
  | 'grassland'
  | 'desert'
  | 'savanna'
  | 'tropical'
  | 'rock'
  | 'highland'
  | 'basin'

export const BIOME_COLOURS: Record<Biome, [number, number, number]> = {
  'deep-sea': [18, 42, 94],
  sea: [30, 68, 130],
  shelf: [54, 108, 160],
  'sea-ice': [214, 226, 236],
  ice: [240, 244, 248],
  tundra: [148, 152, 128],
  boreal: [54, 92, 62],
  temperate: [70, 120, 60],
  grassland: [140, 160, 86],
  desert: [212, 186, 132],
  savanna: [178, 168, 92],
  tropical: [36, 106, 48],
  rock: [128, 118, 108],
  highland: [104, 96, 90],
  basin: [96, 88, 80]
}

export function biomeAt(c: ClimateInputs, p: Vec3, h: number, t: number, dryness: number): Biome {
  if (h < 0 && c.water) {
    if (t < 271) return 'sea-ice'
    if (t > 373) return 'basin'
    return h < -2 ? 'deep-sea' : h < -0.25 ? 'sea' : 'shelf'
  }
  // A dry world: rock and dust, with frost only where it is very cold.
  if (!c.water || !c.air) return t < 160 ? 'ice' : h < 0 ? 'basin' : h > 3 ? 'highland' : 'rock'
  if (t < 263) return 'ice'
  if (t < 273) return 'tundra'
  if (h > 4) return 'highland'
  if (t < 283) return dryness > 0.6 ? 'grassland' : 'boreal'
  if (t < 293) return dryness > 0.75 ? 'desert' : dryness > 0.5 ? 'grassland' : 'temperate'
  return dryness > 0.7 ? 'desert' : dryness > 0.45 ? 'savanna' : 'tropical'
}

/** Rock, basins and highlands take the body's own rock colour. */
function rockTint(b: Biome, rock: [number, number, number]): [number, number, number] {
  if (b === 'rock') return rock
  if (b === 'basin') return rock.map((x) => Math.round(x * 0.78)) as [number, number, number]
  if (b === 'highland') return rock.map((x) => Math.round(x * 0.88)) as [number, number, number]
  return BIOME_COLOURS[b]
}

export interface TerrainSampler {
  height(p: Vec3): number
  /** Height, temperature, biome and colour at a point. */
  sample(p: Vec3): { h: number; t: number | null; biome: Biome; colour: [number, number, number] }
  climate: ClimateInputs | null
}

const fieldCache = new Map<string, TerrainField>()

/** Everything needed to evaluate a body's surface anywhere. Null without a terrain file or a body that can have one. */
export function terrainSampler(world: WorldData, env: WorldEnv, bodyId: string): TerrainSampler | { error: string } {
  const t = terrainOf(world, bodyId)
  if (!t) return { error: 'This body has no terrain yet.' }
  const bodyFile = world.entities.get(`${bodyKind.kind}/${bodyId}`)?.value as BodyFile | undefined
  if (!bodyFile) return { error: `There is no body "${bodyId}".` }
  const sys = systemInfo(world, env, bodyFile.system)
  const b = sys?.bodies.find((x) => x.id === bodyId)
  if (!b) return { error: `There is no body "${bodyId}".` }
  const seed = world.manifest?.seed ?? 0
  const key = `${seed}|${bodyId}|${t.file.roll}|${JSON.stringify(t.file.params)}`
  let field = fieldCache.get(key)
  if (!field) {
    const ctx = contextFor(terrain, seed)
    field = terrainField(t.file.params, (purpose) => ctx.stream(bodyId, `roll-${t.file.roll}:${purpose}`))
    if (fieldCache.size > 16) fieldCache.clear()
    fieldCache.set(key, field)
  }
  const shapes = t.file.shapes ?? []
  const climate = climateInputs(b, t.file)
  const moist = perlin3(contextFor(terrain, seed).stream(bodyId, 'climate:moisture'))
  const height = (p: Vec3): number => applyShapes(field!.height(p), p, shapes)
  return {
    height,
    climate,
    sample(p) {
      const h = height(p)
      if (!climate) return { h, t: null, biome: h < 0 ? 'basin' : 'rock', colour: BIOME_COLOURS[h < 0 ? 'basin' : 'rock'] }
      // A few kelvin of weather, so climate zones do not follow the parallels exactly.
      const temp = temperatureAt(climate, p, h) + 9 * fbm(moist, [p[2], p[0], p[1]], 4, 2.5)
      const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) / DEG
      // Dry either side of the subtropics, wetter at the equator and in the mid-latitudes, varied by noise.
      const belt = Math.abs(lat) - 25 + 12 * fbm(moist, [p[1], p[0], p[2]], 3, 1.5)
      const dryness = Math.max(0, Math.min(1, Math.exp(-((belt / 11) ** 2)) * 0.8 + 0.45 * fbm(moist, p, 4, 2)))
      const biome = biomeAt(climate, p, h, temp, dryness)
      return { h, t: temp, biome, colour: climate.rock ? rockTint(biome, climate.rock) : BIOME_COLOURS[biome] }
    }
  }
}

export interface TerrainRaster {
  width: number
  height: number
  /** km above sea level, row by row from the north pole, longitude −180° to 180°. */
  heights: Float32Array
  /** Colour map, shaded, RGBA. */
  rgba: Uint8ClampedArray
  stats: { ocean: number; highest: number; lowest: number; meanTemp: number | null; minTemp: number | null; maxTemp: number | null }
}

/** An equirectangular height and colour map. */
export function terrainRaster(
  world: WorldData,
  env: WorldEnv,
  bodyId: string,
  width: number,
  height: number
): TerrainRaster | { error: string } {
  const s = terrainSampler(world, env, bodyId)
  if ('error' in s) return s
  const n = width * height
  const heights = new Float32Array(n)
  const rgba = new Uint8ClampedArray(n * 4)
  let wet = 0
  let area = 0
  let hi = -Infinity
  let lo = Infinity
  let tSum = 0
  let tMin = Infinity
  let tMax = -Infinity
  for (let j = 0; j < height; j++) {
    const lat = (90 - ((j + 0.5) * 180) / height) * DEG
    const w = Math.cos(lat)
    for (let i = 0; i < width; i++) {
      const lon = (-180 + ((i + 0.5) * 360) / width) * DEG
      const p = fromLatLon(lat, lon)
      const r = s.sample(p)
      const k = j * width + i
      heights[k] = r.h
      rgba.set([r.colour[0], r.colour[1], r.colour[2], 255], k * 4)
      area += w
      if (r.h < 0) wet += w
      hi = Math.max(hi, r.h)
      lo = Math.min(lo, r.h)
      if (r.t !== null) {
        tSum += r.t * w
        tMin = Math.min(tMin, r.t)
        tMax = Math.max(tMax, r.t)
      }
    }
  }
  // Hillshade the land: light from the north-west.
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const k = j * width + i
      if (heights[k] < 0 && s.climate?.water) continue
      const e = heights[j * width + ((i + 1) % width)]
      const so = heights[Math.min(height - 1, j + 1) * width + i]
      const shade = Math.max(0.55, Math.min(1.35, 1 + (heights[k] - e + (heights[k] - so)) * 0.35))
      for (let c = 0; c < 3; c++) rgba[k * 4 + c] = rgba[k * 4 + c] * shade
    }
  return {
    width,
    height,
    heights,
    rgba,
    stats: {
      ocean: wet / area,
      highest: hi,
      lowest: lo,
      meanTemp: s.climate ? tSum / area : null,
      minTemp: s.climate ? tMin : null,
      maxTemp: s.climate ? tMax : null
    }
  }
}

/** A new terrain file for a body, at the defaults. */
export function newTerrain(bodyId: string, cls: BodyFile['class']): TerrainFile {
  return {
    body: bodyId,
    roll: 0,
    params: {
      plates: 12,
      continents: 0.35,
      ocean: cls === 'ocean' ? 0.75 : cls === 'dwarf' ? 0 : 0.5,
      mountains_km: cls === 'dwarf' ? 3 : 6,
      roughness: 0.5
    }
  }
}
