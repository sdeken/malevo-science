/**
 * Routes and traffic, worked out from the files (docs/PLAN.md §6).
 *
 * Nothing here is stored. A route is a chain of waypoints (systems, stations
 * or bare stars) with one-way services along it; from those and the world's
 * physics come leg lengths, trip times, the directed flow on every leg, each
 * node's balance, the fleet the traffic ties up (Little's law), and proposals
 * for flows that would balance the network.
 *
 * Node ids are "system:<id>", "station:<id>" or "star:<id>".
 */
import {
  AU,
  DAY,
  LY,
  balanceReport,
  burnAllTheWayTime,
  compareStrings,
  edgeKey,
  findPath,
  flipAndBurnTime,
  lightYears,
  proposeBalancing,
  segmentHitsEllipsoid,
  type BalanceProposal,
  type BalanceReport,
  type Ellipsoid,
  type FlowNetwork,
  type Itinerary,
  type Point3,
  type RouteNode
} from '@malevo/core'
import type { WorldEnv } from './env'
import {
  balanceTolerance,
  foamSettings,
  nebulaKind,
  physicsKind,
  routeKind,
  stationKind,
  systemKind,
  torchSettings,
  travelSettings,
  type PhysicsSettings,
  type RouteFile,
  type Waypoint
} from './kinds'
import { entitiesOf, type WorldData } from './load'
import { systemInfo, worldStars } from './systems'

// ---- nodes ----

export type NodeKind = 'system' | 'station' | 'star'

/** The node a waypoint names, or null when it names none or more than one. */
export function waypointNode(w: Waypoint): string | null {
  const set = [w.system && `system:${w.system}`, w.station && `station:${w.station}`, w.star && `star:${w.star}`].filter(
    Boolean
  ) as string[]
  return set.length === 1 ? set[0] : null
}

export function nodeWaypoint(node: string): Waypoint {
  const [kind, id] = splitNode(node)
  return { [kind]: id } as Waypoint
}

export function splitNode(node: string): [NodeKind, string] {
  const i = node.indexOf(':')
  return [node.slice(0, i) as NodeKind, node.slice(i + 1)]
}

/** The file a node is stored in, if it has one. */
export function nodePath(node: string): string | null {
  const [kind, id] = splitNode(node)
  if (kind === 'system') return `${systemKind.folder}/${id}.json`
  if (kind === 'station') return `${stationKind.folder}/${id}.json`
  return null
}

export interface NodeInfo {
  id: string
  kind: NodeKind
  name: string
  /** Light-years in the atlas frame; null when it cannot be found. */
  pos: Point3 | null
  /** The system built on this star, for a star node. */
  system: string | null
  /** Torch time between the dock and the edge of the collapse zone, s; 0 where there is none; null when unknown. */
  crawlOut: number | null
  crawlIn: number | null
  /** Distance from the dock to the collapse edge, m. */
  crawlDistance: number | null
  declared: number
}

export interface RouteWorld {
  physics: PhysicsSettings | null
  node(id: string): NodeInfo
  nebulae: { id: string; name: string; shape: Ellipsoid }[]
}

const cache = new WeakMap<WorldData, WeakMap<WorldEnv, RouteWorld>>()

