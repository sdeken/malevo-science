/**
 * The history generator, wired to a world (docs/PLAN.md §7.3).
 *
 * `historyInput` gathers what history@1 plays out from the world's own files:
 * the settings, the events that bring each capability, the stars, the
 * polities, and every system that already exists (a fixed point: settled at
 * its first dated history entry, or, with none, a place the run should reach).
 * `proposeHistory` runs it and turns the result into proposed files (new
 * systems, cultures, routes and events, and changes to polities' capitals),
 * each locked to history@1. Nothing is written: the author accepts pieces.
 *
 * `newsArrival` answers "when did each system learn of this event": by radio
 * at the speed of light, or by ship over the routes open at the time, after
 * the foam drive, whichever is first.
 */
import { DAY, JULIAN_YEAR, LY, compareStrings, starPhysics, type Ellipsoid } from '@malevo/core'
import { history, runGenerator, type FixedSettlement, type HistoryInput, type HistoryOutput, type HistoryStar } from '@malevo/gen'
import { cultureFiles, systemHistory } from './cultures'
import type { WorldEnv } from './env'
import { whenResolver, worldCalendars, type WhenResolver } from './events'
import {
  cultureKind,
  entityKey,
  eventKind,
  historySettingsKind,
  physicsKind,
  polityKind,
  routeKind,
  systemKind,
  type HistorySettings,
  type KindDef,
  type PhysicsSettings,
  type RouteFile,
  type SystemFile
} from './kinds'
import { entitiesOf, type WorldData } from './load'
import { allRoutes, routeWorld, tripTime } from './routes'
import { worldStars } from './systems'

export const HISTORY_GEN = 'history@1'

const yearOf = (t: number): number => t / JULIAN_YEAR
const tOf = (y: number): number => Math.round(y * JULIAN_YEAR)

export function historySettings(world: WorldData): HistorySettings | null {
  return (world.entities.get(historySettingsKind.kind)?.value as HistorySettings | undefined) ?? null
}

