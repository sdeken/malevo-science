/**
 * Whereabouts: where someone or something is, and whether they could have got
 * there.
 *
 * - A traveller is a list of stops with arrival and departure dates. Each gap
 *   between stops is checked against the quickest trip the physics allows:
 *   door to door through the stars (`planRoute`: crawl out, foam legs within
 *   the leg limit and clear of nebulae, a stopover at each star on the way,
 *   crawl in), or, inside one system, a flip-and-burn between the two bodies
 *   at the cruise acceleration.
 * - A drifter coasts in a straight line from a place, at a time, at a speed.
 *   It reports where it is at any date and which stars it passes, and when.
 */
import { DEG, flipAndBurnTime, lightYears, type Point3 } from '@malevo/core'
import {
  bodyKind,
  cityKind,
  physicsKind,
  stationKind,
  systemKind,
  torchSettings,
  type DrifterFile,
  type PhysicsSettings,
  type PlaceFile,
  type TravellerFile
} from './kinds'
import type { WorldEnv } from './env'
import { entitiesOf, type WorldData } from './load'
import { planRoute, routeWorld } from './routes'
import { bodyPosition, systemInfo, worldStars } from './systems'

const YEAR = 365.25 * 86400
const C_KMS = 299792.458

/** A place, resolved: the node it travels from, its system and body if any, and a name. */
export interface ResolvedPlace {
  node: string
  system: string | null
  body: string | null
  name: string
  pos: Point3 | null
}

const nameOf = (world: WorldData, kind: string, id: string): string =>
  String((world.entities.get(`${kind}/${id}`)?.value as { name?: string } | undefined)?.name ?? id)

export function resolvePlace(world: WorldData, env: WorldEnv, p: PlaceFile): ResolvedPlace | { error: string } {
  const rw = routeWorld(world, env)
  let body = p.body ?? null
  let cityName: string | null = null
  if (p.city) {
    const c = world.entities.get(`${cityKind.kind}/${p.city}`)?.value as { body?: string; name?: string } | undefined
    if (!c) return { error: `There is no city "${p.city}".` }
    body = c.body ?? null
    cityName = c.name ?? p.city
  }
  let system = p.system ?? null
  if (body) {
    const b = world.entities.get(`${bodyKind.kind}/${body}`)?.value as { system?: string } | undefined
    if (!b) return { error: `There is no body "${body}".` }
    system = b.system ?? system
  }
  const at = (node: string, name: string): ResolvedPlace => ({ node, system, body, name, pos: rw.node(node).pos })
  if (system) {
    if (!world.entities.has(`${systemKind.kind}/${system}`)) return { error: `There is no system "${system}".` }
    const parts = [cityName, body ? nameOf(world, bodyKind.kind, body) : null, nameOf(world, systemKind.kind, system)].filter(Boolean)
    return at(`system:${system}`, [...new Set(parts)].join(', '))
  }
  if (p.station) {
    if (!world.entities.has(`${stationKind.kind}/${p.station}`)) return { error: `There is no station "${p.station}".` }
    return at(`station:${p.station}`, nameOf(world, stationKind.kind, p.station))
  }
  if (p.star) {
    const s = worldStars(world, env).get(p.star)
    if (!s) return { error: `Star "${p.star}" isn't in the atlas.` }
    return at(`star:${p.star}`, s.name ?? p.star)
  }
  return { error: 'No place given.' }
}

export interface Hop {
  /** The quickest trip, s. */
  seconds: number
  /** Where it stops on the way (names), for a trip between the stars. */
  via: string[]
  how: 'none' | 'in-system' | 'foam'
}

/** The quickest trip from one place to another, leaving at `t` (in-system positions are taken then). */
export function quickestHop(world: WorldData, env: WorldEnv, a: ResolvedPlace, b: ResolvedPlace, t: number): Hop | { error: string } {
  if (a.node === b.node) {
    if (!a.body || !b.body || a.body === b.body || !a.system) return { seconds: 0, via: [], how: 'none' }
    const physics = (entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined) ?? null
    if (!physics) return { error: 'The world has no physics settings.' }
    const sys = systemInfo(world, env, a.system)
    const pa = sys && bodyPosition(sys, a.body, t)
    const pb = sys && bodyPosition(sys, b.body, t)
    if (!pa || !pb) return { error: 'Could not place the bodies.' }
    const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
    return { seconds: flipAndBurnTime(d, torchSettings(physics).cruiseAccel), via: [], how: 'in-system' }
  }
  const plan = planRoute(world, env, a.node, b.node)
  if (!plan) return { error: `No route from ${a.name} to ${b.name} within the leg limit (or the physics settings are missing).` }
  const rw = routeWorld(world, env)
  const via = plan.waypoints.slice(1, -1).map((w) => {
    const node = w.system ? `system:${w.system}` : w.station ? `station:${w.station}` : `star:${w.star}`
    return rw.node(node).name
  })
  return { seconds: plan.duration, via, how: 'foam' }
}