export function routeWorld(world: WorldData, env: WorldEnv = {}): RouteWorld {
  let byEnv = cache.get(world)
  if (!byEnv) cache.set(world, (byEnv = new WeakMap()))
  const hit = byEnv.get(env)
  if (hit) return hit
  const physics = (entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined) ?? null
  const stars = worldStars(world, env)
  const systemsByStar = new Map<string, string>()
  for (const e of [...entitiesOf(world, systemKind)].sort((a, b) => compareStrings(a.id, b.id)))
    if (!systemsByStar.has(e.value.star)) systemsByStar.set(e.value.star, e.id)
  const nodes = new Map<string, NodeInfo>()
  const accel = physics ? torchSettings(physics).cruiseAccel : null

  const crawl = (d: number | null): Pick<NodeInfo, 'crawlOut' | 'crawlIn' | 'crawlDistance'> =>
    d === null || accel === null
      ? { crawlOut: null, crawlIn: null, crawlDistance: d }
      : { crawlOut: d > 0 ? burnAllTheWayTime(d, accel) : 0, crawlIn: d > 0 ? flipAndBurnTime(d, accel) : 0, crawlDistance: d }

  const systemNode = (id: string, node: string): NodeInfo => {
    const info = systemInfo(world, env, id)
    const file = info?.file
    const pos = info?.star ? info.star.record.pos : null
    let dist: number | null = null
    if (info?.star && info.collapse !== null) {
      let port: number | null = null
      if (file?.port) {
        // A moon's dock is as far from the star as its planet.
        let b = info.bodies.find((x) => x.id === file.port)
        while (b?.parent) b = info.bodies.find((x) => x.id === b!.parent)
        port = b?.elements ? b.elements.a : null
      } else port = AU * Math.sqrt(info.star.physics.luminosity)
      if (port !== null) dist = Math.max(0, info.collapse - port)
    }
    return {
      id: node,
      kind: 'system',
      name: file?.name ?? id,
      pos: pos ? [pos[0], pos[1], pos[2]] : null,
      system: id,
      ...crawl(dist),
      declared: file?.declaredNet_perDay ?? 0
    }
  }

  const make = (node: string): NodeInfo => {
    const [kind, id] = splitNode(node)
    if (kind === 'system') return systemNode(id, node)
    if (kind === 'station') {
      const f = world.entities.get(`${stationKind.kind}/${id}`)?.value as
        { name: string; pos_ly: number[]; declaredNet_perDay?: number } | undefined
      return {
        id: node,
        kind,
        name: f?.name ?? id,
        pos: f ? [f.pos_ly[0], f.pos_ly[1], f.pos_ly[2]] : null,
        system: null,
        ...crawl(f ? 0 : null),
        declared: f?.declaredNet_perDay ?? 0
      }
    }
    const sys = systemsByStar.get(id)
    if (sys) return { ...systemNode(sys, node), kind: 'star' }
    const rec = stars.get(id)
    // A bare star: ships drop out at the edge of its collapse zone and go on from there.
    return {
      id: node,
      kind,
      name: rec?.name || id,
      pos: rec ? [rec.pos[0], rec.pos[1], rec.pos[2]] : null,
      system: null,
      ...crawl(rec ? 0 : null),
      declared: 0
    }
  }

  const out: RouteWorld = {
    physics,
    node(id) {
      let n = nodes.get(id)
      if (!n) nodes.set(id, (n = make(id)))
      return n
    },
    nebulae: entitiesOf(world, nebulaKind)
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((e) => ({
        id: e.id,
        name: e.value.name,
        shape: {
          center: [e.value.center_ly[0], e.value.center_ly[1], e.value.center_ly[2]] as const,
          radii: [e.value.radii_ly[0], e.value.radii_ly[1], e.value.radii_ly[2]] as const
        }
      }))
  }
  byEnv.set(env, out)
  return out
}

/** The node a system, station or star is filed under for traffic: a star with a system is that system. */
export function canonicalNode(rw: RouteWorld, node: string): string {
  const n = rw.node(node)
  return n.kind === 'star' && n.system ? `system:${n.system}` : node
}

// ---- legs and trip times ----

export interface LegInfo {
  index: number
  from: string
  to: string
  /** Light-years; null when either end has no position. */
  ly: number | null
  /** Time in the foam, s. */
  foam: number | null
  tooLong: boolean
  /** Nebulae the leg crosses. */
  nebulae: string[]
}

export interface ServiceInfo {
  index: number
  from: number
  to: number
  perDay: number
  note?: string
  /** Node ids, in travel order. */
  stops: string[]
  /** Why the service cannot be used, if it cannot. */
  error: string | null
  /** Door to door, s: crawl out, every foam leg, crawl in and out and a stopover at each stop between, crawl in. */
  duration: number | null
  /** Ships the service ties up: perDay × duration (Little's law). */
  fleet: number | null
}

