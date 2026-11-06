/**
 * The sky from a point on a body, and approaches into a system, worked out
 * from the files (docs/PLAN.md §6.3, §7.5, Phase 6). Nothing is stored.
 *
 * Every direction here is in the system's frame: the plane its orbits are
 * measured from, oriented in the galaxy by the system's `frame` (by default
 * the galactic plane). Star positions and route directions come from the
 * atlas in galactic coordinates and are turned into that frame, so the stars,
 * the bodies and the torches all share one sky.
 *
 * Torches are the route network's own numbers (principle P2): for each
 * service through this system, ships arrive at the service's rate and spend
 * the node's crawl time crawling in (or out), so λ × crawl time of them are
 * under way, placed along the line from the collapse edge toward the route's
 * neighbour to the port.
 */
import {
  AU,
  DAY,
  DEG,
  LY,
  M_SUN,
  SOLAR_CONSTANT,
  approachAlong,
  compareStrings,
  crawlProgress,
  hashString,
  localFrame,
  lockedMeridian,
  marginRange,
  meridianAt,
  normalize,
  offsetLine,
  pointMagnitude,
  reflectedMagnitude,
  shipsUnderway,
  spinAxis,
  starMagnitudeAt,
  torchLuminosity,
  type Atmosphere,
  type LocalFrame,
  type MassPoint,
  type Spin,
  type Vec3
} from '@malevo/core'
import type { WorldEnv } from './env'
import { foamSettings, physicsKind, torchLightSettings, torchSettings, viewpointKind, type PhysicsSettings, type SystemFile } from './kinds'
import { entitiesOf, type WorldData } from './load'
import { allRoutes, routeWorld } from './routes'
import { bodyPosition, systemInfo, worldStars, type BodyInfo, type SystemInfo } from './systems'

// ---- frames ----

/** Rows of the rotation taking galactic vectors into the system's frame. */
export function systemFrame(file: Pick<SystemFile, 'frame'>): { x: Vec3; y: Vec3; z: Vec3 } {
  const l = (file.frame?.poleL_deg ?? 0) * DEG
  const b = (file.frame?.poleB_deg ?? 90) * DEG
  const z: Vec3 = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]
  const n: Vec3 = [-z[1], z[0], 0] // galactic north × pole: the ascending node
  const len = Math.hypot(n[0], n[1])
  const x: Vec3 = len < 1e-9 ? [1, 0, 0] : [n[0] / len, n[1] / len, 0]
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  const a = (file.frame?.zero_deg ?? 0) * DEG
  if (!a) return { x, y, z }
  const c = Math.cos(a)
  const s = Math.sin(a)
  return {
    x: [c * x[0] + s * y[0], c * x[1] + s * y[1], c * x[2] + s * y[2]],
    y: [c * y[0] - s * x[0], c * y[1] - s * x[1], c * y[2] - s * x[2]],
    z
  }
}

export function galacticToSystem(f: ReturnType<typeof systemFrame>, g: Vec3): Vec3 {
  return [
    g[0] * f.x[0] + g[1] * f.x[1] + g[2] * f.x[2],
    g[0] * f.y[0] + g[1] * f.y[1] + g[2] * f.y[2],
    g[0] * f.z[0] + g[1] * f.z[1] + g[2] * f.z[2]
  ]
}

/** A body's spin axis, with the defaults for what its file leaves out. */
export function bodySpin(b: BodyInfo): Spin | null {
  if (!b.elements) return null
  return spinAxis(b.elements, b.tilt, (b.file.rotation.equinox_deg ?? 0) * DEG)
}

/** The prime meridian's direction at instant t. */
export function bodyMeridian(sys: SystemInfo, b: BodyInfo, spin: Spin, t: number): Vec3 | null {
  if (b.file.rotation.locked) {
    const r = bodyPosition(sys, b.id, t)
    const parent = b.parent ? bodyPosition(sys, b.parent, t) : [0, 0, 0]
    if (!r || !parent) return null
    return lockedMeridian(spin, [parent[0] - r[0], parent[1] - r[1], parent[2] - r[2]])
  }
  if (b.rotation === null) return null
  const W = (b.file.rotation.meridian_deg ?? 0) * DEG + (2 * Math.PI * t) / b.rotation
  return meridianAt(spin, W)
}

