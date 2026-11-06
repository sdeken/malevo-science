/**
 * The kinds of entity a world folder holds, each with its schema and its
 * place on disk. Phase 1 has two: the world's physics settings (a single
 * file) and calendars (one file per calendar). Later phases add stars,
 * systems, events, cultures and the rest here.
 *
 * Every field name carries its unit (`_s`, `_au`, `_c`, ...). The converters
 * at the bottom turn file values into the SI values @malevo/core works in.
 */
import { AU, C, DAY, G0, KM, LY, type CalendarDef, type FoamSettings, type ScriptCalendarImpl, type TorchLight } from '@malevo/core'
import { arr, bool, dict, json, num, obj, oneOf, opt, ref, str, tagged, type Infer, type Schema } from './schema'

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
    governorCutoff_km: num({ min: 0, sig: 9 }),
    /** A typical ship's mass, tonnes (for how bright its torch is). Default 10,000. */
    shipMass_t: opt(num({ above: 0, sig: 9 })),
    /** Fraction of the jet's power radiated as visible light. Default 0.03. */
    visibleFraction: opt(num({ above: 0, max: 1, sig: 9 })),
    /** A torch seen from ahead (exhaust pointing away), relative to from behind. Default 0.3. */
    frontFactor: opt(num({ min: 0, max: 1, sig: 9 }))
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

/** How bright a typical ship's torch is (core TorchLight), with the defaults for settings a world leaves out. */
export function torchLightSettings(p: PhysicsSettings): TorchLight {
  return {
    mass: (p.torch.shipMass_t ?? 10_000) * 1000,
    accel: p.torch.cruiseAccel_g * G0,
    exhaustSpeed: p.torch.exhaustSpeed_c * C,
    visibleFraction: p.torch.visibleFraction ?? 0.03,
    frontFactor: p.torch.frontFactor ?? 0.3
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
  /** Where it happened: the system news of it spreads from. */
  where: opt(ref('system')),
  tags: opt(arr(str({ min: 1, max: 40 }))),
  lock: opt(lockSchema)
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
  /**
   * Which way the system's reference plane (the plane its orbits' inclinations
   * are measured from) faces: its north pole in galactic longitude and
   * latitude. Absent: the galactic plane itself. Longitudes are measured from
   * the plane's ascending node on the galactic plane, turned on by `zero_deg`
   * (for the Solar System, to the vernal equinox, so published ecliptic
   * elements can be used as they are).
   */
  frame: opt(
    obj({
      poleL_deg: num({ min: 0, max: 360, sig: 7 }),
      poleB_deg: num({ min: -90, max: 90, sig: 7 }),
      zero_deg: opt(num({ min: 0, max: 360, sig: 7 }))
    })
  ),
  /** The body ships dock at; absent means a habitable distance from the star (1 AU × √luminosity). */
  port: opt(ref('body')),
  /** Declared net imbalance of ship traffic, ships/day: positive for a sink (a graveyard), negative for a source (a shipyard). */
  declaredNet_perDay: opt(num({ sig: 6 })),
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
  ),
  lock: opt(lockSchema)
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
    tilt_deg: num({ min: 0, max: 180, sig: 5 }),
    /** Orbital longitude, from the orbit's ascending node, of its northern spring equinox. Default 0. */
    equinox_deg: opt(num({ min: 0, max: 360, sig: 7 })),
    /** Where its prime meridian points at universal time 0, degrees from the equinox direction. Default 0. Ignored when locked. */
    meridian_deg: opt(num({ min: 0, max: 360, sig: 7 }))
  }),
  /** For a belt: its inner and outer edges (the orbit above is its typical member's). */
  extent: opt(obj({ inner_au: num({ above: 0, sig: 6 }), outer_au: num({ above: 0, sig: 6 }) })),
  /** Bond albedo; a typical value for the class is assumed when absent. */
  albedo: opt(num({ min: 0, max: 1, sig: 4 })),
  /** Air, if it has any: what the sky view scatters light in. */
  atmosphere: opt(
    obj({
      pressure_atm: num({ min: 0, sig: 6 }),
      /** Absent: Earth's 8 km scaled by gravity. */
      scaleHeight_km: opt(num({ above: 0, sig: 6 }))
    })
  ),
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
  tags: opt(arr(str({ min: 1, max: 40 }))),
  lock: opt(lockSchema)
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

