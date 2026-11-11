/**
 * Stars, systems and bodies, worked out from the files (docs/PLAN.md §7.4).
 *
 * Everything here is derived: nothing is stored. A system names a star (a
 * catalogue id or a generated id); a body orbits the star or another body.
 * From those and the world's physics settings come periods, positions at any
 * instant, insolation, temperatures, gravity, day lengths, Hill spheres and
 * collapse radii.
 */
import {
  AU,
  DEG,
  G,
  KM,
  L_SUN,
  M_EARTH,
  M_SUN,
  SOLAR_CONSTANT,
  cellsNear,
  collapseRadius,
  compareStrings,
  daylightFraction,
  equilibriumTemperature,
  generateCell,
  habitableZone,
  hillRadius,
  insolation,
  parseGeneratedId,
  period,
  solarDayLength,
  solarDeclination,
  starPhysics,
  stateAt,
  SOL,
  type OrbitalElements,
  type StarPhysics,
  type StarRecord,
  type StarfieldParams,
  type Vec3
} from '@malevo/core'
import type { WorldEnv } from './env'
import {
  bodyKind,
  foamSettings,
  physicsKind,
  starfieldKind,
  systemKind,
  type BodyFile,
  type PhysicsSettings,
  type StarfieldSettings,
  type SystemFile
} from './kinds'
import { entitiesOf, type WorldData } from './load'

// ---- stars ----

export interface WorldStars {
  /** Null when the world has no star field settings (generated stars are then unavailable). */
  params: StarfieldParams | null
  get(id: string): StarRecord | undefined
  /** Catalogue and generated stars within `radius` light-years of `center`. */
  near(center: Vec3, radius: number): StarRecord[]
  catalogAvailable: boolean
}

export function starfieldParams(s: StarfieldSettings, worldSeed: number): StarfieldParams {
  return {
    seed: s.seed ?? worldSeed,
    density: s.density_perLy3,
    scaleHeight: s.scaleHeight_ly,
    cell: s.cell_ly,
    catalogMag: s.catalogMag,
    catalogNear: s.catalogNear_ly
  }
}

const starsCache = new WeakMap<WorldData, WeakMap<WorldEnv, WorldStars>>()

export function worldStars(world: WorldData, env: WorldEnv = {}): WorldStars {
  let byEnv = starsCache.get(world)
  if (!byEnv) starsCache.set(world, (byEnv = new WeakMap()))
  const hit = byEnv.get(env)
  if (hit) return hit
  const settings = entitiesOf(world, starfieldKind)[0]?.value
  const params = settings && world.manifest ? starfieldParams(settings, world.manifest.seed) : null
  const cells = new Map<string, StarRecord[]>()
  const cell = (ix: number, iy: number, iz: number): StarRecord[] => {
    const key = `${ix},${iy},${iz}`
    let c = cells.get(key)
    if (!c) cells.set(key, (c = generateCell(params!, ix, iy, iz)))
    return c
  }
  const out: WorldStars = {
    params,
    catalogAvailable: Boolean(env.catalog),
    get(id) {
      const g = parseGeneratedId(id)
      // Sol is part of the core, so its star is known even without the catalogue.
      if (!g) return env.catalog?.get(id) ?? (id === SOL.id ? SOL : undefined)
      if (!params) return undefined
      return cell(...g.cell).find((s) => s.id === id)
    },
    near(center, radius) {
      const r2 = radius * radius
      const d2 = (s: StarRecord): number => (s.pos[0] - center[0]) ** 2 + (s.pos[1] - center[1]) ** 2 + (s.pos[2] - center[2]) ** 2
      const found = (env.catalog?.stars ?? []).filter((s) => d2(s) <= r2)
      if (params)
        for (const [ix, iy, iz] of cellsNear(params, [center[0], center[1], center[2]], radius))
          for (const s of cell(ix, iy, iz)) if (d2(s) <= r2) found.push(s)
      return found
    }
  }
  byEnv.set(env, out)
  return out
}

export interface StarInfo {
  record: StarRecord
  /** Estimates from the catalogue, with the system's overrides applied. */
  physics: StarPhysics
  /** Which values are overrides. */
  overridden: string[]
}

export function systemStar(system: SystemFile, stars: WorldStars): StarInfo | { error: string } {
  const record = stars.get(system.star)
  if (!record) {
    if (!parseGeneratedId(system.star) && !stars.catalogAvailable) return { error: 'The star catalogue is not available here.' }
    if (parseGeneratedId(system.star) && !stars.params) return { error: 'Generated stars need settings/stars.json.' }
    return { error: `Star "${system.star}" does not exist${parseGeneratedId(system.star) ? ' with the current star field settings' : ''}.` }
  }
  const est = starPhysics(record)
  const o = system.starOverrides ?? {}
  const physics: StarPhysics = {
    teff: o.teff_k ?? est.teff,
    luminosity: o.luminosity_lsun ?? est.luminosity,
    radius: o.radius_rsun ?? est.radius,
    mass: o.mass_msun ?? est.mass,
    massSource: o.mass_msun !== undefined ? 'given' : est.massSource
  }
  return { record, physics, overridden: Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined) }
}