/** Ids made from names: lowercase, hyphenated, unique among `taken`. */
export function slugFrom(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

interface Prepared {
  input: HistoryInput
  seed: number
  resolver: WhenResolver
  /** Existing systems by star id. */
  systemsByStar: Map<string, { id: string; file: SystemFile }>
}

export function historyInput(world: WorldData, env: WorldEnv, seedOverride?: number): Prepared | { error: string } {
  const s = historySettings(world)
  if (!s) return { error: 'This world has no settings/history.json yet.' }
  const physics = world.entities.get(physicsKind.kind)?.value as PhysicsSettings | undefined
  if (!physics) return { error: 'The history needs settings/physics.json.' }
  const resolver = whenResolver(world, worldCalendars(world, env))
  const events = resolver.events()
  const at = (id: string, what: string): number | { error: string } => {
    const t = events.get(id)?.start?.t
    return t === undefined ? { error: `The ${what} event "${id}" has no date that can be worked out.` } : yearOf(t)
  }
  const slow = at(s.slowShips, 'slow-ship')
  const foam = at(s.foamDrive, 'foam drive')
  const end = at(s.end, 'end')
  for (const x of [slow, foam, end]) if (typeof x !== 'number') return x
  if ((foam as number) < (slow as number)) return { error: 'The foam drive comes before slow ships.' }
  if ((end as number) <= (foam as number)) return { error: 'The run ends before the foam drive.' }
  let polYear: number | null = null
  if (s.polities) {
    const p = at(s.polities.from, 'polities')
    if (typeof p !== 'number') return p
    polYear = p
  }
  const originSys = world.entities.get(`${systemKind.kind}/${s.origin}`)?.value as SystemFile | undefined
  if (!originSys) return { error: `The origin system "${s.origin}" does not exist.` }
  const stars = worldStars(world, env)
  const originStar = stars.get(originSys.star)
  if (!originStar) return { error: `The origin system's star ${originSys.star} cannot be found.` }

  // The stars the run may use: everything within its radius of the origin, plus a leg of margin.
  const radius = s.growth.maxRadius_ly + physics.foam.legLimit_ly
  const list: HistoryStar[] = []
  const seen = new Set<string>()
  for (const st of stars.near(originStar.pos, radius)) {
    if (seen.has(st.id)) continue
    seen.add(st.id)
    list.push({
      id: st.id,
      pos: [st.pos[0], st.pos[1], st.pos[2]],
      cls: starPhysics(st).mass === null ? 'X' : st.cls || 'M',
      name: st.name
    })
  }

  const cultures = cultureFiles(world)
  const palettes: Record<string, number> = {}
  for (const [id, c] of cultures) palettes[id] = c.palette ?? 0

  // Every existing system is a fixed point.
  const systemsByStar = new Map<string, { id: string; file: SystemFile }>()
  const fixed: FixedSettlement[] = []
  for (const e of [...entitiesOf(world, systemKind)].sort((a, b) => compareStrings(a.id, b.id))) {
    if (systemsByStar.has(e.value.star)) continue
    systemsByStar.set(e.value.star, { id: e.id, file: e.value })
    const h = systemHistory(e.value, resolver).filter((x) => x.t !== null)
    const first = h[0]
    const withPolity = [...h].reverse().find((x) => x.polity !== null)
    fixed.push({
      star: e.value.star,
      year: first ? yearOf(first.t!) : null,
      polity: withPolity ? withPolity.polity : undefined,
      mix: first && first.cultures.length ? Object.fromEntries(first.cultures.map((c) => [c.culture, c.share])) : null,
      name: e.value.name
    })
  }

  const polityCapital = (id: string): string | null => {
    const cap = (world.entities.get(`${polityKind.kind}/${id}`)?.value as { capital?: string } | undefined)?.capital
    const sys = cap ? (world.entities.get(`${systemKind.kind}/${cap}`)?.value as SystemFile | undefined) : undefined
    return sys?.star ?? null
  }
  const enclaves: HistoryInput['enclaves'] = []
  for (const e of s.enclaves ?? []) {
    let from = slow as number
    if (e.from) {
      const y = at(e.from, 'enclave')
      if (typeof y !== 'number') return y
      from = y
    }
    enclaves.push({ culture: e.culture, from })
  }
  const nebulae: Ellipsoid[] = routeWorld(world, env).nebulae.map((n) => n.shape)

  const input: HistoryInput = {
    stars: list,
    origin: originStar.id,
    originCulture: s.originCulture,
    palettes,
    legLimit: physics.foam.legLimit_ly,
    nebulae,
    years: { slow: slow as number, foam: foam as number, end: end as number, polities: polYear },
    step: s.step_y ?? 10,
    slow: { reach: s.slow.reach_ly, colonies: s.slow.colonies },
    growth: { total: s.growth.systems, maxRadius: s.growth.maxRadius_ly, outward: s.growth.outward_ly ?? 7, legs: s.growth.legs ?? 2 },
    culture: {
      enclave: s.culture.enclaveRate,
      split: s.culture.splitRate,
      splitDistance: s.culture.splitDistance_ly,
      blend: s.culture.blendRate
    },
    enclaves,
    polities: (s.polities?.list ?? []).map((p) => ({
      key: p.polity,
      share: p.share,
      capital: polityCapital(p.polity),
      unify: p.unify ?? 0
    })),
    fixed
  }
  return { input, seed: seedOverride ?? s.seed ?? world.manifest?.seed ?? 0, resolver, systemsByStar }
}

// ---- proposals ----

export type ProposalGroup = 'system' | 'culture' | 'route' | 'event' | 'polity'

export interface ProposedFile {
  /** Entity key, e.g. "system/kessa". */
  key: string
  kind: string
  id: string
  path: string
  value: Record<string, unknown>
  group: ProposalGroup
  label: string
  /** A change to a file that exists, rather than a new one. */
  change: boolean
  /** Year, for sorting and display. */
  year: number | null
  /** For the map: the star, or the stars of a route. */
  stars: string[]
}

export interface HistoryProposal {
  seed: number
  files: ProposedFile[]
  conflicts: string[]
  shares: HistoryOutput['shares']
  /** Summary counts. */
  counts: { systems: number; cultures: number; routes: number; events: number }
  /** Positions (ly) of every star the proposal mentions, for drawing it. */
  positions: Record<string, [number, number, number]>
  /** The origin star. */
  origin: string
}

export function proposeHistory(world: WorldData, env: WorldEnv, seedOverride?: number): HistoryProposal | { error: string } {
  const prep = historyInput(world, env, seedOverride)
  if ('error' in prep) return prep
  const out = runGenerator(history, prep.input, prep.seed)
  const lock = { gen: HISTORY_GEN, seed: prep.seed, inputs: {} }
  const files: ProposedFile[] = []
  const kinds = new Map(world.kinds.map((k) => [k.kind, k]))
  const pathOf = (kind: string, id: string): string => {
    const k = kinds.get(kind) as KindDef
    return k.file ?? `${k.folder}/${id}.json`
  }
  const takenIds = (kind: string): Set<string> => new Set(entitiesOf(world, kinds.get(kind) as KindDef).map((e) => e.id))
  const when = (year: number): { at: { t_s: number } } => ({ at: { t_s: tOf(year) } })

  // Cultures first: systems refer to them.
  const cultureIds = takenIds(cultureKind.kind)
  const cultureId = new Map<string, string>()
  for (const c of out.cultures) {
    const id = slugFrom(c.name, cultureIds)
    cultureId.set(c.key, id)
    files.push({
      key: entityKey(cultureKind as KindDef, id),
      kind: cultureKind.kind,
      id,
      path: pathOf(cultureKind.kind, id),
      value: {
        name: c.name,
        color: c.color,
        traits: {},
        palette: c.palette,
        tags: ['regional'],
        lock
      },
      group: 'culture',
      label: `${c.name}${c.parent ? `, branched from ${cultureId.get(c.parent) ?? c.parent}` : ''}`,
      change: false,
      year: c.founded,
      stars: [c.home]
    })
  }
  const shares = (m: Record<string, number> | null): { culture: string; share: number }[] | undefined => {
    if (!m) return undefined
    const list = Object.entries(m)
      .map(([k, v]) => ({ culture: cultureId.get(k) ?? k, share: Math.round(v * 1e4) / 1e4 }))
      .filter((x) => x.share > 0)
    return list.length ? list : undefined
  }

  // Systems: new ones, and history added to existing ones that have none.
  const systemIds = takenIds(systemKind.kind)
  const systemOfStar = new Map<string, string>()
  for (const [star, s] of prep.systemsByStar) systemOfStar.set(star, s.id)
  for (const s of out.systems) if (!systemOfStar.has(s.star)) systemOfStar.set(s.star, slugFrom(s.name, systemIds))
  for (const s of out.systems) {
    const existing = prep.systemsByStar.get(s.star)
    if (existing && (existing.file.history?.length ?? 0) > 0) continue // its own history stands
    const id = systemOfStar.get(s.star)!
    const entries: Record<string, unknown>[] = [
      { from: when(s.founded), cultures: shares(s.mixFounded), note: s.outpost ? 'Founded as an outpost' : 'Founded' }
    ]
    if (s.polity !== null && s.politySince !== null)
      entries.push({ from: when(s.politySince), polity: s.polity, cultures: shares(s.mixAtPolities) ?? shares(s.mixFounded) })
    entries.push({
      from: when(prep.input.years.end),
      polity: s.polity ?? undefined,
      cultures: shares(s.mixAtEnd),
      note: 'At the end of the run'
    })
    const value: Record<string, unknown> = existing
      ? { ...existing.file, history: entries }
      : { name: s.name, star: s.star, tags: s.outpost ? ['outpost'] : undefined, history: entries, lock }
    files.push({
      key: entityKey(systemKind as KindDef, id),
      kind: systemKind.kind,
      id,
      path: pathOf(systemKind.kind, id),
      value,
      group: 'system',
      label: `${s.name}${s.outpost ? ' (outpost)' : ''}${s.polity ? `, ${s.polity}` : ''}`,
      change: Boolean(existing),
      year: s.founded,
      stars: [s.star]
    })
  }

  // Routes: the foam-era lanes, unless a route already joins the same two ends.
  const routeIds = takenIds(routeKind.kind)
  const existingPairs = new Set<string>()
  for (const r of allRoutes(world, env)) {
    const a = r.nodes[0]
    const b = r.nodes[r.nodes.length - 1]
    if (a && b) existingPairs.add([a, b].sort(compareStrings).join('|'))
  }
  const nameOfSystem = new Map(out.systems.map((s) => [s.star, s.name]))
  const legOk = (l: { stars: string[] }): boolean => {
    const pos = new Map(prep.input.stars.map((x) => [x.id, x.pos]))
    for (let k = 1; k < l.stars.length; k++) {
      const a = pos.get(l.stars[k - 1])
      const b = pos.get(l.stars[k])
      if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > prep.input.legLimit) return false
    }
    return true
  }
  for (const lane of out.lanes) {
    // A slow-ship link that fits the leg limit becomes a foam route when the drive arrives.
    if (lane.slow && !legOk(lane)) continue
    const l = lane.slow ? { ...lane, opened: prep.input.years.foam } : lane
    const ends = [`system:${systemOfStar.get(l.stars[0])}`, `system:${systemOfStar.get(l.stars[l.stars.length - 1])}`]
      .sort(compareStrings)
      .join('|')
    if (existingPairs.has(ends)) continue
    existingPairs.add(ends)
    const name = `${nameOfSystem.get(l.stars[0]) ?? l.stars[0]} – ${nameOfSystem.get(l.stars[l.stars.length - 1]) ?? l.stars[l.stars.length - 1]}`
    const id = slugFrom(name, routeIds)
    const value: RouteFile & { lock: typeof lock } = {
      name,
      waypoints: l.stars.map((st) => (systemOfStar.has(st) ? { system: systemOfStar.get(st)! } : { star: st })),
      opened: when(l.opened),
      tags: ['history'],
      lock
    }
    files.push({
      key: entityKey(routeKind as KindDef, id),
      kind: routeKind.kind,
      id,
      path: pathOf(routeKind.kind, id),
      value: value as unknown as Record<string, unknown>,
      group: 'route',
      label: name,
      change: false,
      year: l.opened,
      stars: l.stars
    })
  }

  // Events.
  const eventIds = takenIds(eventKind.kind)
  for (const e of out.events) {
    const id = slugFrom(`history ${e.text.slice(0, 40)}`, eventIds)
    files.push({
      key: entityKey(eventKind as KindDef, id),
      kind: eventKind.kind,
      id,
      path: pathOf(eventKind.kind, id),
      value: {
        name: e.text.slice(0, 200),
        type: 'event',
        when: when(e.year),
        where: e.star && systemOfStar.has(e.star) ? systemOfStar.get(e.star) : undefined,
        tags: ['history'],
        lock
      },
      group: 'event',
      label: e.text,
      change: false,
      year: e.year,
      stars: e.star ? [e.star] : []
    })
  }

  // Polities without a capital get the one the run chose.
  for (const [polity, star] of Object.entries(out.capitals)) {
    const e = world.entities.get(`${polityKind.kind}/${polity}`)
    const v = e?.value as Record<string, unknown> | undefined
    if (!e || !v || v.capital) continue
    files.push({
      key: e.key,
      kind: polityKind.kind,
      id: e.id,
      path: e.path,
      value: { ...v, capital: systemOfStar.get(star) },
      group: 'polity',
      label: `${String(v.name ?? e.id)}: capital at ${nameOfSystem.get(star) ?? star}`,
      change: true,
      year: prep.input.years.polities,
      stars: [star]
    })
  }

  files.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || compareStrings(a.key, b.key))
  const posOf = new Map(prep.input.stars.map((x) => [x.id, x.pos]))
  const positions: Record<string, [number, number, number]> = {}
  for (const f of files) for (const st of f.stars) if (posOf.has(st)) positions[st] = posOf.get(st)!
  for (const st of prep.systemsByStar.keys()) if (posOf.has(st)) positions[st] = posOf.get(st)!
  return {
    origin: prep.input.origin,
    positions,
    seed: prep.seed,
    files,
    conflicts: out.conflicts,
    shares: out.shares,
    counts: {
      systems: files.filter((f) => f.group === 'system').length,
      cultures: files.filter((f) => f.group === 'culture').length,
      routes: files.filter((f) => f.group === 'route').length,
      events: files.filter((f) => f.group === 'event').length
    }
  }
}