export interface RouteInfo {
  id: string
  file: RouteFile
  /** Node id per waypoint (null for a waypoint that names none, or more than one). */
  nodes: (string | null)[]
  legs: LegInfo[]
  services: ServiceInfo[]
  /** Total length, ly (null if any leg is unknown). */
  length: number | null
}

function legOf(rw: RouteWorld, index: number, from: string, to: string): LegInfo {
  const a = rw.node(from).pos
  const b = rw.node(to).pos
  if (!a || !b) return { index, from, to, ly: null, foam: null, tooLong: false, nebulae: [] }
  const ly = lightYears(a, b)
  const foam = rw.physics ? (ly * LY) / foamSettings(rw.physics).topSpeed : null
  return {
    index,
    from,
    to,
    ly,
    foam,
    tooLong: rw.physics ? ly > rw.physics.foam.legLimit_ly : false,
    nebulae: rw.nebulae.filter((n) => segmentHitsEllipsoid(a, b, n.shape)).map((n) => n.id)
  }
}

/** Door-to-door time through a chain of stops, s; null when any part is unknown. */
export function tripTime(rw: RouteWorld, stops: readonly string[]): number | null {
  if (!rw.physics || stops.length < 2) return null
  const stopover = travelSettings(rw.physics).stopover
  let t = 0
  for (let i = 0; i < stops.length; i++) {
    const n = rw.node(stops[i])
    if (i > 0) {
      const leg = legOf(rw, i - 1, stops[i - 1], stops[i])
      if (leg.foam === null || n.crawlIn === null) return null
      t += leg.foam + n.crawlIn
    }
    if (i < stops.length - 1) {
      if (n.crawlOut === null) return null
      t += n.crawlOut + (i > 0 ? stopover : 0)
    }
  }
  return t
}

export function routeInfo(world: WorldData, env: WorldEnv, routeId: string): RouteInfo | null {
  const e = world.entities.get(`${routeKind.kind}/${routeId}`)
  if (!e || e.value === undefined) return null
  const file = e.value as RouteFile
  const rw = routeWorld(world, env)
  const nodes = file.waypoints.map(waypointNode)
  const legs: LegInfo[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]
    const b = nodes[i + 1]
    if (a && b) legs.push(legOf(rw, i, a, b))
  }
  const known = legs.length === nodes.length - 1 && legs.every((l) => l.ly !== null)
  const services = (file.services ?? []).map((s, index): ServiceInfo => {
    const base = { index, from: s.from, to: s.to, perDay: s.perDay, note: s.note, stops: [] as string[], duration: null, fleet: null }
    const last = nodes.length - 1
    if (s.from > last || s.to > last)
      return { ...base, error: `Runs to waypoint ${Math.max(s.from, s.to) + 1}, but the route has ${nodes.length}.` }
    if (s.from === s.to) return { ...base, error: 'Starts and ends at the same waypoint.' }
    const step = s.from < s.to ? 1 : -1
    const idx: number[] = []
    for (let i = s.from; i !== s.to + step; i += step) idx.push(i)
    if (idx.some((i) => nodes[i] === null)) return { ...base, error: 'Passes a waypoint that names no system, station or star.' }
    const stops = idx.map((i) => canonicalNode(rw, nodes[i]!))
    const duration = tripTime(rw, stops)
    return { ...base, stops, error: null, duration, fleet: duration === null ? null : (s.perDay * duration) / DAY }
  })
  return {
    id: routeId,
    file,
    nodes,
    legs,
    services,
    length: known ? legs.reduce((s, l) => s + l.ly!, 0) : null
  }
}

export function allRoutes(world: WorldData, env: WorldEnv = {}): RouteInfo[] {
  return entitiesOf(world, routeKind)
    .map((e) => routeInfo(world, env, e.id))
    .filter((r): r is RouteInfo => r !== null)
    .sort((a, b) => compareStrings(a.id, b.id))
}

// ---- traffic and balance ----

