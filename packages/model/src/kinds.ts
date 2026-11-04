/**
 * The kinds of entity a world folder holds, each with its schema and its
 * place on disk. Phase 1 has two: the world's physics settings (a single
 * file) and calendars (one file per calendar). Later phases add stars,
 * systems, events, cultures and the rest here.
 *
 * Every field name carries its unit (`_s`, `_au`, `_c`, ...). The converters
 * at the bottom turn file values into the SI values @malevo/core works in.
 */
import { AU, C, DAY, G0, KM, LY, type CalendarDef, type FoamSettings } from '@malevo/core'
import { arr, bool, dict, num, obj, oneOf, opt, ref, str, tagged, type Infer, type Schema } from './schema'

export interface KindDef<T = unknown> {
  kind: string
  /** "physics settings", "calendar": used in messages. */
  label: string
  schema: Schema<T>
  /** A collection: one file per entity at `<folder>/<id>.json`. */
  folder?: string
  /** A single entity at this path. */
  file?: string
}

/** Entity keys: "calendar/gregorian" for a collection member, "physics" for a single-file kind. */
export function entityKey(kind: KindDef, id: string): string {
  return kind.file ? kind.kind : `${kind.kind}/${id}`
}

export function entityPath(kind: KindDef, id: string): string {
  return kind.file ?? `${kind.folder}/${id}.json`
}

// ---- shared field types ----

/**
 * An instant as stored in a file: universal time in seconds (`t_s`, the
 * value that counts), plus the calendar and text it was entered as, kept for
 * display. Editing a calendar never moves a stored instant; if the text no
 * longer matches, the instant is flagged (docs/PLAN.md §5.3).
 */
export const instantSchema = obj({
  t_s: num({ sig: 15 }),
  cal: opt(ref('calendar')),
  text: opt(str({ min: 1, max: 100 }))
})
export type StoredInstant = Infer<typeof instantSchema>

/** A locked record's provenance (docs/PLAN.md §3.1, §3.4). */
export const lockSchema = obj({
  gen: str({ pattern: /^[a-z][a-z0-9-]*@[1-9]\d*$/, patternHint: 'is not a generator name and version like "terrain@1"' }),
  seed: opt(num({ integer: true, min: 0, max: 0xffffffff })),
  inputs: dict(str({ pattern: /^[0-9a-f]{14}$/, patternHint: 'is not a content hash' }))
})
export type Lock = Infer<typeof lockSchema>

const name = (): Schema<string, false> => str({ min: 1, max: 200 })

// ---- physics settings ----

export const physicsSchema = obj({
  foam: obj({
    topSpeed_c: num({ above: 0, sig: 9 }),
    collapseRadius_au: num({ above: 0, sig: 9 }),
    loadRule: oneOf(['max-eigen', 'rss']),
    legLimit_ly: num({ above: 0, sig: 9 }),
    gravityLimit_g: num({ above: 0, sig: 9 })
  }),
  torch: obj({
    exhaustSpeed_c: num({ above: 0, max: 1, sig: 9 }),
    propellantFraction: num({ above: 0, max: 0.999, sig: 9 }),
    cruiseAccel_g: num({ above: 0, sig: 9 }),
    governorCutoff_km: num({ min: 0, sig: 9 })
  }),
  travel: obj({
    stopover_d: num({ min: 0, sig: 9 })
  }),
  traffic: obj({
    balanceTolerance: num({ min: 0, max: 1, sig: 9 }),
    balanceFloor_perDay: num({ min: 0, sig: 9 })
  })
})
export type PhysicsSettings = Infer<typeof physicsSchema>

export const physicsKind: KindDef<PhysicsSettings> = {
  kind: 'physics',
  label: 'physics settings',
  file: 'settings/physics.json',
  schema: physicsSchema
}

export function foamSettings(p: PhysicsSettings): FoamSettings {
  return {
    collapseRadius: p.foam.collapseRadius_au * AU,
    rule: p.foam.loadRule,
    topSpeed: p.foam.topSpeed_c * C,
    legLimit: p.foam.legLimit_ly * LY,
    gravityLimit: p.foam.gravityLimit_g * G0
  }
}