// ---- news ----

export interface NewsArrival {
  system: string
  /** Universal time it arrived. */
  t: number
  via: 'here' | 'radio' | 'ships'
  /** The systems it passed through, for ships. */
  path: string[]
}

/**
 * When each system learned of an event: radio crosses the distance at the
 * speed of light; ships carry it over the routes open at the time, but only
 * once the foam drive exists (history settings), each leg taking the door-to-
 * door trip time plus half the gap between sailings when the route has a
 * service. Without a foam event, ships are assumed to be available always.
 */
export function newsArrival(
  world: WorldData,
  env: WorldEnv,
  eventId: string
): { from: string; t0: number; arrivals: NewsArrival[] } | { error: string } {
  const resolver = whenResolver(world, worldCalendars(world, env))
  const ev = world.entities.get(`${eventKind.kind}/${eventId}`)?.value as { where?: string } | undefined
  if (!ev) return { error: `There is no event "${eventId}".` }
  if (!ev.where) return { error: 'The event has no place (set "where" to the system it happened in).' }
  const t0 = resolver.events().get(eventId)?.start?.t
  if (t0 === undefined) return { error: 'The event has no date that can be worked out.' }
  const rw = routeWorld(world, env)
  const settings = historySettings(world)
  const foamT = settings ? (resolver.events().get(settings.foamDrive)?.start?.t ?? null) : null
  const src = `system:${ev.where}`
  const srcPos = rw.node(src).pos
  if (!srcPos) return { error: `The system "${ev.where}" has no position.` }

  // Ship legs, with the times each is open.
  interface Leg {
    to: string
    time: number
    wait: number
    opened: number
    closed: number
  }
  const legs = new Map<string, Leg[]>()
  const addLeg = (a: string, b: string, l: Leg): void => {
    if (!legs.has(a)) legs.set(a, [])
    legs.get(a)!.push({ ...l, to: b })
  }
  for (const r of allRoutes(world, env)) {
    const opened = r.file.opened ? (resolver.resolve(r.file.opened).time?.t ?? -Infinity) : -Infinity
    const closed = r.file.closed ? (resolver.resolve(r.file.closed).time?.t ?? Infinity) : Infinity
    for (let i = 0; i < r.nodes.length - 1; i++) {
      const a = r.nodes[i]
      const b = r.nodes[i + 1]
      if (!a || !b) continue
      for (const [x, y, fi, ti] of [
        [a, b, i, i + 1],
        [b, a, i + 1, i]
      ] as const) {
        const time = tripTime(rw, [x, y])
        if (time === null) continue
        // Half the gap between ships on services that run this way along this leg.
        const perDay = r.services
          .filter((s) => !s.error && ((s.from <= fi && s.to >= ti && fi < ti) || (s.from >= fi && s.to <= ti && fi > ti)))
          .reduce((sum, s) => sum + s.perDay, 0)
        addLeg(x, y, { to: y, time, wait: perDay > 0 ? DAY / (2 * perDay) : 0, opened, closed })
      }
    }
  }

  // Earliest arrival by ship (Dijkstra on arrival time).
  const best = new Map<string, { t: number; prev: string | null }>([[src, { t: t0, prev: null }]])
  const done = new Set<string>()
  for (;;) {
    let u: string | null = null
    for (const [k, v] of best) if (!done.has(k) && (u === null || v.t < best.get(u)!.t)) u = k
    if (u === null) break
    done.add(u)
    const tu = best.get(u)!.t
    for (const l of legs.get(u) ?? []) {
      let depart = Math.max(tu, l.opened)
      if (foamT !== null) depart = Math.max(depart, foamT)
      if (depart > l.closed) continue
      const t = depart + l.wait + l.time
      const cur = best.get(l.to)
      if (!cur || t < cur.t) best.set(l.to, { t, prev: u })
    }
  }

  const arrivals: NewsArrival[] = []
  for (const e of entitiesOf(world, systemKind)) {
    const node = `system:${e.id}`
    if (node === src) {
      arrivals.push({ system: e.id, t: t0, via: 'here', path: [] })
      continue
    }
    const p = rw.node(node).pos
    const radio = p ? t0 + Math.hypot(p[0] - srcPos[0], p[1] - srcPos[1], p[2] - srcPos[2]) * (LY / 299_792_458) : Infinity
    const ship = best.get(node)
    if (ship && ship.t < radio) {
      const path: string[] = []
      for (let k: string | null = node; k; k = best.get(k)?.prev ?? null) path.unshift(k.replace(/^system:/, ''))
      arrivals.push({ system: e.id, t: ship.t, via: 'ships', path })
    } else if (Number.isFinite(radio)) arrivals.push({ system: e.id, t: radio, via: 'radio', path: [] })
  }
  arrivals.sort((a, b) => a.t - b.t || compareStrings(a.system, b.system))
  return { from: ev.where, t0, arrivals }
}