/** A body's air as the sky model takes it; null when it has none. */
export function bodyAtmosphere(b: BodyInfo): Atmosphere | null {
  const a = b.file.atmosphere
  if (!a || a.pressure_atm <= 0) return null
  const g = Math.max(b.surfaceGravity, 1e-3)
  return {
    radius: b.radius,
    column: a.pressure_atm / g,
    scaleHeight: a.scaleHeight_km !== undefined ? a.scaleHeight_km * 1000 : 8000 / g,
    light: (b.insolation ?? SOLAR_CONSTANT) / SOLAR_CONSTANT
  }
}

/** Where a system's ships dock, m from the star, at instant t, given the direction they come and go along. */
function portAt(sys: SystemInfo, t: number, along: Vec3): Vec3 | null {
  if (sys.file.port) return bodyPosition(sys, sys.file.port, t)
  if (!sys.star) return null
  const d = AU * Math.sqrt(sys.star.physics.luminosity)
  return [along[0] * d, along[1] * d, along[2] * d]
}

/** Every body as a point mass, and the star, at instant t (for the foam). */
export function massPoints(sys: SystemInfo, t: number): MassPoint[] {
  const out: MassPoint[] = []
  if (sys.star?.physics.mass != null) out.push({ pos: [0, 0, 0], mass: sys.star.physics.mass * M_SUN })
  for (const b of sys.bodies) {
    const p = bodyPosition(sys, b.id, t)
    if (p && b.cls !== 'belt') out.push({ pos: p, mass: b.mass })
  }
  return out
}

/** The star's absolute visual magnitude: the catalogue's, unless its luminosity is overridden. */
function starAbsMag(sys: SystemInfo): number {
  if (!sys.star) return 4.83
  if (sys.star.overridden.includes('luminosity_lsun')) return 4.83 - 2.5 * Math.log10(sys.star.physics.luminosity)
  return sys.star.record.absmag
}

// ---- the stars from a system ----

export interface SkyStars {
  ids: string[]
  /** Unit directions in the system frame, x y z per star. */
  dir: Float32Array
  mag: Float32Array
  ci: Float32Array
  names: Record<number, string>
}

/**
 * Every catalogue star brighter than `maxMag` as seen from the system's star,
 * plus generated stars within `nearLy`, with directions in the system frame.
 * The system's own star is left out.
 */
export function skyStars(world: WorldData, env: WorldEnv, systemId: string, maxMag = 7, nearLy = 40): SkyStars | null {
  const sys = systemInfo(world, env, systemId)
  if (!sys?.star) return null
  const here = sys.star.record.pos
  const frame = systemFrame(sys.file)
  const stars = worldStars(world, env)
  const seen = new Set<string>([sys.star.record.id])
  const list: { id: string; dir: Vec3; mag: number; ci: number; name: string | null }[] = []
  const consider = (s: { id: string; pos: [number, number, number]; absmag: number; ci: number; name: string | null }): void => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    const g: Vec3 = [s.pos[0] - here[0], s.pos[1] - here[1], s.pos[2] - here[2]]
    const d = Math.hypot(g[0], g[1], g[2])
    if (d <= 0) return
    const mag = starMagnitudeAt(s.absmag, d * LY)
    if (mag > maxMag) return
    list.push({ id: s.id, dir: galacticToSystem(frame, [g[0] / d, g[1] / d, g[2] / d]), mag, ci: s.ci, name: s.name })
  }
  for (const s of env.catalog?.stars ?? []) consider(s)
  for (const s of stars.near([here[0], here[1], here[2]], nearLy)) consider(s)
  list.sort((a, b) => a.mag - b.mag || compareStrings(a.id, b.id))
  const dir = new Float32Array(list.length * 3)
  const mag = new Float32Array(list.length)
  const ci = new Float32Array(list.length)
  const names: Record<number, string> = {}
  list.forEach((s, i) => {
    dir.set(s.dir, i * 3)
    mag[i] = s.mag
    ci[i] = s.ci
    if (s.name) names[i] = s.name
  })
  return { ids: list.map((s) => s.id), dir, mag, ci, names }
}