/** Every usable service as an itinerary ("<route>#<index>"), and each node's declared imbalance. */
export function flowNetwork(world: WorldData, env: WorldEnv = {}): FlowNetwork {
  const itineraries: Itinerary[] = []
  for (const r of allRoutes(world, env))
    for (const s of r.services) {
      if (s.error || s.perDay <= 0) continue
      if (s.stops.some((n, i) => i > 0 && n === s.stops[i - 1])) continue
      itineraries.push({ id: `${r.id}#${s.index}`, stops: s.stops, perDay: s.perDay })
    }
  const declared: Record<string, number> = {}
  for (const e of entitiesOf(world, systemKind)) if (e.value.declaredNet_perDay) declared[`system:${e.id}`] = e.value.declaredNet_perDay
  for (const e of entitiesOf(world, stationKind)) if (e.value.declaredNet_perDay) declared[`station:${e.id}`] = e.value.declaredNet_perDay
  return { edges: [], itineraries, declared }
}

export interface TrafficReport extends BalanceReport {
  /** Ships under way on each directed leg (λ × leg time), keyed "from→to". */
  inTransit: Record<string, number>
  /** Ships tied up by all services. */
  fleet: number
  /** Services whose duration is unknown, so the fleet is an undercount. */
  unknownDurations: number
}

export function trafficReport(world: WorldData, env: WorldEnv = {}): TrafficReport | null {
  const rw = routeWorld(world, env)
  if (!rw.physics) return null
  const report = balanceReport(flowNetwork(world, env), balanceTolerance(rw.physics))
  const inTransit: Record<string, number> = {}
  let fleet = 0
  let unknownDurations = 0
  for (const r of allRoutes(world, env))
    for (const s of r.services) {
      if (s.error || s.perDay <= 0) continue
      if (s.fleet === null) unknownDurations++
      else fleet += s.fleet
      for (let i = 0; i < s.stops.length - 1; i++) {
        const t = tripTime(rw, [s.stops[i], s.stops[i + 1]])
        if (t === null) continue
        const k = edgeKey(s.stops[i], s.stops[i + 1])
        inTransit[k] = (inTransit[k] ?? 0) + (s.perDay * t) / DAY
      }
    }
  return { ...report, inTransit, fleet, unknownDurations }
}

export interface BalanceSuggestion {
  route: string
  from: number
  to: number
  perDay: number
}

/**
 * Flows that would bring every node to its declared imbalance at the least
 * cost in ship-days, using the legs of existing routes in either direction
 * (or only the routes named). The additions come back as services on the
 * routes that have those legs, consecutive legs joined into one service that
 * passes through. Nothing is applied.
 */