// ---- routes, stations and nebulae ----

const POINT_LY = arr(num({ sig: 9 }), { min: 3, max: 3 })

/** A node in deep space (or anywhere else a system is not): a depot, a relay, a waystation. */
export const stationSchema = obj({
  name: name(),
  /** Position, light-years, in the star atlas's frame. */
  pos_ly: POINT_LY,
  /** As for systems: positive for a sink, negative for a source. */
  declaredNet_perDay: opt(num({ sig: 6 })),
  tags: opt(arr(str({ min: 1, max: 40 })))
})
export type StationFile = Infer<typeof stationSchema>

export const stationKind: KindDef<StationFile> = { kind: 'station', label: 'station', folder: 'stations', schema: stationSchema }

/** A region the foam cannot cross: an axis-aligned ellipsoid. */
export const nebulaSchema = obj({
  name: name(),
  center_ly: POINT_LY,
  radii_ly: arr(num({ above: 0, sig: 9 }), { min: 3, max: 3 }),
  color: opt(COLOR),
  tags: opt(arr(str({ min: 1, max: 40 })))
})
export type NebulaFile = Infer<typeof nebulaSchema>

export const nebulaKind: KindDef<NebulaFile> = { kind: 'nebula', label: 'nebula', folder: 'nebulae', schema: nebulaSchema }

/** A particular ship, for the trip planner: its masses, engine, tanks and habits. */
export const shipSchema = obj({
  name: name(),
  /** Empty of propellant, tonnes. */
  dryMass_t: num({ above: 0, sig: 9 }),
  /** Propellant the tanks hold when full, tonnes. */
  propellant_t: num({ above: 0, sig: 9 }),
  /** Exhaust speed; absent: the world's torch setting. */
  exhaustSpeed_c: opt(num({ above: 0, max: 1, sig: 9 })),
  /** How many torches (alike); absent: one. */
  engines: opt(num({ integer: true, min: 1, max: 100 })),
  /** Thrust of each torch at full power, meganewtons. */
  thrust_MN: num({ above: 0, sig: 9 }),
  /** The most acceleration the crew will take, g; thrust is throttled to it. Absent: the world's cruise acceleration. */
  comfort_g: opt(num({ above: 0, sig: 9 })),
  /** What must be left on arrival: a share of the tanks, or enough Δv for any orbital insertion (the larger, if both). */
  reserve: obj({
    share: opt(num({ min: 0, max: 1, sig: 6 })),
    dv_kms: opt(num({ min: 0, sig: 9 }))
  }),
  /** Power drawn to make and hold the foam, gigawatts, from the ship's fusion fuel. */
  foamPower_GW: opt(num({ min: 0, sig: 9 })),
  /** How hard the torch runs in the foam to dump heat, as a share of full thrust. */
  foamThrottle: opt(num({ min: 0, max: 1, sig: 6 })),
  /** How fast a port can fill the tanks, tonnes per hour. */
  refuel_tph: opt(num({ above: 0, sig: 9 })),
  note: opt(str({ max: 400 }))
})
export type ShipFile = Infer<typeof shipSchema>

export const shipKind: KindDef<ShipFile> = { kind: 'ship', label: 'ship', folder: 'ships', schema: shipSchema }

/** A stop on a route: exactly one of a system, a station, or a bare star (somewhere to drop out of the foam). */
export const waypointSchema = obj({
  system: opt(ref('system')),
  station: opt(ref('station')),
  star: opt(str({ pattern: STAR_ID, patternHint: 'is not a star id (hip.N, hyg.N or a generated g.… id)' }))
})
export type Waypoint = Infer<typeof waypointSchema>