// ---- the scene at an instant ----

export interface Viewpoint {
  body: string
  lat_deg: number
  lon_deg: number
  elevation_m?: number
}

export interface SkyBody {
  id: string
  name: string
  /** Unit direction from the observer, system frame. */
  dir: Vec3
  distance: number
  mag: number
  /** Angular radius, radians. */
  radius: number
  /** Star–body–observer angle, radians (0 is full). */
  phase: number
  /** Unit direction from the body to the star (which side is lit). */
  lit: Vec3
}

export interface SkyTorch {
  route: string
  service: number
  /** The node the ship came from or is going to. */
  neighbour: string
  kind: 'in' | 'out'
  dir: Vec3
  distance: number
  mag: number
  /** Seconds into its crawl. */
  tau: number
  /** Within the governor's cutoff of the port, where the torch must be off (the insertion is not modelled). */
  dark: boolean
}

export interface SkyRouteSummary {
  route: string
  neighbour: string
  kind: 'in' | 'out'
  perDay: number
  /** Crawl time, s. */
  crawl: number
  /** λ × crawl time: torches under way on average (Little's law). */
  expected: number
  /** Torches under way at this instant. */
  shown: number
}

export interface SkyScene {
  system: string
  body: string
  t: number
  /** The observer's local frame (x east, y north, z up), as system-frame vectors. */
  frame: LocalFrame
  /** Observer position, m from the star. */
  observer: Vec3
  sun: { dir: Vec3; mag: number; radius: number }
  bodies: SkyBody[]
  torches: SkyTorch[]
  routes: SkyRouteSummary[]
  atmosphere: Atmosphere | null
  /** Galactic north pole and centre, system frame (for the Milky Way). */
  galPole: Vec3
  galCentre: Vec3
}

