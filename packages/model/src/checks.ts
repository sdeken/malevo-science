/**
 * Checks (docs/PLAN.md §7.9). Each check reads a world and reports issues;
 * none of them writes. Findings are advice: a half-finished world is normal,
 * so nothing here blocks saving.
 */
import { compareStrings, formatInstant, parseGeneratedId, parseInstant, type Calendar, type CalendarSet } from '@malevo/core'
import { staleLocks } from './deps'
import { cultureSettings, relationId, systemHistory } from './cultures'
import { resolveEvents, whenResolver, worldCalendars, type WorldEnv } from './events'
import { systemInfo, worldStars } from './systems'
import { allRoutes, nodePath, routeWorld, trafficReport, waypointNode } from './routes'
import { historySettings } from './history'
import { SURFACE_CLASSES } from './terrain'
import { templateFiles } from './template'
import {
  calendarKind,
  cultureKind,
  entityKey,
  eventKind,
  physicsKind,
  polityKind,
  relationKind,
  systemKind,
  terrainKind,
  type CalendarFile,
  type StoredInstant
} from './kinds'
import { entitiesOf, type Issue, type WorldData } from './load'

export interface Check {
  id: string
  title: string
  run(world: WorldData, env: WorldEnv): Issue[]
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const

/** Issues found while reading files: JSON errors, schema errors, stray files. */
export const filesCheck: Check = {
  id: 'files',
  title: 'Files parse and match their schemas',
  run: (world) => world.issues
}

export const referencesCheck: Check = {
  id: 'references',
  title: 'Every reference points at something that exists',
  run(world) {
    const kinds = new Map(world.kinds.map((k) => [k.kind, k]))
    const out: Issue[] = []
    for (const e of world.entities.values()) {
      for (const r of e.refs) {
        const kind = kinds.get(r.kind)
        const target = kind ? entityKey(kind, r.id) : null
        if (!target || !world.entities.has(target)) {
          out.push({
            severity: 'error',
            check: 'references',
            code: 'dangling-ref',
            message: `Refers to ${kind?.label ?? r.kind} "${r.id}", which does not exist.`,
            path: e.path,
            field: r.field
          })
        }
      }
    }
    return out
  }
}

export const locksCheck: Check = {
  id: 'locks',
  title: 'Locked values are up to date with their inputs',
  run: (world) =>
    staleLocks(world).map((s) => ({
      severity: 'warning' as const,
      check: 'locks',
      code: s.current === null ? 'lock-input-missing' : 'stale-lock',
      message:
        s.current === null
          ? `Was locked using ${s.input}, which no longer exists.`
          : `Was locked using ${s.input}, which has changed since. Accept the locked value as it is, or re-roll it.`,
      path: s.path,
      field: 'lock.inputs'
    }))
}

export const formatCheck: Check = {
  id: 'format',
  title: 'Files are in canonical form',
  run(world) {
    const out: Issue[] = []
    for (const e of world.entities.values()) {
      if (e.canonical !== null && e.text !== e.canonical) {
        out.push({
          severity: 'info',
          check: 'format',
          code: 'not-canonical',
          message:
            'Not in canonical form (key order, number precision or layout). `malevo check --fix` rewrites it; the values do not change.',
          path: e.path
        })
      }
    }
    return out
  }
}

export const templateCheck: Check = {
  id: 'template',
  title: 'The world has its settings files',
  run(world) {
    const have = new Set([...world.entities.values()].map((e) => e.path))
    return templateFiles()
      .filter((f) => f.path.startsWith('settings/') && !have.has(f.path))
      .map((f) => ({
        severity: 'warning' as const,
        check: 'template',
        code: f.path === physicsKind.file ? 'no-physics' : 'missing-settings',
        message: `There is no ${f.path}, so what depends on it cannot be worked out. Add the missing template files (Checks tool, or \`malevo template\`).`
      }))
  }
}

export const systemsCheck: Check = {
  id: 'systems',
  title: 'Systems sit on stars that exist, and their bodies have workable orbits',
  run(world, env) {
    const out: Issue[] = []
    for (const e of entitiesOf(world, systemKind)) {
      const info = systemInfo(world, env, e.id)
      if (!info) continue
      if (info.starError) {
        const unavailable = info.starError.includes('not available')
        out.push({
          severity: unavailable ? 'info' : 'error',
          check: 'systems',
          code: unavailable ? 'no-catalogue' : 'missing-star',
          message: info.starError,
          path: e.path,
          field: 'star'
        })
      } else if (info.star && info.star.physics.mass === null) {
        out.push({
          severity: 'warning',
          check: 'systems',
          code: 'star-mass-unknown',
          message: `The star (${info.star.record.spect || 'unknown type'}) is not on the main sequence, so its mass cannot be estimated. Give it one in starOverrides.mass_msun.`,
          path: e.path,
          field: 'starOverrides'
        })
      }
      const byId = new Map(info.bodies.map((b) => [b.id, b]))
      for (const b of info.bodies) {
        const path = `bodies/${b.id}.json`
        if (b.error && !(info.starError && !b.parent))
          out.push({ severity: 'error', check: 'systems', code: 'bad-body', message: b.error, path })
        if (!b.elements) continue
        const peri = b.elements.a * (1 - b.elements.e)
        const parent = b.parent ? byId.get(b.parent) : null
        if (parent && parent.hill !== null && b.elements.a * (1 + b.elements.e) > parent.hill * 0.5) {
          out.push({
            severity: 'warning',
            check: 'systems',
            code: 'moon-unbound',
            message: `Its orbit reaches beyond half of ${parent.name}'s Hill sphere, where moons are not stable.`,
            path
          })
        }
        const hostRadius = parent ? parent.radius : (info.star?.physics.radius ?? 0) * 6.957e8
        if (peri < hostRadius * 1.05)
          out.push({
            severity: 'error',
            check: 'systems',
            code: 'inside-host',
            message: `Its orbit dips inside ${parent ? parent.name : 'the star'}.`,
            path
          })
      }
      // Neighbouring orbits around the same host that cross.
      const groups = new Map<string | null, typeof info.bodies>()
      // Belts overlap by nature, and dwarf planets cross giants' orbits (Pluto crosses Neptune's).
      for (const b of info.bodies)
        if (b.elements && b.cls !== 'belt' && b.cls !== 'dwarf') groups.set(b.parent, [...(groups.get(b.parent) ?? []), b])
      for (const list of groups.values()) {
        const sorted = [...list].sort((x, y) => x.elements!.a - y.elements!.a)
        for (let i = 1; i < sorted.length; i++) {
          const inner = sorted[i - 1].elements!
          const outer = sorted[i].elements!
          if (inner.a * (1 + inner.e) > outer.a * (1 - outer.e)) {
            out.push({
              severity: 'warning',
              check: 'systems',
              code: 'crossing-orbits',
              message: `Its orbit crosses ${sorted[i - 1].name}'s; that rarely lasts.`,
              path: `bodies/${sorted[i].id}.json`
            })
          }
        }
      }
    }
    return out
  }
}

export const calendarsCheck: Check = {
  id: 'calendars',
  title: 'Calendars can be built, scripts load and round-trip, and stored dates still read as entered',
  run(world, env) {
    const out: Issue[] = []
    const cals = worldCalendars(world, env)
    const pathOf = (id: string): string | undefined => world.entities.get(`${calendarKind.kind}/${id}`)?.path
    for (const [id, message] of [...cals.errors].sort(([a], [b]) => compareStrings(a, b))) {
      out.push({ severity: 'error', check: 'calendars', code: 'bad-calendar', message, path: pathOf(id) })
    }
    // Scripts with no script calendar to belong to.
    for (const path of world.scripts.keys()) {
      const id = path.slice(calendarKind.folder!.length + 1, -3)
      const e = world.entities.get(`${calendarKind.kind}/${id}`)
      if (!e || (e.value !== undefined && (e.value as CalendarFile).kind !== 'script')) {
        out.push({
          severity: 'warning',
          check: 'calendars',
          code: 'unused-script',
          message: `There is no script calendar "${id}" to use this script.`,
          path
        })
      }
    }
    // Script calendars must read back what they write.
    for (const e of entitiesOf(world, calendarKind)) {
      if (e.value.kind !== 'script') continue
      const cal = cals.set.get(e.id)
      if (!cal) continue
      const problem = roundTripProblem(cal)
      if (problem)
        out.push({
          severity: 'error',
          check: 'calendars',
          code: 'script-round-trip',
          message: problem,
          path: `${calendarKind.folder}/${e.id}.js`
        })
    }
    // Every stored instant that remembers how it was entered should still read that way.
    for (const e of entitiesOf(world, calendarKind)) {
      const c = e.value as CalendarFile
      if ('epoch' in c) {
        const issue = enteredTextDrift(c.epoch, cals.set)
        if (issue)
          out.push({ severity: 'warning', check: 'calendars', code: 'entered-text-drift', message: issue, path: e.path, field: 'epoch' })
      }
    }
    return out
  }
}

/** Sample instants across ±10,000 years: fromFields(toFields(t)) must give t back. */
export function roundTripProblem(cal: Calendar): string | null {
  const span = 10_000 * 365.25 * 86_400
  for (let k = -50; k <= 50; k++) {
    const t = Math.round((k / 50) * span + k * 7919.5)
    try {
      const back = cal.fromFields(cal.toFields(t))
      if (Math.abs(back - t) > 1e-3)
        return `It does not read back what it writes: ${t} s became ${back} s after toFields() and fromFields().`
    } catch (err) {
      return (err as Error).message
    }
  }
  return null
}

export const eventsCheck: Check = {
  id: 'events',
  title: 'Every event resolves to a time, and dates still read as entered',
  run(world, env) {
    const out: Issue[] = []
    const cals = worldCalendars(world, env)
    const resolved = resolveEvents(world, cals)
    for (const e of entitiesOf(world, eventKind)) {
      const r = resolved.get(e.id)!
      for (const m of r.errors)
        out.push({
          severity: 'error',
          check: 'events',
          code: 'unresolved-event',
          message: `Its time cannot be worked out: ${m}`,
          path: e.path
        })
      for (const m of r.warnings) out.push({ severity: 'warning', check: 'events', code: 'event-span', message: m, path: e.path })
      for (const [field, w] of [
        ['when', e.value.when],
        ['until', e.value.until]
      ] as const) {
        if (!w?.at) continue
        const drift = enteredTextDrift({ ...w.at, cal: w.at.cal ?? w.cal }, cals.set)
        if (drift)
          out.push({ severity: 'warning', check: 'events', code: 'entered-text-drift', message: drift, path: e.path, field: `${field}.at` })
      }
    }
    return out
  }
}

/** If an instant's entered text no longer reads back to the same instant in its calendar, say how it reads now. */
export function enteredTextDrift(instant: StoredInstant, set: CalendarSet): string | null {
  if (!instant.cal || !instant.text) return null
  const cal = set.get(instant.cal)
  if (!cal) return null
  const parsed = parseInstant(cal, instant.text)
  if (parsed === null) return `Was entered as "${instant.text}" in calendar "${instant.cal}", which no longer reads that text as a date.`
  if (Math.abs(parsed - instant.t_s) < 0.5) return null
  let now: string
  try {
    now = formatInstant(cal, instant.t_s, 'second')
  } catch {
    now = '(unreadable)'
  }
  return `Was entered as "${instant.text}" in calendar "${instant.cal}", but that calendar now writes the stored time as "${now}". The stored time has not moved.`
}

export const culturesCheck: Check = {
  id: 'cultures',
  title: 'Cultures use defined traits; relations, polities and system histories hang together',
  run(world, env) {
    const out: Issue[] = []
    const add = (severity: Issue['severity'], code: string, message: string, path: string, field?: string): void => {
      out.push({ severity, check: 'cultures', code, message, path, field })
    }
    const settings = cultureSettings(world)
    const defined = new Set(settings?.traits.map((t) => t.id) ?? [])
    for (const e of entitiesOf(world, cultureKind)) {
      for (const k of Object.keys(e.value.traits)) {
        if (settings && !defined.has(k))
          add('warning', 'unknown-trait', `Trait "${k}" is not defined in settings/cultures.json, so it is ignored.`, e.path, `traits.${k}`)
      }
    }
    const resolver = whenResolver(world, worldCalendars(world, env))
    const events = resolver.events()
    const eventTime = (id: string, from: 'start' | 'end'): number | null =>
      (from === 'end' ? events.get(id)?.end?.t : events.get(id)?.start?.t) ?? null
    for (const e of entitiesOf(world, relationKind)) {
      const [a, b] = e.value.between
      if (a === b) add('error', 'bad-relation', 'A relation is between two different cultures.', e.path, 'between')
      else if (e.id !== relationId(a, b))
        add('error', 'bad-relation', `The relation between "${a}" and "${b}" belongs in relations/${relationId(a, b)}.json.`, e.path)
      for (const [i, c] of (e.value.changes ?? []).entries()) {
        if (world.entities.has(`event/${c.event}`) && eventTime(c.event, c.from ?? 'start') === null) {
          add(
            'warning',
            'change-unplaced',
            `Its change at "${c.event}" is ignored: that event's ${c.from ?? 'start'} cannot be worked out.`,
            e.path,
            `changes[${i}]`
          )
        }
      }
    }
    for (const e of entitiesOf(world, polityKind)) {
      const f = e.value.founded ? eventTime(e.value.founded, 'start') : null
      const d = e.value.dissolved ? eventTime(e.value.dissolved, 'start') : null
      if (f !== null && d !== null && d < f) add('warning', 'polity-dates', 'It is dissolved before it is founded.', e.path, 'dissolved')
    }
    for (const e of entitiesOf(world, systemKind)) {
      const history = systemHistory(e.value, resolver)
      for (const h of history) {
        const field = `history[${h.index}]`
        for (const m of h.errors) add('error', 'history-date', `Its history entry's date cannot be worked out: ${m}`, e.path, field)
        if (!h.polity && h.cultures.length === 0 && !e.value.history?.[h.index]?.cultures?.length) {
          add('warning', 'empty-history', 'A history entry with neither a polity nor any cultures says nothing.', e.path, field)
        } else if ((e.value.history?.[h.index]?.cultures?.length ?? 0) > 0 && h.cultures.length === 0) {
          add('warning', 'empty-shares', 'Its culture shares add up to nothing.', e.path, field)
        }
      }
      for (let i = 1; i < history.length; i++) {
        if (history[i].t !== null && history[i].t === history[i - 1].t) {
          add(
            'warning',
            'same-date',
            'Two history entries start at the same moment; the later one in the file wins.',
            e.path,
            `history[${history[i].index}]`
          )
        }
      }
    }
    return out
  }
}

export const routesCheck: Check = {
  id: 'routes',
  title: 'Routes are flyable and traffic balances at every node',
  run(world, env) {
    const out: Issue[] = []
    const rw = routeWorld(world, env)
    const stars = worldStars(world, env)
    const limit = rw.physics?.foam.legLimit_ly
    const nebulaName = new Map(rw.nebulae.map((n) => [n.id, n.name]))
    // Where to report a node that has no file of its own: the first route through it.
    const routeOf = new Map<string, string>()
    for (const r of allRoutes(world, env)) {
      const path = `routes/${r.id}.json`
      const issue = (severity: Issue['severity'], code: string, message: string, field?: string): void => {
        out.push({ severity, check: 'routes', code, message, path, field })
      }
      r.file.waypoints.forEach((w, i) => {
        const node = waypointNode(w)
        if (!node) {
          issue('error', 'bad-waypoint', `Waypoint ${i + 1} must name exactly one system, station or star.`, `waypoints[${i}]`)
          return
        }
        if (!routeOf.has(node)) routeOf.set(node, path)
        if (w.star && !rw.node(node).pos && (parseGeneratedId(w.star) || stars.catalogAvailable))
          issue('error', 'missing-star', `Waypoint ${i + 1}: star "${w.star}" does not exist.`, `waypoints[${i}].star`)
        if (i > 0 && node === waypointNode(r.file.waypoints[i - 1]))
          issue('error', 'repeated-waypoint', `Waypoints ${i} and ${i + 1} are the same place.`, `waypoints[${i}]`)
      })
      for (const l of r.legs) {
        const field = `waypoints[${l.index + 1}]`
        if (l.tooLong)
          issue(
            'error',
            'leg-too-long',
            `The leg from waypoint ${l.index + 1} to ${l.index + 2} is ${l.ly!.toFixed(2)} ly, beyond the leg limit of ${limit} ly.`,
            field
          )
        for (const n of l.nebulae)
          issue(
            'error',
            'crosses-nebula',
            `The leg from waypoint ${l.index + 1} to ${l.index + 2} crosses ${nebulaName.get(n) ?? n}.`,
            field
          )
      }
      for (const s of r.services) if (s.error) issue('error', 'bad-service', `Service ${s.index + 1}: ${s.error}`, `services[${s.index}]`)
    }
    const report = trafficReport(world, env)
    if (report) {
      const fmt = (n: number): string => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toPrecision(3).replace(/\.?0+$/, ''))
      for (const b of report.unbalanced) {
        const [, name] = b.node.split(/:(.*)/)
        const declared = b.declared ? ` (declared: ${fmt(b.declared)})` : ''
        out.push({
          severity: 'warning',
          check: 'routes',
          code: 'unbalanced',
          message: `${name}: ${fmt(b.arrivals)} ships/day arrive and ${fmt(b.departures)} leave, a net ${b.net > 0 ? 'gain' : 'loss'} of ${fmt(Math.abs(b.net))}${declared}. Add return traffic, or declare the imbalance (declaredNet_perDay).`,
          path: nodePath(b.node) ?? routeOf.get(b.node)
        })
      }
      if (Math.abs(report.declaredTotal) > 1e-6)
        out.push({
          severity: 'warning',
          check: 'routes',
          code: 'declared-total',
          message: `Declared imbalances add up to ${fmt(report.declaredTotal)} ships/day, not 0. Every ship that arrives somewhere left somewhere else, so sinks must be matched by sources.`
        })
    }
    return out
  }
}