/**
 * A named chain of legs, and the traffic it carries. Each service runs one
 * way, from one waypoint to another (by index), stopping at every waypoint
 * between; A → B and B → A are separate services with their own numbers.
 */
export const routeSchema = obj({
  name: name(),
  color: opt(COLOR),
  waypoints: arr(waypointSchema, { min: 2 }),
  services: opt(
    arr(
      obj({
        from: num({ integer: true, min: 0 }),
        to: num({ integer: true, min: 0 }),
        perDay: num({ min: 0, sig: 6 }),
        note: opt(str({ max: 200 }))
      })
    )
  ),
  /** When the route opened and closed, if it has not always been there. News and the history use it. */
  opened: opt(whenSchema),
  closed: opt(whenSchema),
  tags: opt(arr(str({ min: 1, max: 40 }))),
  lock: opt(lockSchema)
})
export type RouteFile = Infer<typeof routeSchema>

export const routeKind: KindDef<RouteFile> = { kind: 'route', label: 'route', folder: 'routes', schema: routeSchema }

// ---- viewpoints ----

/** A place on a body to look at the sky from. */
export const viewpointSchema = obj({
  name: name(),
  body: ref('body'),
  lat_deg: num({ min: -90, max: 90, sig: 7 }),
  /** East longitude. */
  lon_deg: num({ min: -180, max: 360, sig: 7 }),
  elevation_m: opt(num({ sig: 6 })),
  note: opt(str({ max: 200 }))
})
export type ViewpointFile = Infer<typeof viewpointSchema>

export const viewpointKind: KindDef<ViewpointFile> = {
  kind: 'viewpoint',
  label: 'viewpoint',
  folder: 'viewpoints',
  schema: viewpointSchema
}

// ---- terrain ----

const LATLON = arr(num({ sig: 7 }), { min: 2, max: 2 })

/** A body's surface: terrain@1's parameters and roll, the climate's inputs, and hand shaping in latitude/longitude. */
export const terrainSchema = obj({
  body: ref('body'),
  /** Which roll of terrain@1: re-rolling counts up. */
  roll: num({ integer: true, min: 0 }),
  /** A solid surface's generation (terrain@1). */
  params: opt(
    obj({
      plates: num({ integer: true, min: 2, max: 60 }),
      continents: num({ min: 0, max: 1, sig: 4 }),
      ocean: num({ min: 0, max: 1, sig: 4 }),
      mountains_km: num({ min: 0, max: 30, sig: 4 }),
      roughness: num({ min: 0, max: 1, sig: 4 })
    })
  ),
  /** A giant's cloud bands (bands@1), instead of a surface. */
  bands: opt(
    obj({
      bands: num({ integer: true, min: 1, max: 60 }),
      contrast: num({ min: 0, max: 1, sig: 4 }),
      turbulence: num({ min: 0, max: 1, sig: 4 }),
      storms: num({ integer: true, min: 0, max: 20 }),
      palette: arr(COLOR, { min: 2, max: 8 })
    })
  ),
  /** An optional cloud layer over a surface (clouds@1): weather to look at, not a record of any moment. */
  clouds: opt(
    obj({
      cover: num({ min: 0, max: 1, sig: 4 }),
      cells: num({ integer: true, min: 1, max: 9 }),
      turbulence: num({ min: 0, max: 1, sig: 4 }),
      storms: num({ integer: true, min: 0, max: 40 }),
      /** The clouds' colour; white when absent. */
      colour: opt(COLOR)
    })
  ),
  climate: opt(
    obj({
      /** Warming by the air, K. Absent: worked out from the surface pressure. */
      greenhouse_K: opt(num({ sig: 5 })),
      /** How much the air and seas even out temperatures, 0–1. Absent: 0.35 with air, 0.05 without. */
      heatTransport: opt(num({ min: 0, max: 1, sig: 4 })),
      /** A fixed mean surface temperature, K: the look stops following the planet's orbit. */
      temperature_K: opt(num({ above: 0, sig: 5 })),
      /** Whether it has surface water. Absent: yes with half an atmosphere or more. */
      water: opt(bool()),
      /** The colour of bare rock and dust. */
      rock: opt(COLOR)
    })
  ),
  /** Hand shaping, drawn in latitude/longitude (degrees): stored as text, never as pixels. */
  shapes: opt(
    arr(
      obj({
        kind: oneOf(['land', 'sea', 'raise', 'lower', 'ridge']),
        /** [lat, lon] pairs: a polygon, or a line for a ridge. */
        points: arr(LATLON, { min: 2 }),
        height_km: opt(num({ sig: 4 })),
        width_deg: opt(num({ above: 0, sig: 4 })),
        note: opt(str({ max: 200 }))
      })
    )
  ),
  lock: opt(lockSchema)
})
export type TerrainFile = Infer<typeof terrainSchema>