export function skyScene(world: WorldData, env: WorldEnv, vp: Viewpoint, t: number): SkyScene | { error: string } {
  const bodyEntity = world.entities.get(`body/${vp.body}`)?.value as { system?: string } | undefined
  if (!bodyEntity?.system) return { error: `There is no body "${vp.body}".` }
  const sys = systemInfo(world, env, bodyEntity.system)
  if (!sys) return { error: `There is no system "${bodyEntity.system}".` }
  if (!sys.star) return { error: sys.starError ?? 'The system has no star.' }
  const b = sys.bodies.find((x) => x.id === vp.body)
  if (!b || b.error) return { error: b?.error ?? `There is no body "${vp.body}".` }
  const spin = bodySpin(b)
  const centre = bodyPosition(sys, b.id, t)
  const meridian = spin ? bodyMeridian(sys, b, spin, t) : null
  if (!spin || !centre || !meridian) return { error: `${b.name}'s orbit or rotation cannot be worked out.` }
  const frame = localFrame(spin.pole, meridian, vp.lat_deg * DEG, vp.lon_deg * DEG)
  const h = b.radius + (vp.elevation_m ?? 0)
  const observer: Vec3 = [centre[0] + frame.up[0] * h, centre[1] + frame.up[1] * h, centre[2] + frame.up[2] * h]
  const sframe = systemFrame(sys.file)
  const absMag = starAbsMag(sys)
  const starDist = Math.hypot(...observer)

  const sun = {
    dir: normalize([-observer[0], -observer[1], -observer[2]]),
    mag: starMagnitudeAt(absMag, starDist),
    radius: Math.asin(Math.min(1, (sys.star.physics.radius * 6.957e8) / starDist))
  }

  const bodies: SkyBody[] = []
  for (const o of sys.bodies) {
    if (o.id === b.id || o.cls === 'belt') continue
    const p = bodyPosition(sys, o.id, t)
    if (!p) continue
    const rel: Vec3 = [p[0] - observer[0], p[1] - observer[1], p[2] - observer[2]]
    const d = Math.hypot(...rel)
    const dir: Vec3 = [rel[0] / d, rel[1] / d, rel[2] / d]
    const rStar = Math.hypot(...p)
    const lit: Vec3 = [-p[0] / rStar, -p[1] / rStar, -p[2] / rStar]
    const phase = Math.acos(Math.max(-1, Math.min(1, -(lit[0] * dir[0] + lit[1] * dir[1] + lit[2] * dir[2]))))
    const mag = reflectedMagnitude(starMagnitudeAt(absMag, rStar), o.radius, o.albedo, d, phase)
    bodies.push({ id: o.id, name: o.name, dir, distance: d, mag, radius: Math.asin(Math.min(1, o.radius / d)), phase, lit })
  }

  // ---- torches, from the routes ----
  const physics = entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined
  const torches: SkyTorch[] = []
  const summary = new Map<string, SkyRouteSummary>()
  if (physics && sys.collapse !== null) {
    const rw = routeWorld(world, env)
    const me = `system:${sys.id}`
    const node = rw.node(me)
    const light = torchLightSettings(physics)
    const accel = torchSettings(physics).cruiseAccel
    const cutoff = torchSettings(physics).governorCutoff
    const here = sys.star.record.pos
    const towards = (other: string): Vec3 | null => {
      const p = rw.node(other).pos
      if (!p) return null
      const g: Vec3 = [p[0] - here[0], p[1] - here[1], p[2] - here[2]]
      const d = Math.hypot(...g)
      return d > 0 ? galacticToSystem(sframe, [g[0] / d, g[1] / d, g[2] / d]) : null
    }
    for (const r of allRoutes(world, env)) {
      for (const s of r.services) {
        if (s.error || s.perDay <= 0) continue
        s.stops.forEach((stop, k) => {
          if (stop !== me) return
          for (const kind of ['in', 'out'] as const) {
            const other = kind === 'in' ? s.stops[k - 1] : s.stops[k + 1]
            if (!other) continue
            const u = towards(other)
            const duration = kind === 'in' ? node.crawlIn : node.crawlOut
            const L = node.crawlDistance
            if (!u || duration === null || L === null) continue
            const key = `${r.id}|${other}|${kind}`
            const sum = summary.get(key) ?? { route: r.id, neighbour: other, kind, perDay: 0, crawl: duration, expected: 0, shown: 0 }
            sum.perDay += s.perDay
            sum.expected += (s.perDay * duration) / DAY
            summary.set(key, sum)
            if (duration <= 0 || L <= 0) continue
            const edge: Vec3 = [u[0] * sys.collapse!, u[1] * sys.collapse!, u[2] * sys.collapse!]
            const port = portAt(sys, t, u)
            if (!port) continue
            const [from, to] = kind === 'in' ? [edge, port] : [port, edge]
            const path: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
            const phase = hashString(`${r.id}#${s.index}:${k}:${kind}`) / 0x100000000
            for (const tau of shipsUnderway(s.perDay, duration, t, phase)) {
              const { s: dist, accelerating } = crawlProgress(kind, tau, L, accel)
              const f = Math.min(1, dist / L)
              const span = Math.hypot(...path)
              const fromPort = kind === 'in' ? (1 - f) * span : f * span
              const pos: Vec3 = [from[0] + path[0] * f, from[1] + path[1] * f, from[2] + path[2] * f]
              const rel: Vec3 = [pos[0] - observer[0], pos[1] - observer[1], pos[2] - observer[2]]
              const d = Math.hypot(...rel)
              const dir: Vec3 = [rel[0] / d, rel[1] / d, rel[2] / d]
              // The exhaust points against the thrust: back along the path while accelerating, ahead while braking.
              const ex = accelerating ? -1 : 1
              const facing = ex * -(path[0] * dir[0] + path[1] * dir[1] + path[2] * dir[2])
              torches.push({
                route: r.id,
                service: s.index,
                neighbour: other,
                kind,
                dir,
                distance: d,
                mag: fromPort < cutoff ? Infinity : pointMagnitude(torchLuminosity(light, facing), d),
                tau,
                dark: fromPort < cutoff
              })
              sum.shown++
            }
          }
        })
      }
    }
  }

  return {
    system: sys.id,
    body: b.id,
    t,
    frame,
    observer,
    sun,
    bodies,
    torches,
    routes: [...summary.values()].sort(
      (x, y) => compareStrings(x.route, y.route) || compareStrings(x.neighbour, y.neighbour) || compareStrings(x.kind, y.kind)
    ),
    atmosphere: bodyAtmosphere(b),
    galPole: galacticToSystem(sframe, [0, 0, 1]),
    galCentre: galacticToSystem(sframe, [1, 0, 0])
  }
}

