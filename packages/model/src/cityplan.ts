/**
 * City plans (docs/PLAN.md §7.8): the plan's geometry (cityplan@1), travel
 * times across walking, transit and lighters to orbit, routed on the city's
 * own network at a time of day, and the port's capacity against the route
 * network's arrivals. Every speed and size comes from the plan file.
 */
import { cityServices, cityplan, contextFor, generatePlan, type CityService, type PlanInput, type PlanOutput } from '@malevo/gen'
import type { WorldEnv } from './env'
import { bodyKind, cityKind, cityPlanKind, type BodyFile, type CityFile, type CityPlanFile } from './kinds'
import { entitiesOf, type WorldData } from './load'
import { trafficReport } from './routes'
import { systemInfo } from './systems'

export const CITYPLAN_GEN = 'cityplan@1'

export function cityPlanOf(world: WorldData, cityId: string): { id: string; file: CityPlanFile } | null {
  const e = entitiesOf(world, cityPlanKind).find((x) => x.value.city === cityId)
  return e ? { id: e.id, file: e.value } : null
}

export function planInput(id: string, f: CityPlanFile): PlanInput {
  return {
    planId: id,
    seed: f.seed,
    defaults: f.defaults,
    ground: f.ground as PlanInput['ground'],
    water: f.water as PlanInput['water'],
    lines: f.lines as PlanInput['lines'],
    regions: f.regions as PlanInput['regions'],
    buildings: f.buildings as PlanInput['buildings']
  }
}

const geometryCache = new WeakMap<object, PlanOutput>()

/** The plan's boxes and faces (cityplan@1, keyed by the world seed and the plan). */
export function planGeometry(world: WorldData, planId: string): PlanOutput | null {
  const e = world.entities.get(`${cityPlanKind.kind}/${planId}`)
  if (!e || e.value === undefined) return null
  const hit = geometryCache.get(e.value as object)
  if (hit) return hit
  const out = generatePlan(planInput(planId, e.value as CityPlanFile), contextFor(cityplan, world.manifest?.seed ?? 0))
  geometryCache.set(e.value as object, out)
  return out
}

/** A new plan for a city: a flat site with one avenue, nothing particular. */
export function newCityPlan(cityId: string): CityPlanFile {
  return {
    city: cityId,
    extent: [-2000, -1500, 2000, 1500],
    defaults: { groundZ: 0, surface: 'grass' },
    walking: { speed_ms: 1.3, detour: 1.3 },
    lines: [
      {
        id: 'main-avenue',
        name: 'Main avenue',
        kind: 'avenue',
        pts: [
          [-1800, 0],
          [1800, 0]
        ]
      }
    ]
  }
}

// ---- travel ----

export type Place = [number, number] | 'orbit'

export interface TravelLeg {
  mode: 'walk' | 'wait' | 'ride' | 'orbit'
  /** Line id for a ride. */
  line?: string
  from: [number, number]
  to: [number, number]
  /** s */
  duration: number
}

export interface TravelResult {
  /** s, door to door. */
  total: number
  legs: TravelLeg[]
  /** Time of day it arrives, local s since midnight. */
  arrive: number
}

interface Stop {
  sv: CityService
  dir: 1 | -1
  i: number
  pos: [number, number]
}

/**
 * The quickest way from one place in the city to another (or to orbit),
 * leaving at `depart` (local seconds since midnight; a local hour is
 * `hour_s`): walking, and riding the services, waiting for each one's real
 * next departure and keeping to its running hours.
 */