// ---- bodies ----

export interface BodyInfo {
  id: string
  name: string
  cls: BodyFile['class']
  parent: string | null
  depth: number
  file: BodyFile
  /** Why the body's orbit cannot be worked out, if it cannot. */
  error: string | null
  elements: OrbitalElements | null
  mass: number
  radius: number
  albedo: number
  tilt: number
  /** Sidereal rotation period, s (negative for retrograde); the orbital period when locked. */
  rotation: number | null
  /** Orbital period around its parent, s. */
  period: number | null
  /** The orbital period, around the star, of the planet it belongs to, s. */
  year: number | null
  /** Noon to noon, s (Infinity when the star never moves in its sky). */
  solarDay: number | null
  hill: number | null
  /** Where the foam collapses around this body alone, m. */
  collapse: number | null
  surfaceGravity: number
  escapeVelocity: number
  density: number
  /** Mean stellar flux at its planet's distance, W/m². */
  insolation: number | null
  equilibriumTemp: number | null
}

export interface SystemInfo {
  id: string
  file: SystemFile
  star: StarInfo | null
  starError: string | null
  habitableZone: { inner: number; outer: number } | null
  /** Collapse radius around the star, m. */
  collapse: number | null
  /** In tree order: each planet followed by its moons. */
  bodies: BodyInfo[]
}

const DEFAULT_ALBEDO: Record<BodyFile['class'], number> = {
  rocky: 0.3,
  ocean: 0.3,
  'ice-giant': 0.3,
  'gas-giant': 0.34,
  dwarf: 0.5,
  belt: 0.1,
  comet: 0.04
}

export function systemInfo(world: WorldData, env: WorldEnv, systemId: string): SystemInfo | null {
  const sys = world.entities.get(`${systemKind.kind}/${systemId}`)
  if (!sys || sys.value === undefined) return null
  const file = sys.value as SystemFile
  const starOrErr = systemStar(file, worldStars(world, env))
  const star = 'error' in starOrErr ? null : starOrErr
  const physics = entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined
  const foam = physics ? foamSettings(physics) : null
  const starMass = star?.physics.mass != null ? star.physics.mass * M_SUN : null
  const lum = star ? star.physics.luminosity * L_SUN : null

  const files = new Map(
    entitiesOf(world, bodyKind)
      .filter((e) => e.value.system === systemId)
      .map((e) => [e.id, e.value])
  )
  const infos = new Map<string, BodyInfo>()
  const resolving = new Set<string>()

  const resolve = (id: string): BodyInfo => {
    const done = infos.get(id)
    if (done) return done
    const b = files.get(id)!
    const mass = b.mass_mearth * M_EARTH
    const radius = b.radius_km * KM
    const info: BodyInfo = {
      id,
      name: b.name,
      cls: b.class,
      parent: b.parent ?? null,
      depth: 0,
      file: b,
      error: null,
      elements: null,
      mass,
      radius,
      albedo: b.albedo ?? DEFAULT_ALBEDO[b.class],
      tilt: b.rotation.tilt_deg * DEG,
      rotation: null,
      period: null,
      year: null,
      solarDay: null,
      hill: null,
      collapse: foam ? collapseRadius(mass, foam) : null,
      surfaceGravity: (G * mass) / (radius * radius) / 9.80665,
      escapeVelocity: Math.sqrt((2 * G * mass) / radius),
      density: mass / ((4 / 3) * Math.PI * radius ** 3) / 1000,
      insolation: null,
      equilibriumTemp: null
    }
    const fail = (m: string): BodyInfo => {
      info.error = m
      infos.set(id, info)
      return info
    }
    resolving.add(id)
    let parentMass: number | null
    let parentInfo: BodyInfo | null = null
    if (b.parent) {
      if (!files.has(b.parent)) {
        resolving.delete(id)
        return fail(
          world.entities.has(`${bodyKind.kind}/${b.parent}`)
            ? `Its parent "${b.parent}" is in another system.`
            : `Its parent "${b.parent}" does not exist.`
        )
      }
      if (resolving.has(b.parent)) {
        resolving.delete(id)
        return fail(`Its parents form a loop through "${b.parent}".`)
      }
      parentInfo = resolve(b.parent)
      parentMass = parentInfo.mass
      info.depth = parentInfo.depth + 1
    } else parentMass = starMass
    resolving.delete(id)
    if (parentMass === null)
      return fail(star ? "The star's mass is unknown; give it one in the system's star overrides." : (starOrErr as { error: string }).error)
    const o = b.orbit
    if ((o.a_au === undefined) === (o.a_km === undefined)) return fail('Its orbit needs exactly one of a_au and a_km.')
    const a = o.a_au !== undefined ? o.a_au * AU : o.a_km! * KM
    const mu = G * (parentMass + mass)
    info.elements = {
      a,
      e: o.e,
      i: o.i_deg * DEG,
      node: o.node_deg * DEG,
      peri: o.peri_deg * DEG,
      meanAnomaly: o.meanAnomaly_deg * DEG,
      epoch: o.epoch.t_s,
      mu
    }
    info.period = period(a, mu)
    info.hill = hillRadius(a, o.e, mass, parentMass)
    // The year is the orbital period of the planet this body belongs to.
    info.year = parentInfo ? parentInfo.year : info.period
    if (b.rotation.locked) info.rotation = info.period
    else if (b.rotation.period_h !== undefined && b.rotation.period_h !== 0) info.rotation = b.rotation.period_h * 3600
    else info.error = 'Its rotation needs a period, or "locked".'
    if (info.rotation !== null && info.year !== null) info.solarDay = solarDayLength(info.rotation, info.year)
    const topA = parentInfo ? topLevelA(parentInfo, infos) : a
    if (lum !== null && topA !== null) {
      info.insolation = insolation(lum, topA)
      info.equilibriumTemp = equilibriumTemperature(lum, topA, info.albedo)
    }
    infos.set(id, info)
    return info
  }

  for (const id of [...files.keys()].sort(compareStrings)) resolve(id)

  // Tree order: top-level bodies by semi-major axis, each followed by its moons.
  const children = new Map<string | null, BodyInfo[]>()
  for (const info of infos.values()) {
    const key = info.parent && infos.has(info.parent) && !infos.get(info.parent)!.error?.includes('loop') ? info.parent : null
    if (!children.has(key)) children.set(key, [])
    children.get(key)!.push(info)
  }
  const ordered: BodyInfo[] = []
  const seen = new Set<string>()
  const walk = (key: string | null): void => {
    const list = (children.get(key) ?? []).sort(
      (x, y) => (x.elements?.a ?? Infinity) - (y.elements?.a ?? Infinity) || compareStrings(x.id, y.id)
    )
    for (const c of list) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      ordered.push(c)
      walk(c.id)
    }
  }
  walk(null)
  for (const info of infos.values()) if (!seen.has(info.id)) ordered.push(info)

  return {
    id: systemId,
    file,
    star,
    starError: 'error' in starOrErr ? starOrErr.error : null,
    habitableZone: star ? habitableZone(star.physics.luminosity * L_SUN, star.physics.teff) : null,
    collapse: foam && starMass !== null ? collapseRadius(starMass, foam) : null,
    bodies: ordered
  }
}