export const terrainKind: KindDef<TerrainFile> = { kind: 'terrain', label: 'terrain', folder: 'terrains', schema: terrainSchema }

// ---- cities ----

/** A settlement at a place on a body, with its population over time. */
export const citySchema = obj({
  name: name(),
  body: ref('body'),
  lat_deg: num({ min: -90, max: 90, sig: 7 }),
  /** East longitude. */
  lon_deg: num({ min: -180, max: 360, sig: 7 }),
  elevation_m: opt(num({ sig: 6 })),
  founded: opt(whenSchema),
  /** Its people at dates; between two, it grows (or shrinks) steadily by the same factor each year. */
  population: opt(arr(obj({ from: whenSchema, people: num({ min: 0, sig: 6 }) }))),
  /** Whether ships dock here: the system's port takes its traffic. */
  port: opt(oneOf(['main', 'minor'])),
  /** Who holds it, when that differs from who holds its system. */
  polity: opt(ref('polity')),
  region: opt(str({ max: 100 })),
  /** The calendar its people use; absent: one that follows its body, or the display calendar. */
  calendar: opt(ref('calendar')),
  note: opt(str({ max: 400 })),
  tags: opt(arr(str({ min: 1, max: 40 })))
})
export type CityFile = Infer<typeof citySchema>

export const cityKind: KindDef<CityFile> = { kind: 'city', label: 'city', folder: 'cities', schema: citySchema }

// ---- city plans ----

const XY = arr(num({ sig: 8 }), { min: 2, max: 2 })
const XYZ = arr(num({ sig: 8 }), { min: 2, max: 3 })
const POLY = arr(XY, { min: 3 })
const PLAN_ID = str({ pattern: /^[a-z0-9][a-z0-9-]*$/, patternHint: 'is not an id (lowercase letters, digits and hyphens)' })
const RGB01 = arr(num({ min: 0, max: 1, sig: 4 }), { min: 3, max: 3 })
const common = { id: PLAN_ID, name: opt(str({ max: 200 })), note: opt(str({ max: 400 })), hidden: opt(bool()) }

export const SURFACES = ['grass', 'mud', 'paved', 'sand', 'rock'] as const
export const LINE_KINDS = [
  'street',
  'avenue',
  'highway',
  'stairs',
  'lightrail',
  'heavyrail',
  'fieldline',
  'funicular',
  'siding',
  'seawall',
  'barrage',
  'breakwater',
  'pier'
] as const
export const REGION_PRESETS = ['buildings', 'cliff', 'yards', 'scatter', 'empty'] as const

/**
 * A city's plan: the prototype city format (bluff-planner) moved over as
 * version 2. Anchored to a city, so its latitude, gravity and sun come from
 * the model; metres, x east, y north, z up, from the city's own origin. Every
 * speed and size is in this file and nowhere else.
 */
