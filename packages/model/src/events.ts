/**
 * Turning stored dates into instants (docs/PLAN.md §5.3).
 *
 * An event's `when` is either an instant or an anchor: another event's start
 * or end, plus an offset in some calendar's units and/or exact seconds.
 * Anchors resolve in dependency order; a cycle, a missing event or calendar,
 * or a unit the calendar does not have is an error on that event (and on
 * anything anchored to it), never an exception.
 */
import {
  buildCalendars,
  compareStrings,
  formatInstant,
  type Calendar,
  type CalendarDef,
  type CalendarSet,
  type Fields,
  type Instant,
  type ScriptCalendarImpl
} from '@malevo/core'
import { calendarDef, calendarKind, eventKind, type EventFile, type When } from './kinds'
import { entitiesOf, type WorldData } from './load'

/** Compiles a script calendar's code into a sandboxed implementation; throws with a readable message on failure. */
export type ScriptLoader = (code: string, path: string) => ScriptCalendarImpl

export interface WorldEnv {
  /** Without one (in the renderer, say), script calendars are reported as unavailable. */
  loadScript?: ScriptLoader
}

export interface WorldCalendars {
  set: CalendarSet
  /** Calendars that could not be built, by id, with the reason (script failures included). */
  errors: Map<string, string>
}

const calendarCache = new WeakMap<WorldData, WeakMap<WorldEnv, WorldCalendars>>()

/** Every calendar of a world, built once per (world, env). */
export function worldCalendars(world: WorldData, env: WorldEnv = {}): WorldCalendars {
  let byEnv = calendarCache.get(world)
  if (!byEnv) calendarCache.set(world, (byEnv = new WeakMap()))
  const hit = byEnv.get(env)
  if (hit) return hit
  const defs: Record<string, CalendarDef> = {}
  const errors = new Map<string, string>()
  for (const e of entitiesOf(world, calendarKind)) {
    if (e.value.kind !== 'script') {
      defs[e.id] = calendarDef(e.value)!
      continue
    }
    const path = `${calendarKind.folder}/${e.id}.js`
    const code = world.scripts.get(path)
    if (code === undefined) {
      errors.set(e.id, `This is a script calendar, but ${path} does not exist.`)
      continue
    }
    if (!env.loadScript) {
      errors.set(e.id, 'Script calendars run only in the app or the malevo command.')
      continue
    }
    try {
      defs[e.id] = calendarDef(e.value, env.loadScript(code, path))!
    } catch (err) {
      errors.set(e.id, (err as Error).message)
    }
  }
  const set = buildCalendars(defs)
  for (const err of set.errors) errors.set(err.id, err.message)
  const out = { set, errors }
  byEnv.set(env, out)
  return out
}

export interface ResolvedTime {
  t: Instant
  /** The calendar and unit the time is known to, if known. */
  cal: string | null
  precision: string | null
  circa: boolean
  /** The span the precision covers: [start of that unit, start of the next]. Equal to [t, t] when unknown. */
  range: [Instant, Instant]
}

export interface ResolvedEvent {
  id: string
  start: ResolvedTime | null
  end: ResolvedTime | null
  /** Why a time could not be worked out (empty when both resolved, or `until` is absent). */
  errors: string[]
  /** Warnings that do not stop resolution. */
  warnings: string[]
}

