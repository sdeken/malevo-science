/**
 * The kinds of entity a world folder holds, each with its schema and its
 * place on disk. Phase 1 has two: the world's physics settings (a single
 * file) and calendars (one file per calendar). Later phases add stars,
 * systems, events, cultures and the rest here.
 *
 * Every field name carries its unit (`_s`, `_au`, `_c`, ...). The converters
 * at the bottom turn file values into the SI values @malevo/core works in.
 */
import { AU, C, DAY, G0, KM, LY, type CalendarDef, type FoamSettings, type ScriptCalendarImpl } from '@malevo/core'
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
  /** Members may have a JavaScript file beside them, at `<folder>/<id>.js`. */
  scripts?: boolean
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
    /** Follow a body's own solar day and year; or give them as numbers below. */
    body: opt(ref('body')),
    dayLength_s: opt(num({ above: 0, sig: 15 })),
    yearLength_s: opt(num({ above: 0, sig: 15 })),
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
  }),
  script: obj({
    name: name(),
    kind: oneOf(['script']),
    /** The units the script's fields use, largest first. The code is in calendars/<id>.js. */
    units: arr(obj({ name: unitName, first: opt(num({ integer: true })), time: opt(bool()) }), { min: 1 })
  })
})
export type CalendarFile = Infer<typeof calendarSchema>

export const calendarKind: KindDef<CalendarFile> = {
  kind: 'calendar',
  label: 'calendar',
  folder: 'calendars',
  schema: calendarSchema,
  scripts: true
}

/**
 * A calendar file as the definition @malevo/core builds from. A script
 * calendar needs its sandboxed implementation, and a solar calendar that
 * follows a body needs that body's day and year; without them there is no
 * definition (null).
 */