export function viewpoints(world: WorldData): { id: string; name: string; vp: Viewpoint }[] {
  return entitiesOf(world, viewpointKind)
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((e) => ({ id: e.id, name: e.value.name, vp: e.value }))
}

// ---- approach ----

export interface ApproachQuery {
  system: string
  /** The node ships come from (a route neighbour), or a direction in the system frame. */
  from: string | Vec3
  t: number
  /** Aim offset in the aim plane, m. */
  offset?: [number, number]
  /** Navigator's margin, m. */
  margin?: number
}

export interface ApproachInfo {
  /** Unit vector from the star toward where ships come from. */
  back: Vec3
  port: Vec3
  drop: Vec3 | null
  /** Drop distance from the star, m. */
  dropRadius: number | null
  crawlDistance: number | null
  crawl: number | null
  /** The same line with only the star: what the bodies' tides change. */
  starOnly: { dropRadius: number | null; crawl: number | null }
  /** 1 − crawl / star-only crawl: how much the lee saves. */
  leeGain: number | null
  margin: { best: number | null; worst: number | null } | null
}

interface ApproachSetup {
  run(
    t: number,
    offset?: [number, number],
    starOnly?: boolean
  ): ApproachInfo['starOnly'] & { drop: Vec3 | null; crawlDistance: number | null }
  back: Vec3
  port(t: number): Vec3 | null
  reach: number
  margin(t: number, m: number, offset?: [number, number]): { best: number | null; worst: number | null }
}

function approachSetup(world: WorldData, env: WorldEnv, q: Pick<ApproachQuery, 'system' | 'from'>): ApproachSetup | { error: string } {
  const sys = systemInfo(world, env, q.system)
  if (!sys?.star) return { error: sys?.starError ?? `There is no system "${q.system}".` }
  if (sys.star.physics.mass === null) return { error: "The star's mass is unknown." }
  const physics = entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined
  if (!physics || sys.collapse === null) return { error: 'The approach needs settings/physics.json.' }
  let back: Vec3
  if (typeof q.from === 'string') {
    const p = routeWorld(world, env).node(q.from).pos
    const here = sys.star.record.pos
    if (!p) return { error: `"${q.from}" has no position.` }
    const g: Vec3 = [p[0] - here[0], p[1] - here[1], p[2] - here[2]]
    const d = Math.hypot(...g)
    if (d <= 0) return { error: 'Ships cannot come from the system itself.' }
    back = galacticToSystem(systemFrame(sys.file), [g[0] / d, g[1] / d, g[2] / d])
  } else back = normalize(q.from)
  const foam = foamSettings(physics)
  // The route planner's crawl is idealized: the cruise acceleration, tanks that never run short (the trip planner flies a real ship).
  const accel = torchSettings(physics).cruiseAccel
  const reach = 2.5 * sys.collapse
  const starPoint: MassPoint[] = [{ pos: [0, 0, 0], mass: sys.star.physics.mass * M_SUN }]
  const port = (t: number): Vec3 | null => portAt(sys, t, back)
  const runLine = (t: number, offset: [number, number] = [0, 0], starOnly = false, line?: { aim: Vec3; back: Vec3 }) => {
    const p = port(t)
    if (!p) return { drop: null, crawlDistance: null, crawl: null, dropRadius: null }
    const l = line ?? offsetLine({ aim: p, back }, offset[0], offset[1])
    const r = approachAlong(l, starOnly ? starPoint : massPoints(sys, t), foam, p, accel, reach)
    return { ...r, dropRadius: r.drop ? Math.hypot(...r.drop) : null }
  }
  return {
    back,
    port,
    reach,
    run: runLine,
    margin(t, m, offset = [0, 0]) {
      const p = port(t)
      if (!p) return { best: null, worst: null }
      return marginRange(offsetLine({ aim: p, back }, offset[0], offset[1]), m, (l) => runLine(t, undefined, false, l))
    }
  }
}