export const cityPlanSchema = obj({
  city: ref('city'),
  /** The area shown: [x0, y0, x1, y1], m. */
  extent: arr(num({ sig: 8 }), { min: 4, max: 4 }),
  /** Mixed into every object's random stream. */
  seed: opt(num({ integer: true, min: 0, max: 0xffffffff })),
  defaults: obj({ groundZ: num({ sig: 6 }), surface: oneOf(SURFACES) }),
  walking: obj({
    speed_ms: num({ above: 0, sig: 4 }),
    /** How much longer real walks are than straight lines. */
    detour: num({ min: 1, sig: 4 })
  }),
  ground: opt(
    arr(
      obj({
        ...common,
        poly: POLY,
        z: opt(num({ sig: 6 })),
        plane: opt(arr(arr(num({ sig: 8 }), { min: 3, max: 3 }), { min: 3, max: 3 })),
        surface: opt(oneOf(SURFACES))
      })
    )
  ),
  water: opt(arr(obj({ ...common, poly: POLY, z: opt(num({ sig: 6 })), kind: opt(oneOf(['sea', 'river', 'basin'])) }))),
  lines: opt(
    arr(
      obj({
        ...common,
        kind: oneOf(LINE_KINDS),
        pts: arr(XYZ, { min: 2 }),
        width: opt(num({ above: 0, sig: 5 })),
        mount: opt(oneOf(['grade', 'elevated', 'face'])),
        z: opt(num({ sig: 6 })),
        h: opt(num({ sig: 5 })),
        lamps: opt(bool()),
        /** Cars on a timetable. */
        service: opt(
          obj({
            headway_s: opt(num({ above: 0, sig: 6 })),
            speed_ms: opt(num({ above: 0, sig: 5 })),
            accel_ms2: opt(num({ above: 0, sig: 5 })),
            dwell_s: opt(num({ min: 0, sig: 5 })),
            /** Stops: points near the line, or distances along it (m). Both ends always stop. */
            stops: opt(arr(json())),
            stopEvery_m: opt(num({ above: 0, sig: 6 })),
            cars: opt(num({ integer: true, min: 1 })),
            carLength_m: opt(num({ above: 0, sig: 4 })),
            tracks: opt(num({ integer: true, min: 1, max: 2 })),
            phase_s: opt(num({ sig: 6 })),
            /** Running hours, local: [from, to]. Absent: all day. */
            hours: opt(arr(num({ min: 0, max: 24, sig: 4 }), { min: 2, max: 2 })),
            colour: opt(RGB01)
          })
        )
      })
    )
  ),
  regions: opt(
    arr(obj({ ...common, preset: oneOf(REGION_PRESETS), poly: POLY, params: opt(json()), seed: opt(num({ integer: true, min: 0 })) }))
  ),
  buildings: opt(
    arr(
      obj({
        ...common,
        center: XY,
        size: XY,
        angle: opt(num({ sig: 6 })),
        z0: opt(num({ sig: 6 })),
        z1: opt(num({ sig: 6 })),
        h: opt(num({ above: 0, sig: 6 })),
        colour: opt(RGB01),
        kind: opt(oneOf(['landmark', 'structure', 'lamp'])),
        clear: opt(bool())
      })
    )
  ),
  points: opt(arr(obj({ ...common, kind: oneOf(['label', 'station', 'viewpoint', 'field']), pos: XYZ, big: opt(bool()) }))),
  /** Surface to orbit: lighters from a field point up to the stack. */
  orbit: opt(
    obj({
      /** The point lighters fly from. */
      field: PLAN_ID,
      flight_min: num({ above: 0, sig: 5 }),
      /** Typical time between launch windows, min. */
      windowGap_min: num({ min: 0, sig: 5 })
    })
  ),
  /** The port's capacity, from the stack and lighter model (prototype stack tool). */
  port: opt(
    obj({
      /** Minimum spacing between freighters in the approach corridor, min. */
      spacing_min: num({ above: 0, sig: 5 }),
      /** Freighters the stack can hold at once. */
      berths: num({ min: 0, sig: 6 }),
      /** Days each freighter spends in the stack. */
      daysInStack: num({ above: 0, sig: 5 }),
      lighters: num({ min: 0, sig: 6 }),
      /** Round trips each lighter flies a day. */
      flightsPerLighter: num({ min: 0, sig: 5 }),
      /** Containers per freighter, and per lighter flight. */
      containersPerFreighter: num({ above: 0, sig: 6 }),
      lighterCapacity: num({ above: 0, sig: 6 }),
      /** Take-offs and landings the lighter field can handle a day. */
      fieldMovements: num({ min: 0, sig: 6 })
    })
  )
})
export type CityPlanFile = Infer<typeof cityPlanSchema>

