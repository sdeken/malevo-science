/**
 * Itineraries: someone's movements by the minute through a city, and down to it from orbit.
 *
 * The stops are worked through in order, as a timetable that never slips: from each stop she leaves as soon
 * as she has stayed the least time there (or at its pinned departure), and each leg takes what the right
 * engine says:
 * - on the ground, the city plan's door-to-door travel (walking a straight line times the plan's detour
 *   factor, and riding its lines, waiting for each one's real next departure and keeping to its hours);
 *   "walk" walks the whole way;
 * - from orbit, a lighter: the next launch window (windows every `windowGap_min` from local midnight), the
 *   flight, then on from the lighter field;
 * - a landing (from the Landings tool): she leaves orbit at its deorbit burn and is down at its touchdown;
 * - a fixed time, for what is the setting's to decide (a customs desk, a walk through the port).
 * Pinned arrivals give the slack she has, or how late she would be.
 *
 * Positions are in the city plan's metres, for drawing; legs off the plan (in orbit, aboard a ship) have none.
 */
import { landingReport } from './landing'
import { conditionsAt } from './cities'
import { cityTravel, type TravelLeg } from './cityplan'
import type { WorldEnv } from './env'
import {
  cityPlanKind,
  itineraryKind,
  landingKind,
  shipKind,
  bodyKind,
  type CityPlanFile,
  type ItineraryFile,
  type LandingFile,
  type SpotFile
} from './kinds'
import { entitiesOf, type WorldData } from './load'

export type XY = [number, number]

export interface ItineraryPart {
  mode: 'walk' | 'wait' | 'ride' | 'lighter' | 'descent' | 'fixed'
  /** A line's id, for a ride. */
  line?: string
  t0: number
  t1: number
  from: XY | null
  to: XY | null
}

export interface ItineraryStop {
  index: number
  label: string
  /** On the city plan, m (null in orbit or aboard a ship). */
  pos: XY | null
  arrive: number | null
  depart: number | null
  /** Local hour of day (0–24) at the city, at arrival and departure. */
  arriveLocal: number | null
  departLocal: number | null
  /** Pinned arrival minus the worked-out one: spare time (negative: late). */
  slack: number | null
  /** How she got here. */
  leg: { by: string; duration: number; summary: string } | null
  problems: string[]
}

export interface ItineraryReport {
  id: string
  name: string
  color: string
  stops: ItineraryStop[]
  /** Where she is, piece by piece: stays at stops, and the legs between, for drawing. */
  parts: ItineraryPart[]
  start: number | null
  end: number | null
  problems: string[]
}

