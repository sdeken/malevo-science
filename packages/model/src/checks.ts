/**
 * Checks (docs/PLAN.md §7.9). Each check reads a world and reports issues;
 * none of them writes. Findings are advice: a half-finished world is normal,
 * so nothing here blocks saving.
 */
import { buildCalendars, formatInstant, parseInstant, type CalendarDef, compareStrings } from '@malevo/core'
import { staleLocks } from './deps'
import { calendarDef, calendarKind, entityKey, physicsKind, type CalendarFile, type StoredInstant } from './kinds'
import { entitiesOf, type Issue, type WorldData } from './load'

export interface Check {
  id: string
  title: string
  run(world: WorldData): Issue[]
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

/** The world's calendar definitions, ready for @malevo/core. */
export function calendarDefs(world: WorldData): Record<string, CalendarDef> {
  const defs: Record<string, CalendarDef> = {}
  for (const e of entitiesOf(world, calendarKind)) defs[e.id] = calendarDef(e.value)
  return defs
}

export const calendarsCheck: Check = {
  id: 'calendars',
  title: 'Calendars can be built, and stored dates still read as entered',
  run(world) {
    const out: Issue[] = []
    const set = buildCalendars(calendarDefs(world))
    for (const err of set.errors) {
      const e = world.entities.get(`${calendarKind.kind}/${err.id}`)
      out.push({ severity: 'error', check: 'calendars', code: 'bad-calendar', message: err.message, path: e?.path })
    }
    // Every stored instant that remembers how it was entered should still read that way.
    for (const e of entitiesOf(world, calendarKind)) {
      const c = e.value as CalendarFile
      if ('epoch' in c) {
        const issue = enteredTextDrift(c.epoch, set)
        if (issue)
          out.push({ severity: 'warning', check: 'calendars', code: 'entered-text-drift', message: issue, path: e.path, field: 'epoch' })
      }
    }
    return out
  }
}

/** If an instant's entered text no longer reads back to the same instant in its calendar, say how it reads now. */
export function enteredTextDrift(instant: StoredInstant, set: ReturnType<typeof buildCalendars>): string | null {
  if (!instant.cal || !instant.text) return null
  const cal = set.get(instant.cal)
  if (!cal) return null
  const parsed = parseInstant(cal, instant.text)
  if (parsed === null) return `Was entered as "${instant.text}" in calendar "${instant.cal}", which no longer reads that text as a date.`
  if (Math.abs(parsed - instant.t_s) < 0.5) return null
  return `Was entered as "${instant.text}" in calendar "${instant.cal}", but that calendar now writes the stored time as "${formatInstant(cal, instant.t_s, 'second')}". The stored time has not moved.`
}

export const BUILTIN_CHECKS: readonly Check[] = [filesCheck, referencesCheck, locksCheck, calendarsCheck, physicsCheck, formatCheck]

/** Run checks and return their findings, most severe first, then by file. */
export function runChecks(world: WorldData, checks: readonly Check[] = BUILTIN_CHECKS): Issue[] {
  return checks
    .flatMap((c) => c.run(world))
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