/** With history settings, the timeline gates capabilities: nothing settled or flown before it could be (docs/PLAN.md §7.3). */
export const historyCheck: Check = {
  id: 'history',
  title: 'Nothing is settled or flown before the technology for it exists',
  run(world, env) {
    const s = historySettings(world)
    if (!s) return []
    const out: Issue[] = []
    const resolver = whenResolver(world, worldCalendars(world, env))
    const events = resolver.events()
    const t = (id: string): number | null => events.get(id)?.start?.t ?? null
    const slow = t(s.slowShips)
    const foam = t(s.foamDrive)
    const rw = routeWorld(world, env)
    const origin = rw.node(`system:${s.origin}`).pos
    for (const e of entitiesOf(world, systemKind)) {
      if (e.id === s.origin) continue
      const first = systemHistory(e.value, resolver).find((h) => h.t !== null)
      if (!first) continue
      const p = rw.node(`system:${e.id}`).pos
      const far = p && origin ? Math.hypot(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]) : null
      if (slow !== null && first.t! < slow)
        out.push({
          severity: 'warning',
          check: 'history',
          code: 'settled-too-early',
          message: 'It is settled before the slow-ship event, before any ship could reach it.',
          path: e.path,
          field: 'history'
        })
      else if (foam !== null && first.t! < foam && far !== null && far > s.slow.reach_ly)
        out.push({
          severity: 'warning',
          check: 'history',
          code: 'beyond-slow-ships',
          message: `It is settled before the foam drive, but it is ${far.toFixed(1)} ly from the origin, beyond slow ships' ${s.slow.reach_ly} ly.`,
          path: e.path,
          field: 'history'
        })
    }
    if (foam !== null)
      for (const r of allRoutes(world, env)) {
        if (!r.file.opened) continue
        const opened = resolver.resolve(r.file.opened).time?.t
        if (opened !== undefined && opened < foam)
          out.push({
            severity: 'warning',
            check: 'history',
            code: 'route-before-foam',
            message: 'It opens before the foam drive exists.',
            path: `routes/${r.id}.json`,
            field: 'opened'
          })
      }
    return out
  }
}