/** Resolve every event of a world. */
export function resolveEvents(world: WorldData, cals: WorldCalendars): Map<string, ResolvedEvent> {
  const events = new Map(entitiesOf(world, eventKind).map((e) => [e.id, e.value]))
  const out = new Map<string, ResolvedEvent>()
  const resolving = new Set<string>()

  const resolve = (id: string): ResolvedEvent => {
    const done = out.get(id)
    if (done) return done
    const ev = events.get(id)!
    const r: ResolvedEvent = { id, start: null, end: null, errors: [], warnings: [] }
    resolving.add(id)
    r.start = resolveWhen(ev.when, 'when', r)
    if (ev.until) {
      r.end = resolveWhen(ev.until, 'until', r)
      if (r.start && r.end && r.end.t < r.start.t) r.warnings.push('Its "until" comes before its "when".')
    } else if (ev.type !== 'event') r.warnings.push(`A ${ev.type} usually has an "until".`)
    resolving.delete(id)
    out.set(id, r)
    return r
  }

  const resolveWhen = (w: When, label: string, r: ResolvedEvent): ResolvedTime | null => {
    const fail = (msg: string): null => {
      r.errors.push(`${label}: ${msg}`)
      return null
    }
    if ((w.at === undefined) === (w.after === undefined))
      return fail('give either "at" (a date) or "after" (another event), not both or neither.')
    const calOf = (id: string | undefined): Calendar | null | undefined => {
      if (id === undefined) return undefined
      return cals.set.get(id) ?? null
    }
    if (w.at) {
      const cal = calOf(w.at.cal ?? w.cal)
      if (cal === null)
        return fail(
          `calendar "${w.at.cal ?? w.cal}" is not available${cals.errors.has(w.at.cal ?? w.cal!) ? ` (${cals.errors.get(w.at.cal ?? w.cal!)})` : ''}.`
        )
      const precision = w.precision ?? (cal && w.at.text ? precisionFromText(cal, w.at.t_s, w.at.text) : null)
      return finish(w.at.t_s, cal ?? null, precision, Boolean(w.circa), fail)
    }
    // Anchored.
    const target = w.after!
    let base: ResolvedTime | null
    if (target === r.id) {
      // An end measured from the event's own start ("lasts 70 years").
      if (label !== 'until' || w.from === 'end') return fail('an event can only measure its end from its own start.')
      if (!r.start) return fail('its start cannot be worked out, so neither can an end measured from it.')
      base = r.start
    } else {
      if (!events.has(target)) return fail(`it is anchored to event "${target}", which does not exist.`)
      if (resolving.has(target)) return fail(`its anchors form a cycle through "${target}".`)
      const anchor = resolve(target)
      base = w.from === 'end' ? (anchor.end ?? null) : anchor.start
      if (!base) {
        if (anchor.errors.some((m) => m.includes('form a cycle'))) return fail(`its anchors form a cycle through "${target}".`)
        if (anchor.errors.length) return fail(`it is anchored to "${target}", whose time cannot be worked out.`)
        return fail(`event "${target}" has no ${w.from === 'end' ? 'end' : 'start'} time to anchor to.`)
      }
    }
    let t = base.t
    const cal = calOf(w.cal)
    if (cal === null) return fail(`calendar "${w.cal}" is not available${cals.errors.has(w.cal!) ? ` (${cals.errors.get(w.cal!)})` : ''}.`)
    const offset = w.offset ?? {}
    if (Object.keys(offset).length) {
      if (!cal) return fail('an offset in calendar units needs a calendar ("cal").')
      const names = cal.units.map((u) => u.name)
      const unknown = Object.keys(offset).filter((k) => !names.includes(k))
      if (unknown.length)
        return fail(`calendar "${w.cal}" has no unit ${unknown.map((u) => `"${u}"`).join(', ')} (it has ${names.join(', ')}).`)
      try {
        const f: Fields = cal.toFields(t)
        for (const k of Object.keys(offset).sort(compareStrings)) f[k] += offset[k]
        t = cal.fromFields(f)
      } catch (err) {
        return fail(`calendar "${w.cal}" failed: ${(err as Error).message}`)
      }
    }
    t += w.offset_s ?? 0
    const precision = w.precision ?? base.precision
    const precCal = w.cal ? cal! : base.cal ? (cals.set.get(base.cal) ?? null) : null
    return finish(t, precCal, precision, Boolean(w.circa) || base.circa, fail)
  }

  const finish = (
    t: Instant,
    cal: Calendar | null,
    precision: string | null,
    circa: boolean,
    fail: (m: string) => null
  ): ResolvedTime | null => {
    if (precision && cal && !cal.units.some((u) => u.name === precision))
      return fail(`calendar "${cal.id}" has no unit "${precision}" to be precise to.`)
    let range: [Instant, Instant] = [t, t]
    if (precision && cal) {
      try {
        range = precisionRange(cal, t, precision)
      } catch {
        /* a failing script calendar leaves the range unknown */
      }
    }
    return { t, cal: cal?.id ?? null, precision: cal ? precision : null, circa, range }
  }

  for (const id of [...events.keys()].sort(compareStrings)) resolve(id)
  return out
}

/** [start of the `unit` containing t, start of the next one], in `cal`. */
export function precisionRange(cal: Calendar, t: Instant, unit: string): [Instant, Instant] {
  const level = cal.units.findIndex((u) => u.name === unit)
  if (level < 0) return [t, t]
  const f = cal.toFields(t)
  const trunc: Fields = {}
  cal.units.forEach((u, i) => (trunc[u.name] = i <= level ? Math.floor(f[u.name]) : u.first))
  return [cal.fromFields(trunc), cal.fromFields({ ...trunc, [unit]: trunc[unit] + 1 })]
}

/** The finest unit at which the entered text and the stored time agree ("2024-03" → month). */
export function precisionFromText(cal: Calendar, t: Instant, text: string): string | null {
  for (let i = cal.units.length - 1; i >= 0; i--) {
    try {
      if (formatInstant(cal, t, cal.units[i].name) === text.trim()) return cal.units[i].name
    } catch {
      return null
    }
  }
  return null
}

/** The event files of a world, by id (only those that parsed). */
export function eventFiles(world: WorldData): Map<string, EventFile> {
  return new Map(entitiesOf(world, eventKind).map((e) => [e.id, e.value]))
}