export interface StopReport {
  name: string
  arrive: number | null
  depart: number | null
  note?: string
  error?: string
}

export interface GapReport {
  from: number
  to: number
  /** Time between leaving one stop and arriving at the next, s; null when a date is missing. */
  available: number | null
  /** The quickest possible trip, s; null when it can't be worked out. */
  needed: number | null
  via: string[]
  how: Hop['how'] | null
  /** ok, tight (less than a tenth to spare), impossible, or unknown. */
  verdict: 'ok' | 'tight' | 'impossible' | 'unknown'
  error?: string
}

export interface TravellerReport {
  stops: StopReport[]
  gaps: GapReport[]
  /** Where they are at `now`, in words. */
  now: string
}

export function travellerReport(world: WorldData, env: WorldEnv, file: TravellerFile, now: number): TravellerReport {
  const places = file.stops.map((s) => resolvePlace(world, env, s.place))
  const stops: StopReport[] = file.stops.map((s, i) => {
    const p = places[i]
    return {
      name: 'error' in p ? '?' : p.name,
      arrive: s.arrive?.t_s ?? null,
      depart: s.depart?.t_s ?? null,
      note: s.note,
      error: 'error' in p ? p.error : undefined
    }
  })
  const gaps: GapReport[] = []
  for (let i = 0; i + 1 < stops.length; i++) {
    const leave = stops[i].depart ?? stops[i].arrive
    const reach = stops[i + 1].arrive ?? stops[i + 1].depart
    const a = places[i]
    const b = places[i + 1]
    const gap: GapReport = { from: i, to: i + 1, available: null, needed: null, via: [], how: null, verdict: 'unknown' }
    if (leave !== null && reach !== null) gap.available = reach - leave
    if ('error' in a || 'error' in b) gap.error = 'error' in a ? a.error : (b as { error: string }).error
    else {
      const hop = quickestHop(world, env, a, b, leave ?? reach ?? 0)
      if ('error' in hop) gap.error = hop.error
      else {
        gap.needed = hop.seconds
        gap.via = hop.via
        gap.how = hop.how
      }
    }
    if (gap.available !== null && gap.needed !== null)
      gap.verdict = gap.available < gap.needed ? 'impossible' : gap.available < gap.needed * 1.1 ? 'tight' : 'ok'
    gaps.push(gap)
  }
  return { stops, gaps, now: whereAt(stops, now) }
}

function whereAt(stops: StopReport[], t: number): string {
  if (!stops.length) return 'Nowhere yet.'
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    const from = s.arrive ?? s.depart
    const to = s.depart ?? s.arrive
    if (from !== null && to !== null && t >= from && t <= to) return `At ${s.name}.`
    const next = stops[i + 1]
    const nextFrom = next ? (next.arrive ?? next.depart) : null
    if (to !== null && nextFrom !== null && t > to && t < nextFrom) return `On the way from ${s.name} to ${next.name}.`
  }
  const first = stops[0].arrive ?? stops[0].depart
  if (first !== null && t < first) return `Not yet at ${stops[0].name} (the first stop).`
  const lastStop = stops[stops.length - 1]
  const last = lastStop.depart ?? lastStop.arrive
  if (last !== null && t > last)
    return lastStop.depart !== null ? `Left ${lastStop.name}; the record ends there.` : `At ${lastStop.name} (the last stop).`
  return 'Unknown: some stops have no dates.'
}

// ---- drifters ----

/** ICRS (J2000 equatorial) to galactic rotation. */
const EQ_TO_GAL = [
  [-0.0548755604, -0.87343709, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762]
]

export interface DriftPass {
  star: string
  name: string
  system: string | null
  /** When it is closest. */
  t: number
  /** How far it has come by then, ly. */
  along_ly: number
  /** Closest approach, ly. */
  miss_ly: number
  /** Inside the cone of uncertainty at that distance. */
  inCone: boolean
}

export interface DriftReport {
  from: string
  speed_c: number
  /** Light-years a year. */
  lyPerYear: number
  /** Where it is at `now`, ly, galactic; null before it leaves. */
  pos: Point3 | null
  /** How far it has come at `now`, ly. */
  travelled_ly: number
  /** How wide the cone is at `now`, ly (each side). */
  spread_ly: number
  /** The nearest star at `now`. */
  nearest: { name: string; ly: number } | null
  passes: DriftPass[]
}

function unit(v: Point3): Point3 | null {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : null
}