export function suggestBalancing(
  world: WorldData,
  env: WorldEnv = {},
  onlyRoutes?: readonly string[]
): (BalanceProposal & { suggestions: BalanceSuggestion[] }) | null {
  const rw = routeWorld(world, env)
  if (!rw.physics) return null
  const best = new Map<string, { from: string; to: string; cost: number; route: string; i: number; j: number }>()
  for (const r of allRoutes(world, env)) {
    if (onlyRoutes && !onlyRoutes.includes(r.id)) continue
    for (let i = 0; i < r.nodes.length - 1; i++) {
      const a = r.nodes[i]
      const b = r.nodes[i + 1]
      if (!a || !b) continue
      const ca = canonicalNode(rw, a)
      const cb = canonicalNode(rw, b)
      if (ca === cb) continue
      for (const [from, to, fi, ti] of [
        [ca, cb, i, i + 1],
        [cb, ca, i + 1, i]
      ] as const) {
        const t = tripTime(rw, [from, to])
        if (t === null) continue
        const k = edgeKey(from, to)
        const have = best.get(k)
        if (!have || t / DAY < have.cost) best.set(k, { from, to, cost: t / DAY, route: r.id, i: fi, j: ti })
      }
    }
  }
  const proposal = proposeBalancing(flowNetwork(world, env), [...best.values()])
  // Per route, flow to add on each leg, by direction; then join runs of consecutive legs into through services.
  const perRoute = new Map<string, { fwd: Map<number, number>; back: Map<number, number> }>()
  for (const a of proposal.additions) {
    const c = best.get(edgeKey(a.from, a.to))!
    let r = perRoute.get(c.route)
    if (!r) perRoute.set(c.route, (r = { fwd: new Map(), back: new Map() }))
    const leg = Math.min(c.i, c.j)
    const m = c.j > c.i ? r.fwd : r.back
    m.set(leg, (m.get(leg) ?? 0) + a.perDay)
  }
  const suggestions: BalanceSuggestion[] = []
  for (const route of [...perRoute.keys()].sort(compareStrings)) {
    const { fwd, back } = perRoute.get(route)!
    for (const [m, forward] of [
      [fwd, true],
      [back, false]
    ] as const) {
      for (;;) {
        const legs = [...m.keys()].filter((k) => m.get(k)! > 1e-9).sort((x, y) => x - y)
        if (!legs.length) break
        // The first run of consecutive legs.
        let end = 0
        while (end + 1 < legs.length && legs[end + 1] === legs[end] + 1) end++
        const run = legs.slice(0, end + 1)
        const amount = Math.min(...run.map((k) => m.get(k)!))
        for (const k of run) m.set(k, m.get(k)! - amount)
        const lo = run[0]
        const hi = run[run.length - 1] + 1
        suggestions.push(forward ? { route, from: lo, to: hi, perDay: amount } : { route, from: hi, to: lo, perDay: amount })
      }
    }
  }
  return { ...proposal, suggestions }
}

// ---- planning ----

export interface PlannedRoute {
  waypoints: Waypoint[]
  /** Door to door, s. */
  duration: number
  ly: number
}

/**
 * The quickest chain of legs between two nodes through the stars (and
 * stations) of the atlas: every leg within the leg limit and clear of
 * nebulae, each stop costing its crawl and the stopover. Stars that carry a
 * system come back as that system. Null when there is no such chain within
 * the search radius, or the physics settings are missing.
 */
export function planRoute(
  world: WorldData,
  env: WorldEnv,
  from: string,
  to: string,
  opts: { margin_ly?: number } = {}
): PlannedRoute | null {
  const rw = routeWorld(world, env)
  if (!rw.physics) return null
  const a = rw.node(from)
  const b = rw.node(to)
  if (!a.pos || !b.pos) return null
  const limit = rw.physics.foam.legLimit_ly
  const speed = foamSettings(rw.physics).topSpeed
  const stopover = travelSettings(rw.physics).stopover
  const center: Point3 = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2]
  const radius = lightYears(a.pos, b.pos) / 2 + (opts.margin_ly ?? 2 * limit)
  const nodes = new Map<string, RouteNode>()
  const put = (id: string): void => {
    const n = canonicalNode(rw, id)
    const p = rw.node(n).pos
    if (p && !nodes.has(n)) nodes.set(n, { id: n, pos: p })
  }
  put(from)
  put(to)
  for (const s of worldStars(world, env).near([center[0], center[1], center[2]], radius)) put(`star:${s.id}`)
  for (const e of entitiesOf(world, stationKind))
    if (lightYears(e.value.pos_ly as unknown as Point3, center) <= radius) put(`station:${e.id}`)
  const legCost = (ly: number): number => (ly * LY) / speed
  const path = findPath([...nodes.values()], canonicalNode(rw, from), canonicalNode(rw, to), {
    legLimit: limit,
    legCost,
    heuristic: legCost,
    stopCost: (n) => {
      const info = rw.node(n.id)
      return stopover + (info.crawlIn ?? 0) + (info.crawlOut ?? 0)
    },
    nebulae: rw.nebulae.map((n) => n.shape)
  })
  if (!path) return null
  const duration = tripTime(rw, path.ids)
  return {
    waypoints: path.ids.map(nodeWaypoint),
    duration: duration ?? path.cost,
    ly: path.legs.reduce((s, l) => s + l.ly, 0)
  }
}