export const cityPlanKind: KindDef<CityPlanFile> = { kind: 'cityPlan', label: 'city plan', folder: 'cityplans', schema: cityPlanSchema }

// ---- the history generator's settings ----

/** What history@1 plays out: where it starts, which events unlock what, and how it behaves. */
export const historySettingsSchema = obj({
  /** Seed for runs; absent means the world seed. */
  seed: opt(num({ integer: true, min: 0, max: 0xffffffff })),
  /** The system settlement spreads from, and its culture. */
  origin: ref('system'),
  originCulture: ref('culture'),
  /** Capabilities, by the events that bring them (docs/PLAN.md §7.3: gated by the timeline). */
  slowShips: ref('event'),
  foamDrive: ref('event'),
  /** When the run stops. */
  end: ref('event'),
  step_y: opt(num({ above: 0, sig: 6 })),
  slow: obj({
    /** How far slow ships reach from the origin. */
    reach_ly: num({ above: 0, sig: 6 }),
    colonies: num({ integer: true, min: 0 })
  }),
  growth: obj({
    /** Systems settled by the end, counting the slow-ship colonies. */
    systems: num({ integer: true, min: 1, max: 5000 }),
    /** No settlement farther than this from the origin. */
    maxRadius_ly: num({ above: 0, sig: 6 }),
    /** How strongly settlement pushes outward: higher is gentler. Default 7. */
    outward_ly: opt(num({ above: 0, sig: 6 })),
    /** How many legs out a system founds new ones. Default 2. */
    legs: opt(num({ integer: true, min: 1, max: 4 }))
  }),
  culture: obj({
    /** Chance a new colony is an enclave of a belief culture. */
    enclaveRate: num({ min: 0, max: 1, sig: 6 }),
    /** Chance a colony far from its culture's home starts a new regional culture. */
    splitRate: num({ min: 0, max: 1, sig: 6 }),
    splitDistance_ly: num({ min: 0, sig: 6 }),
    /** Share of the difference that blends along each lane each step. */
    blendRate: num({ min: 0, max: 1, sig: 6 })
  }),
  /** Belief cultures that found enclaves, each from an event (or from the start). */
  enclaves: opt(arr(obj({ culture: ref('culture'), from: opt(ref('event')) }))),
  polities: opt(
    obj({
      /** When the polities form and borders are drawn. */
      from: ref('event'),
      list: arr(
        obj({
          polity: ref('polity'),
          /** Target share of the systems, 0–1. Its capital is the polity's own, or chosen by the run. */
          share: num({ min: 0, max: 1, sig: 6 }),
          /** How fast it pulls its systems toward its capital's culture, per decade (0–1). */
          unify: opt(num({ min: 0, max: 1, sig: 6 }))
        })
      )
    })
  )
})
export type HistorySettings = Infer<typeof historySettingsSchema>

export const historySettingsKind: KindDef<HistorySettings> = {
  kind: 'historySettings',
  label: 'history settings',
  file: 'settings/history.json',
  schema: historySettingsSchema
}