export function driftDirection(world: WorldData, env: WorldEnv, file: DrifterFile, from: Point3): Point3 | { error: string } {
  const h = file.heading
  if (h.toward) {
    const p = resolvePlace(world, env, h.toward)
    if ('error' in p) return p
    if (!p.pos) return { error: `${p.name} has no position.` }
    return unit([p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]]) ?? { error: 'It is heading toward where it already is.' }
  }
  if (h.l_deg !== undefined && h.b_deg !== undefined) {
    const l = h.l_deg * DEG
    const b = h.b_deg * DEG
    return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]
  }
  if (h.ra_deg !== undefined && h.dec_deg !== undefined) {
    const a = h.ra_deg * DEG
    const d = h.dec_deg * DEG
    const e = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
    const g = EQ_TO_GAL.map((row) => row[0] * e[0] + row[1] * e[1] + row[2] * e[2])
    return [g[0], g[1], g[2]]
  }
  return { error: 'Give a heading: toward a place, a galactic longitude and latitude, or a right ascension and declination.' }
}

/**
 * Where a drifter is at `now`, and every star it passes within `passWithin_ly`
 * (plus the cone's spread there) in its first `horizon_yr` years.
 */
export function driftReport(
  world: WorldData,
  env: WorldEnv,
  file: DrifterFile,
  now: number,
  opts: { horizon_yr?: number; passWithin_ly?: number } = {}
): DriftReport | { error: string } {
  const from = resolvePlace(world, env, file.from)
  if ('error' in from) return from
  if (!from.pos) return { error: `${from.name} has no position in the atlas.` }
  const dir = driftDirection(world, env, file, from.pos)
  if ('error' in dir) return dir
  const p0 = from.pos
  const lyPerYear = file.speed_kms / C_KMS
  const tan = Math.tan((file.cone_deg ?? 0) * DEG)
  const t0 = file.at.t_s
  const travelled = Math.max(0, ((now - t0) / YEAR) * lyPerYear)
  const pos: Point3 | null = now >= t0 ? [p0[0] + dir[0] * travelled, p0[1] + dir[1] * travelled, p0[2] + dir[2] * travelled] : null
  const stars = worldStars(world, env)
  const originStar = from.node.startsWith('star:')
    ? from.node.slice(5)
    : from.system
      ? (world.entities.get(`${systemKind.kind}/${from.system}`)?.value as { star?: string } | undefined)?.star
      : undefined
  let nearest: DriftReport['nearest'] = null
  if (pos) {
    for (let r = 2; r <= 64 && !nearest; r *= 2) {
      let best: { name: string; ly: number } | null = null
      for (const s of stars.near(pos, r)) {
        if (s.id === originStar) continue
        const d = lightYears(pos, s.pos as Point3)
        if (!best || d < best.ly) best = { name: s.name ?? s.id, ly: d }
      }
      nearest = best
    }
  }

  // Stars along the path: search in steps along the line, wide enough for the cone.
  const horizon = opts.horizon_yr ?? 5000
  const within = opts.passWithin_ly ?? 1
  const length = horizon * lyPerYear
  const systemsByStar = new Map<string, { id: string; name: string }>()
  for (const e of entitiesOf(world, systemKind)) systemsByStar.set(e.value.star, { id: e.id, name: e.value.name })
  const found = new Map<string, DriftPass>()
  const maxSteps = 4000
  const step = Math.max(within, length / maxSteps)
  for (let s = 0; s <= length + step; s += step) {
    const spread = Math.min(s * tan, 50)
    const r = within + spread + step
    const c: Point3 = [p0[0] + dir[0] * s, p0[1] + dir[1] * s, p0[2] + dir[2] * s]
    for (const st of stars.near(c, r)) {
      if (found.has(st.id) || st.id === originStar) continue
      const rel: Point3 = [st.pos[0] - p0[0], st.pos[1] - p0[1], st.pos[2] - p0[2]]
      const along = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2]
      if (along <= 0 || along > length) continue
      const miss = Math.hypot(rel[0] - dir[0] * along, rel[1] - dir[1] * along, rel[2] - dir[2] * along)
      const cone = along * tan
      if (miss > within + cone) continue
      const sys = systemsByStar.get(st.id)
      found.set(st.id, {
        star: st.id,
        name: sys?.name ?? st.name ?? st.id,
        system: sys?.id ?? null,
        t: t0 + (along / lyPerYear) * YEAR,
        along_ly: along,
        miss_ly: miss,
        inCone: miss <= cone
      })
    }
  }
  const passes = [...found.values()].sort((a, b) => a.t - b.t).slice(0, 60)
  return {
    from: from.name,
    speed_c: file.speed_kms / C_KMS,
    lyPerYear,
    pos,
    travelled_ly: travelled,
    spread_ly: travelled * tan,
    nearest,
    passes
  }
}

export function newTraveller(name: string): TravellerFile {
  return { name, stops: [] }
}

export function newDrifter(name: string, from: PlaceFile, at: { t_s: number; cal?: string; text?: string }): DrifterFile {
  return { name, from, at, speed_kms: 1000, heading: { l_deg: 0, b_deg: 0 } }
}
