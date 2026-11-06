/**
 * The trip planner: a particular ship flying a charted route, as against the
 * route planner's idealized times (the world's cruise acceleration, tanks that
 * never run short).
 *
 * Each leg between waypoints is flown on what is in the tanks at its start:
 *
 * 1. the departure burn, from the port out to where the ship enters the foam
 *    (the approach model's crawl distance toward the next waypoint);
 * 2. the foam, at the world's top speed, burning fuel to hold the foam and
 *    idling the torch to dump heat, as the ship's settings say;
 * 3. the arrival burn, from the drop to the port (worked out at the time of
 *    the drop).
 *
 * Burns run at the ship's thrust over its current mass, capped by its comfort
 * acceleration. If the tanks cannot cover flip-and-burn on both crawls and
 * still arrive with the reserve, the planner finds the highest cruise speed
 * (the same cap for both crawls) that does, and the ship coasts between its
 * burns. Every port and station sells fuel; a bare star is a pass-through
 * (drop and lift again, no crawl, no fuel).
 */
import { C, DAY, FUSION_ENERGY, G0, crawl, flipAndBurnTime, type Burn, type Engine } from '@malevo/core'
import type { WorldEnv } from './env'
import { physicsKind, shipKind, type PhysicsSettings, type ShipFile } from './kinds'
import { entitiesOf, type WorldData } from './load'
import { routeInfo, routeWorld } from './routes'
import { approachInfo } from './sky'

export interface TripQuery {
  ship: string
  route: string
  /** Waypoint indices; `to` may be before `from` (the route flown backwards). */
  from: number
  to: number
  /** Departure, universal time s. */
  t: number
}

export interface TripLeg {
  from: string
  to: string
  fromName: string
  toName: string
  /** Universal time s. */
  departs: number
  arrives: number
  depart: Burn | null
  foam: { time: number; propellant: number }
  arrive: Burn | null
  /** Refuelling at the far end before the next leg (none at the end of the trip or at a bare star). */
  refuel: { time: number; propellant: number } | null
  /** Propellant at the start and end of the leg, kg. */
  propellantStart: number
  propellantEnd: number
  /** The cruise speed the tanks allowed, m/s, when lower than flip-and-burn. */
  speedCap: number | null
  /** The route planner's idealized time for the same leg, s. */
  ideal: number | null
  problems: string[]
}

export interface TripPlan {
  ship: string
  shipName: string
  legs: TripLeg[]
  departs: number
  arrives: number
  /** Port to port, refuelling stops included, s. */
  total: number
  /** The idealized total (no refuelling waits, the world's cruise acceleration), s. */
  ideal: number | null
  problems: string[]
}

const T = 1000

/** A ship's engine and masses, in SI. */
export function shipEngine(ship: ShipFile, physics: PhysicsSettings): Engine & { dry: number; capacity: number } {
  return {
    exhaust: (ship.exhaustSpeed_c ?? physics.torch.exhaustSpeed_c) * C,
    thrust: ship.thrust_MN * 1e6,
    maxAccel: (ship.comfort_g ?? physics.torch.cruiseAccel_g) * G0,
    dry: ship.dryMass_t * T,
    capacity: ship.propellant_t * T
  }
}

/** The propellant that must be left on arrival, kg: the larger of the share and the Δv reserve. */
export function reservePropellant(ship: ShipFile, e: { exhaust: number; dry: number; capacity: number }): number {
  const share = (ship.reserve.share ?? 0) * e.capacity
  const dv = (ship.reserve.dv_kms ?? 0) * 1000
  const forDv = e.dry * (Math.exp(dv / e.exhaust) - 1)
  return Math.max(share, forDv)
}

/** A new ship at middling defaults: 10,000 t full, enough thrust for 1 g full. */
export function newShip(name: string): ShipFile {
  return { name, dryMass_t: 5000, propellant_t: 5000, thrust_MN: 98.1, reserve: { share: 0.1 }, foamThrottle: 0.02, refuel_tph: 500 }
}