// ---- naming ----

const LINK_GROUP_IDS = ['similar', 'derived', 'broader', 'narrower', 'parts', 'topic', 'opposite', 'cause'] as const
const POS_IDS = ['n', 'v', 'a', 'r'] as const
export const NAMING_RATINGS = ['neutral', 'hate', 'like', 'love'] as const
const LETTERS = (): Schema<number | undefined, true> => opt(num({ integer: true, min: 1, max: 100 }))

/**
 * A naming session: the settings it draws with, and the transcript, which is
 * every round of names the tool showed with the person's rating of each, and
 * the name they settled on (one of those, or anything else).
 */
export const namingSchema = obj({
  /** What is being named, in the person's words. */
  name: name(),
  /** Words from the word list, or people's names and made-up names by sound. */
  mode: oneOf(['words', 'sounds']),
  /** 0: ratings ignored; 1: stay close to what was liked. */
  focus: num({ min: 0, max: 1, sig: 3 }),
  words: obj({
    /** Words looked up, and the senses the person meant (copied in full, so the file reads without the app). */
    concepts: arr(
      obj({
        word: str({ min: 1, max: 80 }),
        senses: arr(obj({ id: str({ min: 1, max: 40 }), words: arr(str({ max: 120 })), gloss: str({ max: 2000 }) }))
      })
    ),
    links: arr(oneOf(LINK_GROUP_IDS)),
    depth: num({ integer: true, min: 1, max: 3 }),
    /** Also words whose definition uses a looked-up word. */
    defined: bool(),
    pos: arr(oneOf(POS_IDS)),
    categories: arr(str({ max: 40 })),
    minLetters: LETTERS(),
    maxLetters: LETTERS(),
    singleWords: bool(),
    /** How much sound counts beside meaning, 0 to 1. */
    sound: num({ min: 0, max: 1, sig: 3 })
  }),
  sounds: obj({
    /** Languages whose given and family names are drawn on. */
    locales: arr(str({ min: 1, max: 40 })),
    given: bool(),
    family: bool(),
    gender: oneOf(['any', 'female', 'male']),
    /** Share of each round that is made up, 0 to 1. */
    invented: num({ min: 0, max: 1, sig: 3 }),
    minLetters: LETTERS(),
    maxLetters: LETTERS()
  }),
  /** The transcript: each round as shown, with the person's rating of each name. */
  rounds: arr(
    obj({
      at: str({ min: 1, max: 40 }),
      mode: oneOf(['words', 'sounds']),
      names: arr(obj({ text: str({ min: 1, max: 200 }), rating: oneOf(NAMING_RATINGS) }))
    })
  ),
  /** The name the person settled on. */
  chosen: opt(obj({ text: str({ min: 1, max: 200 }), at: str({ min: 1, max: 40 }) }))
})
export type NamingFile = Infer<typeof namingSchema>

export const namingKind: KindDef<NamingFile> = { kind: 'naming', label: 'naming', folder: 'namings', schema: namingSchema }

export function newNaming(name: string, mode: 'words' | 'sounds'): NamingFile {
  return {
    name,
    mode,
    focus: 0.6,
    words: {
      concepts: [],
      links: ['similar', 'derived'],
      depth: 1,
      defined: true,
      pos: ['n'],
      categories: [],
      singleWords: true,
      sound: 0
    },
    sounds: { locales: ['en'], given: true, family: false, gender: 'any', invented: 0.3 },
    rounds: []
  }
}

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
  relationKind as KindDef,
  stationKind as KindDef,
  nebulaKind as KindDef,
  routeKind as KindDef,
  viewpointKind as KindDef,
  historySettingsKind as KindDef,
  terrainKind as KindDef,
  cityKind as KindDef,
  cityPlanKind as KindDef,
  shipKind as KindDef,
  namingKind as KindDef
]