export function cityTravel(
  plan: CityPlanFile,
  from: [number, number],
  to: Place,
  depart: number,
  hour_s = 3600
): TravelResult | { error: string } {
  const services = cityServices(planInput('travel', plan))
  const walk = plan.walking
  const pts = new Map<string, [number, number]>((plan.points ?? []).map((p) => [p.id, [p.pos[0], p.pos[1]]]))
  let target: [number, number]
  let orbitTail = 0
  if (to === 'orbit') {
    if (!plan.orbit) return { error: 'The plan has no lighter field (orbit).' }
    const f = pts.get(plan.orbit.field)
    if (!f) return { error: `The lighter field point "${plan.orbit.field}" does not exist.` }
    target = f
    orbitTail = (plan.orbit.windowGap_min / 2 + plan.orbit.flight_min) * 60
  } else target = to

  const stops: Stop[] = []
  for (const sv of services)
    for (const dir of [1, -1] as const) {
      if (dir < 0 && sv.tracks < 2 && sv.kind !== 'funicular') continue
      const S = dir > 0 ? sv.stops : sv.stops.map((x) => sv.path.L - x).reverse()
      S.forEach((s, i) => {
        const q = sv.path.at(dir > 0 ? s : sv.path.L - s)
        stops.push({ sv, dir, i, pos: [q.x, q.y] })
      })
    }
  const walkTime = (a: [number, number], b: [number, number]): number =>
    (Math.hypot(a[0] - b[0], a[1] - b[1]) * walk.detour) / walk.speed_ms
  const day = 24 * hour_s
  const running = (sv: CityService, t: number): boolean => {
    if (!sv.hours) return true
    const h = (((t % day) + day) % day) / hour_s
    return sv.hours[0] <= sv.hours[1] ? h >= sv.hours[0] && h <= sv.hours[1] : h >= sv.hours[0] || h <= sv.hours[1]
  }
  /** The next run leaving stop i at or after t: its departure and arrival times at each later stop. */
  const nextRun = (st: Stop, t: number): { leave: number; base: number } | null => {
    const sv = st.sv
    const departs = st.dir > 0 ? sv.departs : sv.departsBack
    const phase = sv.phase + (st.dir > 0 ? 0 : sv.backPhase)
    for (let k = Math.ceil((t - phase - departs[st.i]) / sv.headway), guard = 0; guard < 400; k++, guard++) {
      const base = phase + k * sv.headway
      if (running(sv, base)) return { leave: base + departs[st.i], base }
    }
    return null
  }

  // Earliest arrival: node 0 is the origin, 1 the target, 2+ the stops.
  const N = stops.length + 2
  const best = new Array<number>(N).fill(Infinity)
  const prev = new Array<{ node: number; leg: TravelLeg } | null>(N).fill(null)
  const done = new Uint8Array(N)
  const posOf = (n: number): [number, number] => (n === 0 ? from : n === 1 ? target : stops[n - 2].pos)
  best[0] = depart
  for (;;) {
    let u = -1
    for (let n = 0; n < N; n++) if (!done[n] && best[n] < Infinity && (u < 0 || best[n] < best[u])) u = n
    if (u < 0 || u === 1) break
    done[u] = 1
    const t = best[u]
    const relax = (v: number, at: number, leg: TravelLeg): void => {
      if (at < best[v]) {
        best[v] = at
        prev[v] = { node: u, leg }
      }
    }
    // Walk anywhere within reach, and to the target.
    const here = posOf(u)
    for (let v = 1; v < N; v++) {
      if (v === u) continue
      const p = posOf(v)
      const d = Math.hypot(p[0] - here[0], p[1] - here[1])
      if (v !== 1 && d > 2000 && u !== 0) continue
      relax(v, t + walkTime(here, p), { mode: 'walk', from: here, to: p, duration: walkTime(here, p) })
    }
    // Ride from a stop to any later stop on the same run.
    if (u >= 2) {
      const st = stops[u - 2]
      const run = nextRun(st, t)
      if (run) {
        const arrives = st.dir > 0 ? st.sv.arrives : st.sv.arrivesBack
        for (let v = 2; v < N; v++) {
          const o = stops[v - 2]
          if (o.sv !== st.sv || o.dir !== st.dir || o.i <= st.i) continue
          const at = run.base + arrives[o.i]
          relax(v, at, { mode: 'ride', line: st.sv.id, from: st.pos, to: o.pos, duration: at - t })
        }
      }
    }
  }
  if (!Number.isFinite(best[1])) return { error: 'There is no way there.' }
  const legs: TravelLeg[] = []
  for (let n = 1; prev[n]; n = prev[n]!.node) legs.unshift(prev[n]!.leg)
  // Split rides into the wait and the ride itself.
  const out: TravelLeg[] = []
  let clock = depart
  for (const l of legs) {
    if (l.mode === 'ride') {
      const st = stops.find((s) => s.pos === l.from && s.sv.id === l.line)!
      const run = nextRun(st, clock)!
      const wait = run.leave - clock
      if (wait > 0.5) out.push({ mode: 'wait', line: l.line, from: l.from, to: l.from, duration: wait })
      out.push({ ...l, duration: l.duration - wait })
    } else out.push(l)
    clock += l.duration
  }
  let total = best[1] - depart
  if (orbitTail > 0) {
    out.push({ mode: 'orbit', from: target, to: target, duration: orbitTail })
    total += orbitTail
  }
  return { total, legs: out.filter((l) => l.duration > 0.5 || l.mode === 'ride'), arrive: depart + total }
}

// ---- the port ----

export interface PortCapacity {
  /** Freighters a day each limit allows. */
  limits: { corridor: number; stack: number; fleet: number; field: number }
  capacity: number
  /** What binds. */
  binding: 'corridor' | 'stack' | 'fleet' | 'field'
  /** Lighter round trips to work one freighter. */
  tripsPerFreighter: number
  /** Freighters arriving a day by the route network (null when the city is not its system's main port). */
  demand: number | null
}

/** The stack tool's four limits, against the route network's own arrivals at the city's system. */
export function portCapacity(world: WorldData, env: WorldEnv, plan: CityPlanFile): PortCapacity | null {
  const p = plan.port
  if (!p) return null
  const trips = Math.ceil(p.containersPerFreighter / p.lighterCapacity)
  const limits = {
    corridor: 1440 / p.spacing_min,
    stack: p.berths / p.daysInStack,
    fleet: (p.lighters * p.flightsPerLighter) / trips,
    field: p.fieldMovements / 2 / trips
  }
  const binding = (Object.keys(limits) as (keyof typeof limits)[]).reduce((a, b) => (limits[b] < limits[a] ? b : a))
  let demand: number | null = null
  const city = world.entities.get(`${cityKind.kind}/${plan.city}`)?.value as CityFile | undefined
  if (city?.port === 'main') {
    const body = world.entities.get(`${bodyKind.kind}/${city.body}`)?.value as BodyFile | undefined
    const sys = body ? systemInfo(world, env, body.system) : null
    const t = trafficReport(world, env)
    if (sys && t) demand = t.nodes.find((n) => n.node === `system:${sys.id}`)?.arrivals ?? 0
  }
  return { limits, capacity: limits[binding], binding, tripsPerFreighter: trips, demand }
}