const fmtMin = (s: number): string => {
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** What to call a place. */
export function spotLabel(world: WorldData, plan: CityPlanFile | null, s: SpotFile): string {
  if (s.label) return s.label
  if (s.point) {
    const p = plan?.points?.find((x) => x.id === s.point)
    return p?.name ?? s.point
  }
  if (s.ship) {
    const v = world.entities.get(`${shipKind.kind}/${s.ship}`)?.value as { name?: string } | undefined
    return `aboard ${v?.name ?? s.ship}`
  }
  if (s.orbit) {
    const v = world.entities.get(`${bodyKind.kind}/${s.orbit}`)?.value as { name?: string } | undefined
    return `in orbit of ${v?.name ?? s.orbit}`
  }
  if (s.pos) return `${Math.round(s.pos[0])}, ${Math.round(s.pos[1])}`
  return '?'
}

function spotPos(plan: CityPlanFile | null, s: SpotFile): XY | null {
  if (s.pos) return [s.pos[0], s.pos[1]]
  if (s.point) {
    const p = plan?.points?.find((x) => x.id === s.point)
    return p ? [p.pos[0], p.pos[1]] : null
  }
  return null
}

export function itineraryReport(world: WorldData, env: WorldEnv, id: string, f: ItineraryFile): ItineraryReport {
  const problems: string[] = []
  const plan = (world.entities.get(`${cityPlanKind.kind}/${f.city}`)?.value as CityPlanFile | undefined) ?? null
  if (!plan) problems.push(`The city "${f.city}" has no plan, so nothing on the ground can be worked out (draw one in the City planner).`)
  const labels = f.stops.map((s) => spotLabel(world, plan, s.place))
  const poss = f.stops.map((s) => spotPos(plan, s.place))
  f.stops.forEach((s, i) => {
    if (s.place.point && !poss[i]) problems.push(`Stop ${i + 1}: the plan has no point "${s.place.point}".`)
  })

  // Local time of day in the city: worked out once, then carried along by the length of its day.
  const first = f.stops[0]
  const t0 = first.depart?.t_s ?? first.arrive?.t_s ?? null
  let local: (t: number) => number | null = () => null
  let hour_s = 3600
  if (t0 !== null) {
    const c = conditionsAt(world, env, f.city, t0)
    if (!('error' in c) && c.localHours !== null && c.localHour_s !== null) {
      const h0 = c.localHours
      const hs = c.localHour_s
      hour_s = hs
      local = (t: number): number => (((h0 + (t - t0) / hs) % 24) + 24) % 24
    }
  }
  const localSec = (t: number): number => (local(t) ?? 12) * hour_s

  const stops: ItineraryStop[] = []
  const parts: ItineraryPart[] = []
  if (t0 === null) problems.push('The first stop needs a time (when she is there, or when she leaves).')

  let prevDepart: number | null = null
  for (let i = 0; i < f.stops.length; i++) {
    const s = f.stops[i]
    const sp: string[] = []
    let arrive: number | null = null
    let leg: ItineraryStop['leg'] = null
    if (i === 0) arrive = s.arrive?.t_s ?? s.depart?.t_s ?? null
    else if (prevDepart !== null) {
      const from = poss[i - 1]
      const to = poss[i]
      const prev = f.stops[i - 1].place
      const offPlan = (x: SpotFile): boolean => Boolean(x.orbit || x.ship)
      let by = s.by ?? 'auto'
      if (by === 'auto')
        by = offPlan(prev) && !offPlan(s.place) ? (s.landing ? 'landing' : 'lighter') : offPlan(prev) || offPlan(s.place) ? 'fixed' : 'city'
      const legParts: ItineraryPart[] = []
      let t: number = prevDepart
      const cityLeg = (a: XY, b: XY, walkOnly: boolean): boolean => {
        if (!plan) return false
        if (walkOnly) {
          const d = (Math.hypot(a[0] - b[0], a[1] - b[1]) * plan.walking.detour) / plan.walking.speed_ms
          legParts.push({ mode: 'walk', t0: t, t1: t + d, from: a, to: b })
          t += d
          return true
        }
        const r = cityTravel(plan, a, b, localSec(t), hour_s)
        if ('error' in r) {
          sp.push(r.error)
          return false
        }
        for (const p of r.legs as TravelLeg[]) {
          const mode = p.mode === 'orbit' ? 'lighter' : p.mode
          legParts.push({ mode, line: p.line, t0: t, t1: t + p.duration, from: p.from, to: p.to })
          t += p.duration
        }
        return true
      }
      if (by === 'city' || by === 'walk') {
        if (!from || !to) sp.push('Walking and the city’s lines need both ends on the plan.')
        else cityLeg(from, to, by === 'walk')
      } else if (by === 'lighter') {
        const orbit = plan?.orbit
        const field = orbit ? plan?.points?.find((x) => x.id === orbit.field) : undefined
        if (!orbit || !field) sp.push('The city’s plan has no lighter field (City planner, “To orbit”).')
        else {
          const gap = orbit.windowGap_min * 60
          if (gap > 0) {
            // The next window: windows every gap from local midnight.
            const into = localSec(t) % gap
            const wait = into === 0 ? 0 : gap - into
            if (wait > 0) legParts.push({ mode: 'wait', t0: t, t1: t + wait, from: null, to: null })
            t += wait
          }
          const fp: XY = [field.pos[0], field.pos[1]]
          legParts.push({ mode: 'lighter', t0: t, t1: t + orbit.flight_min * 60, from: null, to: fp })
          t += orbit.flight_min * 60
          if (to && Math.hypot(to[0] - fp[0], to[1] - fp[1]) > 1) cityLeg(fp, to, false)
        }
      } else if (by === 'landing') {
        const lf = s.landing ? (world.entities.get(`${landingKind.kind}/${s.landing}`)?.value as LandingFile | undefined) : undefined
        if (!lf) sp.push(s.landing ? `There is no landing "${s.landing}".` : 'Choose the landing that brings her down.')
        else {
          const r = landingReport(world, env, lf)
          if ('error' in r) sp.push(r.error)
          else {
            const touchdown = lf.touchdown.t_s
            const burn = touchdown - r.descent_s
            if (burn < t) sp.push(`The landing’s deorbit burn is ${fmtMin(t - burn)} before she can be aboard.`)
            else if (burn > t) legParts.push({ mode: 'wait', t0: t, t1: burn, from: null, to: null })
            legParts.push({ mode: 'descent', t0: burn, t1: touchdown, from: null, to })
            t = Math.max(t, touchdown)
          }
        }
      } else {
        const m = s.minutes ?? 0
        if (s.minutes === undefined) sp.push('Give the minutes this takes.')
        legParts.push({ mode: 'fixed', t0: t, t1: t + m * 60, from, to })
        t += m * 60
      }
      arrive = t
      parts.push(...legParts)
      const sum = (mode: string): number => legParts.filter((p) => p.mode === mode).reduce((a, p) => a + p.t1 - p.t0, 0)
      const rides = [...new Set(legParts.filter((p) => p.mode === 'ride').map((p) => p.line))]
      const bits = [
        sum('lighter') && `lighter ${fmtMin(sum('lighter'))}`,
        sum('descent') && `descent ${fmtMin(sum('descent'))}`,
        sum('walk') && `walk ${fmtMin(sum('walk'))}`,
        sum('ride') && `ride ${fmtMin(sum('ride'))}${rides.length ? ` (${rides.join(', ')})` : ''}`,
        sum('wait') && `wait ${fmtMin(sum('wait'))}`,
        sum('fixed') && fmtMin(sum('fixed'))
      ].filter(Boolean)
      leg = { by, duration: t - prevDepart, summary: bits.join(', ') || 'no time' }
    }

    let slack: number | null = null
    if (arrive !== null && s.arrive && i > 0) {
      slack = s.arrive.t_s - arrive
      if (slack < 0) sp.push(`She is ${fmtMin(-slack)} late.`)
    }
    // She is there from when she arrives, or from her pinned arrival if she is early (she makes it on the dot).
    const there: number | null = arrive !== null && slack !== null && slack > 0 ? s.arrive!.t_s : arrive
    let depart: number | null = null
    if (there !== null) {
      const earliest: number = there + (s.stay_min ?? 0) * 60
      depart = s.depart ? Math.max(s.depart.t_s, there) : earliest
      if (s.depart && s.depart.t_s < earliest)
        sp.push(`Leaving at the pinned time cuts her stay short by ${fmtMin(earliest - s.depart.t_s)}.`)
    }
    if (there !== null && depart !== null && arrive !== null) {
      if (slack !== null && slack > 0) parts.push({ mode: 'wait', t0: arrive, t1: there, from: poss[i], to: poss[i] })
      parts.push({ mode: 'wait', t0: there, t1: depart, from: poss[i], to: poss[i] })
    }
    stops.push({
      index: i,
      label: labels[i],
      pos: poss[i],
      arrive: there,
      depart,
      arriveLocal: there === null ? null : local(there),
      departLocal: depart === null ? null : local(depart),
      slack,
      leg,
      problems: sp
    })
    prevDepart = depart
  }
  const times = stops.flatMap((s) => [s.arrive, s.depart]).filter((x): x is number => x !== null)
  return {
    id,
    name: f.name,
    color: f.color ?? '#e8a33d',
    stops,
    parts: parts.sort((a, b) => a.t0 - b.t0),
    start: times.length ? Math.min(...times) : null,
    end: times.length ? Math.max(...times) : null,
    problems
  }
}

/** Where she is at time t, on the plan (null off it, or outside the itinerary). */
export function positionAt(r: ItineraryReport, t: number): { pos: XY | null; mode: ItineraryPart['mode'] | null } {
  for (const p of r.parts) {
    if (t < p.t0 || t > p.t1) continue
    if (!p.from || !p.to) return { pos: p.to && t >= p.t1 ? p.to : null, mode: p.mode }
    const k = p.t1 > p.t0 ? (t - p.t0) / (p.t1 - p.t0) : 1
    return { pos: [p.from[0] + (p.to[0] - p.from[0]) * k, p.from[1] + (p.to[1] - p.from[1]) * k], mode: p.mode }
  }
  return { pos: null, mode: null }
}

export interface Encounter {
  a: string
  b: string
  t0: number
  t1: number
  /** Where, on the plan. */
  pos: XY
  /** The stop either was at, if one was. */
  label: string | null
}

/** When two people are within `within` m of each other, minute by minute. */
export function encounters(reports: readonly ItineraryReport[], within = 30, step = 60): Encounter[] {
  const out: Encounter[] = []
  for (let i = 0; i < reports.length; i++)
    for (let j = i + 1; j < reports.length; j++) {
      const a = reports[i]
      const b = reports[j]
      if (a.start === null || b.start === null || a.end === null || b.end === null) continue
      const lo = Math.max(a.start, b.start)
      const hi = Math.min(a.end, b.end)
      let open: Encounter | null = null
      for (let t = lo; t <= hi; t += step) {
        const pa = positionAt(a, t).pos
        const pb = positionAt(b, t).pos
        const near = pa && pb && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) <= within
        if (near && !open) {
          const stop = [...a.stops, ...b.stops].find((s) => s.pos && Math.hypot(s.pos[0] - pa![0], s.pos[1] - pa![1]) <= within)
          open = { a: a.id, b: b.id, t0: t, t1: t, pos: pa!, label: stop?.label ?? null }
        } else if (near && open) open.t1 = t
        else if (!near && open) {
          out.push(open)
          open = null
        }
      }
      if (open) out.push(open)
    }
  return out.sort((x, y) => x.t0 - y.t0)
}

/** Every itinerary in the world, worked out, and when their people meet. */
export function itineraryOverview(world: WorldData, env: WorldEnv): { reports: ItineraryReport[]; encounters: Encounter[] } {
  const reports = entitiesOf(world, itineraryKind).map((e) => itineraryReport(world, env, e.id, e.value))
  return { reports, encounters: encounters(reports) }
}