export function calendarDef(c: CalendarFile, impl?: ScriptCalendarImpl, lengths?: { day_s: number; year_s: number }): CalendarDef | null {
  switch (c.kind) {
    case 'gregorian':
      return { kind: 'gregorian' }
    case 'fixed':
      return { kind: 'fixed', epoch: c.epoch.t_s, epochYear: c.epochYear, units: c.units, smallestUnit_s: c.smallestUnit_s }
    case 'solar': {
      const day = c.body ? lengths?.day_s : c.dayLength_s
      const year = c.body ? lengths?.year_s : c.yearLength_s
      if (day === undefined || year === undefined) return null
      return {
        kind: 'solar',
        dayLength_s: day,
        yearLength_s: year,
        epoch: c.epoch.t_s,
        epochYear: c.epochYear,
        hoursPerDay: c.hoursPerDay,
        minutesPerHour: c.minutesPerHour,
        secondsPerMinute: c.secondsPerMinute,
        months: c.months,
        leapMonth: c.leapMonth
      }
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
    case 'script':
      return impl ? { kind: 'script', units: c.units, impl } : null
  }
}

// ---- events ----

/**
 * When something happens (docs/PLAN.md §5.3): either an instant (`at`), or an
 * anchor to another event's start or end plus an offset. Offsets are in the
 * named calendar's own units (`{"year": 130}` adds 130 to the year field) plus
 * an optional exact number of seconds, so moving the anchor moves this too.
 */
export const whenSchema = obj({
  at: opt(instantSchema),
  after: opt(ref('event')),
  from: opt(oneOf(['start', 'end'])),
  cal: opt(ref('calendar')),
  offset: opt(dict(num({ integer: true }))),
  offset_s: opt(num({ sig: 15 })),
  /** The calendar unit the date is known to: "year", "day", ... Defaults to what the entered text shows, or the anchor's. */
  precision: opt(unitName),
  circa: opt(bool())
})
export type When = Infer<typeof whenSchema>

export const eventSchema = obj({
  name: name(),
  /** A moment, a period, or a story (which also sets the span the app can show "as it was"). */
  type: oneOf(['event', 'period', 'story']),
  when: whenSchema,
  until: opt(whenSchema),
  tags: opt(arr(str({ min: 1, max: 40 })))
})
export type EventFile = Infer<typeof eventSchema>

export const eventKind: KindDef<EventFile> = {
  kind: 'event',
  label: 'event',
  folder: 'events',
  schema: eventSchema
}

/** Every kind, in the order files are reported. */
// ---- stars, systems and bodies ----

/** Settings for the generated faint stars (docs/PLAN.md §3.2: per-cell seeding, frozen as starfield@1). */
export const starfieldSchema = obj({
  /** Seed for the generated stars; absent means the world seed. */
  seed: opt(num({ integer: true, min: 0, max: 0xffffffff })),
  density_perLy3: num({ above: 0, sig: 9 }),
  scaleHeight_ly: num({ above: 0, sig: 9 }),
  cell_ly: num({ above: 0, sig: 9 }),
  /** How far from Sol the star views fill in generated stars. */
  radius_ly: num({ above: 0, sig: 9 }),
  /** Generated stars are never brighter than this apparent magnitude from Sol. */
  catalogMag: num({ sig: 9 }),
  /** Within this distance of Sol the catalogue is taken as complete. */
  catalogNear_ly: num({ min: 0, sig: 9 })
})
export type StarfieldSettings = Infer<typeof starfieldSchema>

export const starfieldKind: KindDef<StarfieldSettings> = {
  kind: 'starfield',
  label: 'star field settings',
  file: 'settings/stars.json',
  schema: starfieldSchema
}

/** Catalogue ids (hip.N, hyg.N) and generated ids (g.ix_iy_iz.k). */
export const STAR_ID = /^(?:hip|hyg)\.\d+$|^g\.-?\d+_-?\d+_-?\d+\.\d+$/

export const systemSchema = obj({
  name: name(),
  /** The star the system is built on. */
  star: str({ pattern: STAR_ID, patternHint: 'is not a star id (hip.N, hyg.N or a generated g.… id)' }),
  /** Values that replace the estimates made from the catalogue. */
  starOverrides: opt(
    obj({
      mass_msun: opt(num({ above: 0, sig: 6 })),
      luminosity_lsun: opt(num({ above: 0, sig: 6 })),
      teff_k: opt(num({ above: 0, sig: 6 })),
      radius_rsun: opt(num({ above: 0, sig: 6 }))
    })
  ),
  tags: opt(arr(str({ min: 1, max: 40 }))),
  /** Who held it and who lived there, over time: each entry applies from its date until the next. */
  history: opt(
    arr(
      obj({
        from: whenSchema,
        polity: opt(ref('polity')),
        cultures: opt(arr(obj({ culture: ref('culture'), share: num({ min: 0, sig: 6 }) }))),
        note: opt(str({ max: 200 }))
      })
    )
  )
})
export type SystemFile = Infer<typeof systemSchema>

export const systemKind: KindDef<SystemFile> = {
  kind: 'system',
  label: 'system',
  folder: 'systems',
  schema: systemSchema
}

export const BODY_CLASSES = ['rocky', 'ocean', 'ice-giant', 'gas-giant', 'dwarf', 'belt'] as const

export const bodySchema = obj({
  name: name(),
  system: ref('system'),
  /** The body it orbits; absent for a body that orbits the star. */
  parent: opt(ref('body')),
  class: oneOf(BODY_CLASSES),
  orbit: obj({
    /** Semi-major axis: give exactly one of a_au and a_km. */
    a_au: opt(num({ above: 0, sig: 9 })),
    a_km: opt(num({ above: 0, sig: 9 })),
    e: num({ min: 0, max: 0.99, sig: 6 }),
    i_deg: num({ min: 0, max: 180, sig: 6 }),
    node_deg: num({ min: 0, max: 360, sig: 7 }),
    peri_deg: num({ min: 0, max: 360, sig: 7 }),
    meanAnomaly_deg: num({ min: 0, max: 360, sig: 7 }),
    /** When the mean anomaly is the one given. */
    epoch: instantSchema
  }),
  mass_mearth: num({ above: 0, sig: 6 }),
  radius_km: num({ above: 0, sig: 6 }),
  rotation: obj({
    /** Sidereal rotation period, standard hours; negative for retrograde. Omit when tidally locked. */
    period_h: opt(num({ sig: 7 })),
    /** Always shows one face to what it orbits. */
    locked: opt(bool()),
    /** Axial tilt to its orbit, degrees. */
    tilt_deg: num({ min: 0, max: 180, sig: 5 })
  }),
  /** Bond albedo; a typical value for the class is assumed when absent. */
  albedo: opt(num({ min: 0, max: 1, sig: 4 })),
  lock: opt(lockSchema)
})
export type BodyFile = Infer<typeof bodySchema>

export const bodyKind: KindDef<BodyFile> = {
  kind: 'body',
  label: 'body',
  folder: 'bodies',
  schema: bodySchema
}

// ---- cultures, polities and their relations ----

const COLOR = str({ pattern: /^#[0-9a-f]{6}$/, patternHint: 'is not a colour like "#4f8fe0"' })
const TRAIT_ID = str({ pattern: /^[a-z][a-zA-Z0-9]*$/, patternHint: 'is not a trait id (letters and digits, starting lowercase)' })

/** The traits cultures are described by, and how affinity is worked out from them. */
export const cultureSettingsSchema = obj({
  traits: arr(
    obj({
      id: TRAIT_ID,
      label: str({ min: 1, max: 60 }),
      /** What 0 and 1 mean, for the editor. */
      low: opt(str({ max: 60 })),
      high: opt(str({ max: 60 })),
      /** How much a difference in this trait counts against affinity. 0 to ignore it. */
      weight: num({ min: 0, sig: 6 })
    })
  ),
  affinity: obj({
    /** The trait that scales how much a culture warms to anyone at all. */
    opennessTrait: opt(TRAIT_ID),
    /** How warm two identical, fully closed cultures are, from 0 (as cold as can be) to 1 (no effect). */
    closedFloor: num({ min: 0, max: 1, sig: 6 })
  })
})
export type CultureSettings = Infer<typeof cultureSettingsSchema>

export const cultureSettingsKind: KindDef<CultureSettings> = {
  kind: 'cultureSettings',
  label: 'culture settings',
  file: 'settings/cultures.json',
  schema: cultureSettingsSchema
}

export const cultureSchema = obj({
  name: name(),
  color: COLOR,
  /** 0 to 1 for each trait in settings/cultures.json; a missing trait counts as 0.5. */
  traits: dict(num({ min: 0, max: 1, sig: 4 }), { key: TRAIT_ID }),
  /** How many years behind the frontier of technology it adopts things. */
  techLag_y: opt(num({ min: 0, sig: 6 })),
  /** Which sound palette its placeholder names come from (0–7). */
  palette: opt(num({ integer: true, min: 0, max: 7 })),
  /** The calendars it uses: each from an event (or always, for the first) until the next. */
  calendars: opt(arr(obj({ calendar: ref('calendar'), from: opt(ref('event')) }))),
  tags: opt(arr(str({ min: 1, max: 40 })))
})
export type CultureFile = Infer<typeof cultureSchema>

export const cultureKind: KindDef<CultureFile> = { kind: 'culture', label: 'culture', folder: 'cultures', schema: cultureSchema }

export const politySchema = obj({
  name: name(),
  color: COLOR,
  /** Its dominant culture. */
  culture: opt(ref('culture')),
  capital: opt(ref('system')),
  founded: opt(ref('event')),
  dissolved: opt(ref('event')),
  tags: opt(arr(str({ min: 1, max: 40 })))
})
export type PolityFile = Infer<typeof politySchema>

export const polityKind: KindDef<PolityFile> = { kind: 'polity', label: 'polity', folder: 'polities', schema: politySchema }

/** The relation between two cultures, filed as `relations/<a>--<b>.json` with the ids in sorted order. */
export const relationSchema = obj({
  between: arr(ref('culture'), { min: 2, max: 2 }),
  /** Replaces the affinity worked out from their traits, from −1 (hostile) to 1 (close). */
  affinity: opt(num({ min: -1, max: 1, sig: 4 })),
  /** Changes at events (a war, a treaty): each holds from that event until the next change. */
  changes: opt(
    arr(
      obj({
        event: ref('event'),
        from: opt(oneOf(['start', 'end'])),
        affinity: num({ min: -1, max: 1, sig: 4 }),
        note: opt(str({ max: 200 }))
      })
    )
  )
})
export type RelationFile = Infer<typeof relationSchema>

export const relationKind: KindDef<RelationFile> = { kind: 'relation', label: 'relation', folder: 'relations', schema: relationSchema }

export const KINDS: readonly KindDef[] = [
  physicsKind as KindDef,
  starfieldKind as KindDef,
  calendarKind as KindDef,
  eventKind as KindDef,
  systemKind as KindDef,
  bodyKind as KindDef,
  cultureSettingsKind as KindDef,
  cultureKind as KindDef,
  polityKind as KindDef,
  relationKind as KindDef
]