export function torchSettings(p: PhysicsSettings): {
  exhaustSpeed: number
  propellantFraction: number
  cruiseAccel: number
  governorCutoff: number
} {
  return {
    exhaustSpeed: p.torch.exhaustSpeed_c * C,
    propellantFraction: p.torch.propellantFraction,
    cruiseAccel: p.torch.cruiseAccel_g * G0,
    governorCutoff: p.torch.governorCutoff_km * KM
  }
}

export function travelSettings(p: PhysicsSettings): { stopover: number } {
  return { stopover: p.travel.stopover_d * DAY }
}

export function balanceTolerance(p: PhysicsSettings): { fraction: number; perDay: number } {
  return { fraction: p.traffic.balanceTolerance, perDay: p.traffic.balanceFloor_perDay }
}

// ---- calendars ----

const unitName = str({ pattern: /^[a-z][a-zA-Z0-9]*$/, patternHint: 'is not a unit name (letters and digits, starting lowercase)' })

export const calendarSchema = tagged('kind', {
  gregorian: obj({ name: name(), kind: oneOf(['gregorian']) }),
  fixed: obj({
    name: name(),
    kind: oneOf(['fixed']),
    epoch: instantSchema,
    epochYear: num({ integer: true }),
    units: arr(
      obj({
        name: unitName,
        per: opt(num({ integer: true, min: 1 })),
        first: opt(num({ integer: true })),
        time: opt(bool())
      }),
      { min: 1 }
    ),
    smallestUnit_s: num({ above: 0, sig: 15 })
  }),
  solar: obj({
    name: name(),
    kind: oneOf(['solar']),
    dayLength_s: num({ above: 0, sig: 15 }),
    yearLength_s: num({ above: 0, sig: 15 }),
    epoch: instantSchema,
    epochYear: num({ integer: true }),
    hoursPerDay: num({ integer: true, min: 1 }),
    minutesPerHour: num({ integer: true, min: 1 }),
    secondsPerMinute: num({ integer: true, min: 1 }),
    months: opt(arr(obj({ name: name(), days: num({ integer: true, min: 1 }) }), { min: 1 })),
    leapMonth: opt(num({ integer: true, min: 0 }))
  }),
  era: obj({
    name: name(),
    kind: oneOf(['era']),
    base: ref('calendar'),
    epochYear: num({ integer: true }),
    firstYear: num({ integer: true }),
    direction: oneOf(['forward', 'backward']),
    prefix: str({ max: 20 }),
    suffix: str({ max: 20 })
  }),
  offset: obj({
    name: name(),
    kind: oneOf(['offset']),
    base: ref('calendar'),
    offset_s: num({ sig: 15 })
  })
})
export type CalendarFile = Infer<typeof calendarSchema>

export const calendarKind: KindDef<CalendarFile> = {
  kind: 'calendar',
  label: 'calendar',
  folder: 'calendars',
  schema: calendarSchema
}

/** A calendar file as the definition @malevo/core builds from. */
export function calendarDef(c: CalendarFile): CalendarDef {
  switch (c.kind) {
    case 'gregorian':
      return { kind: 'gregorian' }
    case 'fixed':
      return { kind: 'fixed', epoch: c.epoch.t_s, epochYear: c.epochYear, units: c.units, smallestUnit_s: c.smallestUnit_s }
    case 'solar':
      return {
        kind: 'solar',
        dayLength_s: c.dayLength_s,
        yearLength_s: c.yearLength_s,
        epoch: c.epoch.t_s,
        epochYear: c.epochYear,
        hoursPerDay: c.hoursPerDay,
        minutesPerHour: c.minutesPerHour,
        secondsPerMinute: c.secondsPerMinute,
        months: c.months,
        leapMonth: c.leapMonth
      }
    case 'era':
      return {
        kind: 'era',
        base: c.base,
        epochYear: c.epochYear,
        firstYear: c.firstYear,
        direction: c.direction,
        prefix: c.prefix,
        suffix: c.suffix
      }
    case 'offset':
      return { kind: 'offset', base: c.base, offset_s: c.offset_s }
  }
}

/** Every kind, in the order files are reported. */
export const KINDS: readonly KindDef[] = [physicsKind as KindDef, calendarKind as KindDef]