function topLevelA(info: BodyInfo, infos: Map<string, BodyInfo>): number | null {
  let cur: BodyInfo | undefined = info
  for (let guard = 0; cur && cur.parent && guard < 100; guard++) cur = infos.get(cur.parent)
  return cur?.elements?.a ?? null
}

/** A body's position relative to the star at time t, m (the sum of its orbit and its parents'). */
export function bodyPosition(sys: SystemInfo, id: string, t: number): Vec3 | null {
  const byId = new Map(sys.bodies.map((b) => [b.id, b]))
  let pos: Vec3 = [0, 0, 0]
  let cur = byId.get(id)
  for (let guard = 0; cur; guard++) {
    if (!cur.elements || guard > 100) return null
    const r = stateAt(cur.elements, t).r
    pos = [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]]
    cur = cur.parent ? byId.get(cur.parent) : undefined
  }
  return pos
}

/** The day and year a planet-local calendar following this body should use. */
export function bodyCalendarLengths(
  world: WorldData,
  env: WorldEnv,
  bodyId: string
): { day_s: number; year_s: number } | { error: string } {
  const body = world.entities.get(`${bodyKind.kind}/${bodyId}`)
  if (!body || body.value === undefined) return { error: `It follows body "${bodyId}", which does not exist.` }
  const sys = systemInfo(world, env, (body.value as BodyFile).system)
  const info = sys?.bodies.find((b) => b.id === bodyId)
  if (!info) return { error: `It follows body "${bodyId}", whose system cannot be read.` }
  if (info.error) return { error: `It follows body "${info.name}": ${info.error}` }
  if (info.solarDay === null || info.year === null) return { error: `Body "${info.name}" has no day or year yet.` }
  if (!Number.isFinite(info.solarDay))
    return { error: `"${info.name}" always shows the same face to its star, so it has no solar day to count.` }
  return { day_s: info.solarDay, year_s: info.year }
}

/**
 * Longest and shortest daylight, as fractions of the solar day, at each
 * latitude from the equator to the pole, for a body with this axial tilt
 * (the Sun's centre above the horizon; an Earth-like atmosphere assumed).
 */
export function daylightByLatitude(tilt: number, step = 10): { lat: number; longest: number; shortest: number }[] {
  const out: { lat: number; longest: number; shortest: number }[] = []
  const dec = solarDeclination(Math.min(tilt, Math.PI - tilt), Math.PI / 2)
  for (let lat = 0; lat <= 90; lat += step) {
    out.push({ lat, longest: daylightFraction(lat * DEG, dec), shortest: daylightFraction(lat * DEG, -dec) })
  }
  return out
}

/** Insolation relative to Earth's. */
export function relativeInsolation(wm2: number): number {
  return wm2 / SOLAR_CONSTANT
}