export const terrainCheck: Check = {
  id: 'terrain',
  title: 'Each terrain belongs to one body that has a surface',
  run(world) {
    const out: Issue[] = []
    const seen = new Map<string, string>()
    for (const e of [...entitiesOf(world, terrainKind)].sort((a, b) => compareStrings(a.id, b.id))) {
      const body = world.entities.get(`body/${e.value.body}`)?.value as { class?: string; name?: string } | undefined
      if (body && !SURFACE_CLASSES.includes(body.class as never))
        out.push({
          severity: 'warning',
          check: 'terrain',
          code: 'no-surface',
          message: `${body.name ?? e.value.body} is a ${body.class}, which has no solid surface to shape.`,
          path: e.path,
          field: 'body'
        })
      const other = seen.get(e.value.body)
      if (other)
        out.push({
          severity: 'error',
          check: 'terrain',
          code: 'two-terrains',
          message: `${e.value.body} already has a terrain in ${other}.`,
          path: e.path,
          field: 'body'
        })
      else seen.set(e.value.body, e.path)
    }
    return out
  }
}

export const BUILTIN_CHECKS: readonly Check[] = [
  filesCheck,
  referencesCheck,
  locksCheck,
  calendarsCheck,
  eventsCheck,
  systemsCheck,
  culturesCheck,
  routesCheck,
  historyCheck,
  terrainCheck,
  templateCheck,
  formatCheck
]

/** Run checks and return their findings, most severe first, then by file. */
export function runChecks(world: WorldData, env: WorldEnv = {}, checks: readonly Check[] = BUILTIN_CHECKS): Issue[] {
  return checks
    .flatMap((c) => c.run(world, env))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        compareStrings(a.path ?? '', b.path ?? '') ||
        compareStrings(a.field ?? '', b.field ?? '') ||
        compareStrings(a.message, b.message)
    )
}

/** Files whose text differs from their canonical form, with the canonical text. Values never change. */
export function canonicalFixes(world: WorldData): { path: string; text: string }[] {
  return [...world.entities.values()]
    .filter((e) => e.canonical !== null && e.text !== e.canonical)
    .sort((a, b) => compareStrings(a.path, b.path))
    .map((e) => ({ path: e.path, text: e.canonical! }))
}
