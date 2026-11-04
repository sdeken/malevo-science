/**
 * Checks (docs/PLAN.md §7.9). Each check reads a world and reports issues;
 * none of them writes. Findings are advice: a half-finished world is normal,
 * so nothing here blocks saving.
 */
import { compareStrings, formatInstant, parseInstant, type Calendar, type CalendarSet } from '@malevo/core'
import { staleLocks } from './deps'
import { resolveEvents, worldCalendars, type WorldEnv } from './events'
import { calendarKind, entityKey, eventKind, physicsKind, type CalendarFile, type StoredInstant } from './kinds'
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

export const physicsCheck: Check = {
  id: 'physics',
  title: 'The world has physics settings',
  run: (world) =>
    world.entities.has(physicsKind.kind)
      ? []
      : [
          {
            severity: 'warning',
            check: 'physics',
            code: 'no-physics',
            message: `There is no ${physicsKind.file}, so nothing that depends on the setting's physics can be worked out. \`malevo template\` adds a starting copy.`
          }
        ]
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

export const BUILTIN_CHECKS: readonly Check[] = [
  filesCheck,
  referencesCheck,
  locksCheck,
  calendarsCheck,
  eventsCheck,
  physicsCheck,
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