export function approachInfo(world: WorldData, env: WorldEnv, q: ApproachQuery): ApproachInfo | { error: string } {
  const s = approachSetup(world, env, q)
  if ('error' in s) return s
  const r = s.run(q.t, q.offset)
  const base = s.run(q.t, q.offset, true)
  return {
    back: s.back,
    port: s.port(q.t)!,
    drop: r.drop,
    dropRadius: r.dropRadius,
    crawlDistance: r.crawlDistance,
    crawl: r.crawl,
    starOnly: { dropRadius: base.dropRadius, crawl: base.crawl },
    leeGain: r.crawl !== null && base.crawl ? 1 - r.crawl / base.crawl : null,
    margin: q.margin ? s.margin(q.t, q.margin, q.offset) : null
  }
}

/** Crawl time over a grid of aim offsets, ±extent m on each axis, n×n (row-major, y from −extent up). Null where the foam holds. */
export function approachMap(
  world: WorldData,
  env: WorldEnv,
  q: Pick<ApproachQuery, 'system' | 'from' | 't'>,
  extent: number,
  n = 41
): { crawl: (number | null)[]; extent: number; n: number } | { error: string } {
  const s = approachSetup(world, env, q)
  if ('error' in s) return s
  const crawl: (number | null)[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const dx = (2 * i) / (n - 1) - 1
      const dy = (2 * j) / (n - 1) - 1
      crawl.push(s.run(q.t, [dx * extent, dy * extent]).crawl)
    }
  return { crawl, extent, n }
}

/** Dead-on crawl, and the star-only crawl, at `samples` instants from t0 to t1: where the lee windows are. */
export function approachSeries(
  world: WorldData,
  env: WorldEnv,
  q: Pick<ApproachQuery, 'system' | 'from'>,
  t0: number,
  t1: number,
  samples = 120
): { t: number[]; crawl: (number | null)[]; starOnly: (number | null)[] } | { error: string } {
  const s = approachSetup(world, env, q)
  if ('error' in s) return s
  const t: number[] = []
  const crawl: (number | null)[] = []
  const starOnly: (number | null)[] = []
  for (let k = 0; k < samples; k++) {
    const tk = t0 + ((t1 - t0) * k) / Math.max(1, samples - 1)
    t.push(tk)
    crawl.push(s.run(tk).crawl)
    starOnly.push(s.run(tk, undefined, true).crawl)
  }
  return { t, crawl, starOnly }
}

/**
 * The prime-meridian angle (rotation.meridian_deg) that puts the star due
 * south or north, on the meridian of longitude `lon_deg`, at instant t: so the
 * world's clock reads local noon there then. Null for a locked body or one
 * whose orbit or rotation cannot be worked out.
 */
export function meridianForNoon(world: WorldData, env: WorldEnv, body: string, lon_deg: number, t: number): number | null {
  const sysId = (world.entities.get(`body/${body}`)?.value as { system?: string } | undefined)?.system
  const sys = sysId ? systemInfo(world, env, sysId) : null
  const b = sys?.bodies.find((x) => x.id === body)
  if (!sys || !b || b.file.rotation.locked || b.rotation === null) return null
  const spin = bodySpin(b)
  const pos = bodyPosition(sys, b.id, t)
  if (!spin || !pos) return null
  // The star's direction projected into the equator, as an angle in the (ref, pole × ref) basis.
  const e1 = meridianAt(spin, 0)
  const e2: Vec3 = [
    spin.pole[1] * e1[2] - spin.pole[2] * e1[1],
    spin.pole[2] * e1[0] - spin.pole[0] * e1[2],
    spin.pole[0] * e1[1] - spin.pole[1] * e1[0]
  ]
  const s: Vec3 = [-pos[0], -pos[1], -pos[2]]
  const phi = Math.atan2(s[0] * e2[0] + s[1] * e2[1] + s[2] * e2[2], s[0] * e1[0] + s[1] * e1[1] + s[2] * e1[2])
  const W0 = phi - lon_deg * DEG - (2 * Math.PI * t) / b.rotation
  const deg = ((((W0 / DEG) % 360) + 360) % 360) as number
  return Math.round(deg * 1e4) / 1e4
}