export function planTrip(world: WorldData, env: WorldEnv, q: TripQuery): TripPlan | { error: string } {
  const shipEntity = entitiesOf(world, shipKind).find((e) => e.id === q.ship)
  if (!shipEntity) return { error: `There is no ship "${q.ship}".` }
  const ship = shipEntity.value
  const physics = entitiesOf(world, physicsKind)[0]?.value as PhysicsSettings | undefined
  if (!physics) return { error: 'The trip planner needs settings/physics.json.' }
  const route = routeInfo(world, env, q.route)
  if (!route) return { error: `There is no route "${q.route}".` }
  const n = route.nodes.length
  if (q.from === q.to || q.from < 0 || q.to < 0 || q.from >= n || q.to >= n) return { error: 'Pick two different waypoints of the route.' }
  const rw = routeWorld(world, env)
  const e = shipEngine(ship, physics)
  const reserve = reservePropellant(ship, e)
  const step = q.to > q.from ? 1 : -1
  const foamPower = (ship.foamPower_GW ?? 0) * 1e9
  const foamThrottle = ship.foamThrottle ?? 0
  const pump = ((ship.refuel_tph ?? 500) * T) / 3600
  const stopover = physics.travel.stopover_d * DAY
  const problems: string[] = []
  if (reserve >= e.capacity) problems.push('The reserve is as large as the tanks: nothing is left to fly on.')

  /** The crawl distance between a system's port and the foam's edge, toward a neighbour, at time t (0 for a station or bare star). */
  const crawlDistance = (node: string, toward: string, t: number): number | null => {
    if (!node.startsWith('system:')) return 0
    const r = approachInfo(world, env, { system: node.slice('system:'.length), from: toward, t })
    return 'error' in r ? null : (r.crawlDistance ?? 0)
  }
  const idealCrawl = (d: number): number => (d > 0 ? flipAndBurnTime(d, physics.torch.cruiseAccel_g * G0) : 0)

  const legs: TripLeg[] = []
  let t = q.t
  let propellant = e.capacity
  for (let i = q.from; i !== q.to; i += step) {
    const a = route.nodes[i]
    const b = route.nodes[i + step]
    const legProblems: string[] = []
    if (!a || !b) {
      problems.push(`Waypoint ${(a ? i + step : i) + 1} names no single place.`)
      break
    }
    const legInfo = route.legs.find((l) => l.index === Math.min(i, i + step))
    const foamTime = legInfo?.foam ?? null
    if (foamTime === null) {
      problems.push(`The leg ${rw.node(a).name} → ${rw.node(b).name} has no known length.`)
      break
    }
    const d1 = crawlDistance(a, b, t)
    if (d1 === null) legProblems.push(`The approach at ${rw.node(a).name} could not be worked out; no departure burn counted.`)
    const m0 = e.dry + propellant
    const foamUse = (time: number, m: number): number =>
      Math.min(m - e.dry, (foamPower * time) / FUSION_ENERGY + (foamThrottle * e.thrust * time) / e.exhaust)
    // The arrival crawl is worked out at the drop, which depends on how long the departure burn takes; two passes settle it.
    const flyAt = (cap: number, d2: number): { dep: Burn | null; arr: Burn | null; left: number; foam: number } => {
      const dep = d1 ? crawl(d1, m0, e, cap) : null
      const m1 = dep ? dep.massEnd : m0
      const foam = foamUse(foamTime, m1)
      const m2 = m1 - foam
      const arr = d2 > 0 ? crawl(d2, m2, e, cap) : null
      return { dep, arr, left: (arr ? arr.massEnd : m2) - e.dry, foam }
    }
    let d2 = crawlDistance(b, a, t + foamTime) ?? 0
    let plan = flyAt(Infinity, d2)
    d2 = crawlDistance(b, a, t + (plan.dep ? plan.dep.accel.time + plan.dep.coast.time + plan.dep.decel.time : 0) + foamTime) ?? 0
    plan = flyAt(Infinity, d2)
    let speedCap: number | null = null
    if (plan.left < reserve) {
      // The highest common cruise speed that still arrives with the reserve.
      const top = Math.max(plan.dep?.peakSpeed ?? 0, plan.arr?.peakSpeed ?? 0)
      let lo = 0
      let hi = top
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2
        if (flyAt(mid, d2).left >= reserve) lo = mid
        else hi = mid
      }
      if (lo < 1) {
        legProblems.push('Even crawling slowly, the tanks cannot cover this leg and arrive with the reserve.')
        speedCap = 0
      } else {
        speedCap = lo
        plan = flyAt(lo, d2)
      }
    }
    const burnTime = (b: Burn | null): number => (b ? b.accel.time + b.coast.time + b.decel.time : 0)
    const legTime = burnTime(plan.dep) + foamTime + burnTime(plan.arr)
    const arrives = t + legTime
    const left = Math.max(0, plan.left)
    // Refuel at the far end (a port or station) unless the trip ends there.
    const last = i + step === q.to
    const fuelStop = !last && (b.startsWith('system:') || b.startsWith('station:'))
    const refuel = fuelStop ? { propellant: e.capacity - left, time: Math.max(stopover, (e.capacity - left) / pump) } : null
    legs.push({
      from: a,
      to: b,
      fromName: rw.node(a).name,
      toName: rw.node(b).name,
      departs: t,
      arrives,
      depart: plan.dep,
      foam: { time: foamTime, propellant: plan.foam },
      arrive: plan.arr,
      refuel,
      propellantStart: propellant,
      propellantEnd: left,
      speedCap: speedCap !== null && speedCap > 0 ? speedCap : speedCap === 0 ? 0 : null,
      ideal: d1 === null ? null : idealCrawl(d1) + foamTime + idealCrawl(d2),
      problems: legProblems
    })
    propellant = refuel ? e.capacity : left
    t = arrives + (refuel ? refuel.time : 0)
  }
  const arrives = legs.length ? legs[legs.length - 1].arrives : q.t
  const ideals = legs.map((l) => l.ideal)
  return {
    ship: q.ship,
    shipName: ship.name,
    legs,
    departs: q.t,
    arrives,
    total: arrives - q.t,
    ideal: ideals.every((x) => x !== null) ? ideals.reduce((s, x) => s! + x!, 0) : null,
    problems
  }
}
