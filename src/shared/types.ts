export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
  /** The newest world.json format this build can read and write. */
  worldFormat: number
}

/** App settings, kept in the app's userData folder, never in a world folder. */
export interface Settings {
  /** Reopen this world on start. */
  lastWorld: string | null
  /** Most recent first. */
  recentWorlds: string[]
  autoUpdate: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  lastWorld: null,
  recentWorlds: [],
  autoUpdate: true
}

export const MAX_RECENT_WORLDS = 10

/** The open world, as the renderer sees it. */
export interface WorldInfo {
  root: string
  format: number
  name: string
  seed: number
}

/** What a folder holds, for the open/create dialogs. */
export type FolderInfo =
  | { kind: 'world'; name: string }
  | { kind: 'empty' }
  | { kind: 'missing' }
  | { kind: 'not-a-world' }
  | { kind: 'invalid'; code: string; message: string }

/** Result of open/create: the world, or a message to show. */
export type WorldResult = { ok: true; world: WorldInfo } | { ok: false; code: string; message: string }

export type UpdateState = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'unavailable'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion: string | null
  /** Download percent while downloading. */
  progress?: number
  checkedAt: string | null
  error: string | null
  /** "Update now" was pressed while still downloading. */
  installRequested?: boolean
}

/** One finding from the world checks (mirrors @malevo/model's Issue). */
export interface CheckIssue {
  severity: 'error' | 'warning' | 'info'
  check: string
  code: string
  message: string
  path?: string
  field?: string
}

export interface CheckReport {
  issues: CheckIssue[]
  /** Files that `fix` would rewrite into canonical form (values unchanged). */
  fixable: string[]
}

// ---- Phase 2: the world as the renderer sees it ----

export interface CalendarUnitInfo {
  name: string
  time: boolean
}

export interface CalendarInfo {
  id: string
  path: string
  name: string
  kind: string
  /** Units, largest first; empty when the calendar cannot be built. */
  units: CalendarUnitInfo[]
  /** Why it cannot be built, if it cannot. */
  error: string | null
  /** The file's value (null when it does not parse). */
  value: unknown
  /** A script calendar's code. */
  script: string | null
}

export interface TimeInfo {
  t: number
  cal: string | null
  precision: string | null
  circa: boolean
  range: [number, number]
}

export interface EventInfo {
  id: string
  path: string
  /** The file's value (null when it does not parse). */
  value: EventValue | null
  start: TimeInfo | null
  end: TimeInfo | null
  errors: string[]
  warnings: string[]
}

/** An event file (mirrors @malevo/model's EventFile). */
export interface EventValue {
  name: string
  type: 'event' | 'period' | 'story'
  when: WhenValue
  until?: WhenValue
  /** The system it happened in. */
  where?: string
  tags?: string[]
}

export interface WhenValue {
  at?: { t_s: number; cal?: string; text?: string }
  after?: string
  from?: 'start' | 'end'
  cal?: string
  offset?: Record<string, number>
  offset_s?: number
  precision?: string
  circa?: boolean
}

export interface WorldSnapshot {
  /** Increases with every change, so stale replies can be ignored. */
  version: number
  world: WorldInfo
  /** Files with unsaved changes. */
  dirty: string[]
  canUndo: boolean
  canRedo: boolean
  calendars: CalendarInfo[]
  events: EventInfo[]
  systems: SystemInfoDto[]
  physics: PhysicsSummary | null
  cultures: EntityDto[]
  polities: EntityDto[]
  relations: EntityDto[]
  /** settings/cultures.json, if the world has it. */
  cultureSettings: CultureSettingsDto | null
  stations: EntityDto[]
  nebulae: EntityDto[]
  routes: RouteInfoDto[]
  /** Every node any route touches, plus every station and system, by node id. */
  nodes: Record<string, RouteNodeDto>
  /** Null without physics settings. */
  traffic: TrafficDto | null
  viewpoints: EntityDto[]
  /** settings/history.json, if the world has it. */
  historySettings: Record<string, unknown> | null
  ships: EntityDto[]
  travellers: EntityDto[]
  drifters: EntityDto[]
  landings: EntityDto[]
  /** settings/physics.json as written, if the world has it (for editing). */
  physicsSettings: Record<string, unknown> | null
  terrains: EntityDto[]
  cities: CityInfoDto[]
  cityPlans: EntityDto[]
  issueCounts: { error: number; warning: number; info: number }
}

export interface TickInfo {
  t: number
  label: string
  major: boolean
}

export interface ParsedDate {
  t: number
  /** The finest unit the text gave. */
  precision: string | null
}

export interface FieldChangeInfo {
  field: string
  before: unknown
  after: unknown
}

export interface CompareEntry {
  key: string
  path: string
  label: string
  name: string
  fields?: FieldChangeInfo[]
}

export interface CompareReport {
  otherRoot: string
  otherName: string
  /** Only in the other world. */
  added: CompareEntry[]
  /** Only in this world. */
  removed: CompareEntry[]
  changed: CompareEntry[]
  unreadable: string[]
  /** Events whose resolved times differ, in seconds. */
  timeChanges: {
    id: string
    name: string
    startHere: number | null
    startThere: number | null
    endHere: number | null
    endThere: number | null
  }[]
}

export type EditableKind =
  | 'event'
  | 'calendar'
  | 'physics'
  | 'system'
  | 'body'
  | 'culture'
  | 'polity'
  | 'relation'
  | 'cultureSettings'
  | 'station'
  | 'nebula'
  | 'route'
  | 'viewpoint'
  | 'historySettings'
  | 'terrain'
  | 'city'
  | 'cityPlan'
  | 'ship'
  | 'traveller'
  | 'drifter'
  | 'landing'

// ---- Phase 3: stars, systems, bodies ----

export interface ElementsInfo {
  a: number
  e: number
  i: number
  node: number
  peri: number
  meanAnomaly: number
  epoch: number
  mu: number
}

export interface BodyInfoDto {
  id: string
  path: string
  name: string
  cls: string
  parent: string | null
  depth: number
  /** The body file's value. */
  value: Record<string, unknown>
  error: string | null
  elements: ElementsInfo | null
  mass: number
  radius: number
  tilt: number
  rotation: number | null
  period: number | null
  year: number | null
  solarDay: number | null
  hill: number | null
  collapse: number | null
  surfaceGravity: number
  escapeVelocity: number
  density: number
  insolation: number | null
  equilibriumTemp: number | null
  /** Generated and kept (planets@1 and so on). */
  generatedBy: string | null
}

export interface StarInfoDto {
  id: string
  name: string | null
  spect: string
  absmag: number
  mag: number
  ci: number
  pos: [number, number, number]
  generated: boolean
  teff: number
  luminosity: number
  radius: number
  mass: number | null
  massSource: string
  overridden: string[]
}

export interface SystemInfoDto {
  id: string
  path: string
  name: string
  starId: string
  value: Record<string, unknown>
  star: StarInfoDto | null
  starError: string | null
  /** Habitable zone, m. */
  habitableZone: [number, number] | null
  /** Collapse radius around the star, m. */
  collapse: number | null
  bodies: BodyInfoDto[]
  /** Who held it and who lived there, resolved and in time order. */
  history: HistoryEntryDto[]
}

export interface HistoryEntryDto {
  index: number
  t: number | null
  polity: string | null
  cultures: { culture: string; share: number }[]
  note: string | null
  errors: string[]
}

export interface PhysicsSummary {
  legLimit_ly: number
  topSpeed_c: number
  collapseRadius_au: number
  loadRule: 'max-eigen' | 'rss'
  /** The world's torch settings, for travel times inside a system. */
  torch: { exhaustSpeed_c: number; propellantFraction: number; cruiseAccel_g: number }
}

/** Stars near a point, packed for drawing. */
export interface StarField {
  ids: string[]
  /** x, y, z per star, light-years. */
  pos: Float32Array
  absmag: Float32Array
  ci: Float32Array
  /** Index → name, for named stars only. */
  names: Record<number, string>
  generated: Uint8Array
}

export interface StarSearchHit {
  id: string
  name: string
  /** Which system sits on it, if one does. */
  system: string | null
  distance: number
}

export interface PlanetProposal {
  roll: number
  bodies: { id: string; value: Record<string, unknown> }[]
  /** Rolled planets left out when kept: their orbits cross a body the system already has (its known planets). */
  clashes: { id: string; with: string }[]
}

// ---- Phase 4: cultures, polities, relations ----

/** An entity's id, file and value (null when the file does not parse). */
export interface EntityDto {
  id: string
  path: string
  value: Record<string, unknown> | null
}

export interface CultureSettingsDto {
  traits: { id: string; label: string; low?: string; high?: string; weight: number }[]
  affinity: { opennessTrait?: string; closedFloor: number }
}

// ---- Phase 5: routes and traffic ----

/** A route node: "system:<id>", "station:<id>" or "star:<id>". */
export interface RouteNodeDto {
  id: string
  kind: 'system' | 'station' | 'star'
  name: string
  /** Light-years; null when it cannot be found. */
  pos: [number, number, number] | null
  system: string | null
  /** Torch times between the dock and the collapse edge, s. */
  crawlOut: number | null
  crawlIn: number | null
  crawlDistance: number | null
  declared: number
  /** The file it lives in, if any. */
  path: string | null
}

export interface RouteLegDto {
  index: number
  from: string
  to: string
  ly: number | null
  /** Time in the foam, s. */
  foam: number | null
  tooLong: boolean
  nebulae: string[]
}

export interface RouteServiceDto {
  index: number
  from: number
  to: number
  perDay: number
  note: string | null
  stops: string[]
  error: string | null
  /** Door to door, s. */
  duration: number | null
  fleet: number | null
}

export interface RouteInfoDto {
  id: string
  path: string
  value: Record<string, unknown>
  name: string
  color: string | null
  /** Node id per waypoint. */
  nodes: (string | null)[]
  legs: RouteLegDto[]
  services: RouteServiceDto[]
  length: number | null
}

export interface NodeBalanceDto {
  node: string
  arrivals: number
  departures: number
  net: number
  declared: number
  imbalance: number
  through: number
  /** The imbalance it may carry without a warning. */
  allowed: number
  unbalanced: boolean
}

export interface TrafficDto {
  nodes: NodeBalanceDto[]
  declaredTotal: number
  fleet: number
  unknownDurations: number
  /** Ships under way per directed leg, keyed "from→to". */
  inTransit: Record<string, number>
}

export interface RoutePlanDto {
  waypoints: Record<string, string>[]
  duration: number
  ly: number
}

export interface BalanceSuggestionDto {
  suggestions: { route: string; from: number; to: number; perDay: number }[]
  /** Ship-days per day the additions cost. */
  cost: number
  /** Imbalance no route can take away, by node. */
  remaining: Record<string, number>
}

// ---- Phase 6: sky and approach ----

export type V3 = [number, number, number]

export interface SkyStarsDto {
  ids: string[]
  /** Unit directions in the system frame, x y z per star. */
  dir: Float32Array
  mag: Float32Array
  ci: Float32Array
  names: Record<number, string>
}

export interface ViewpointDto {
  body: string
  lat_deg: number
  lon_deg: number
  elevation_m?: number
}

export interface SkySceneDto {
  system: string
  body: string
  t: number
  frame: { up: V3; north: V3; east: V3 }
  sun: { dir: V3; mag: number; radius: number }
  bodies: { id: string; name: string; dir: V3; distance: number; mag: number; radius: number; phase: number; lit: V3 }[]
  torches: {
    route: string
    service: number
    neighbour: string
    kind: 'in' | 'out'
    dir: V3
    distance: number
    mag: number
    tau: number
    dark: boolean
  }[]
  routes: { route: string; neighbour: string; kind: 'in' | 'out'; perDay: number; crawl: number; expected: number; shown: number }[]
  atmosphere: { radius: number; column: number; scaleHeight: number; light: number } | null
  galPole: V3
  galCentre: V3
}

export interface ApproachQueryDto {
  system: string
  from: string
  t: number
  /** Aim offset in the aim plane, m. */
  offset?: [number, number]
  margin?: number
}

export interface ApproachInfoDto {
  back: V3
  port: V3
  drop: V3 | null
  dropRadius: number | null
  crawlDistance: number | null
  crawl: number | null
  starOnly: { dropRadius: number | null; crawl: number | null }
  leeGain: number | null
  margin: { best: number | null; worst: number | null } | null
}

export interface ApproachMapDto {
  crawl: (number | null)[]
  extent: number
  n: number
}

export interface ApproachSeriesDto {
  t: number[]
  crawl: (number | null)[]
  starOnly: (number | null)[]
}

// ---- Phase 7: history ----

export interface ProposedFileDto {
  key: string
  kind: string
  id: string
  path: string
  value: Record<string, unknown>
  group: 'system' | 'culture' | 'route' | 'event' | 'polity'
  label: string
  change: boolean
  year: number | null
  stars: string[]
}

export interface HistoryProposalDto {
  seed: number
  files: ProposedFileDto[]
  conflicts: string[]
  shares: Record<string, { target: number; actual: number }>
  counts: { systems: number; cultures: number; routes: number; events: number }
  positions: Record<string, [number, number, number]>
  origin: string
}

export interface NewsDto {
  from: string
  t0: number
  arrivals: { system: string; t: number; via: 'here' | 'radio' | 'ships'; path: string[] }[]
}

// ---- Trips ----

export interface TripQueryDto {
  ship: string
  route: string
  from: number
  to: number
  t: number
}

export interface TripBurnDto {
  accel: { time: number; distance: number }
  coast: { time: number; distance: number }
  decel: { time: number; distance: number }
  peakSpeed: number
  propellant: number
  accelPropellant: number
  massEnd: number
}

export interface TripLegDto {
  from: string
  to: string
  fromName: string
  toName: string
  departs: number
  arrives: number
  depart: TripBurnDto | null
  foam: { time: number; propellant: number }
  arrive: TripBurnDto | null
  refuel: { time: number; propellant: number } | null
  propellantStart: number
  propellantEnd: number
  speedCap: number | null
  ideal: number | null
  problems: string[]
}

export interface TripPlanDto {
  ship: string
  shipName: string
  legs: TripLegDto[]
  departs: number
  arrives: number
  total: number
  ideal: number | null
  problems: string[]
}

// ---- Phase 8: terrain ----

export interface TerrainRasterDto {
  width: number
  height: number
  /** km above sea level, rows from the north pole, longitude −180° to 180°. */
  heights: Float32Array
  rgba: Uint8ClampedArray
  stats: { ocean: number; highest: number; lowest: number; meanTemp: number | null; minTemp: number | null; maxTemp: number | null }
  /** Cloud coverage 0–255 per pixel, when there is a cloud layer; drawn over rgba only when shown. */
  clouds: Uint8ClampedArray | null
  cloudColour: [number, number, number] | null
}

// ---- Phase 9: cities ----

export interface CityInfoDto {
  id: string
  path: string
  value: Record<string, unknown>
  founded: number | null
  /** Population points, resolved and in time order. */
  population: { index: number; t: number; people: number }[]
  errors: string[]
}

export interface ConditionsDto {
  t: number
  localHours: number | null
  localHour_s: number | null
  sun: { alt: number; az: number }
  season: { name: string; hemisphere: 'north' | 'south'; declination: number; seasons: boolean }
  daylight: {
    day: number | null
    civil: number | null
    nautical: number | null
    astronomical: number | null
    sunrise: number | null
    sunset: number | null
    polar: 'day' | 'night' | null
  }
  tide: {
    main: string | null
    trend: 'rising' | 'falling' | 'slack'
    level: number
    nextHigh_s: number | null
    spring: number | null
  } | null
  polity: string | null
  population: number
  port: {
    arriving: { route: string; neighbour: string; perDay: number; underway: number }[]
    leaving: { route: string; neighbour: string; perDay: number; underway: number }[]
    inPort: number
  } | null
  errors: string[]
}

// ---- Phase 10: city plans ----

export interface PlanBoxDto {
  cx: number
  cy: number
  hw: number
  hd: number
  ang: number
  z0: number
  z1: number
  alb: number[]
  emit?: number[]
  kind: string
  src: string
}

export interface PlanGeometryDto {
  boxes: PlanBoxDto[]
  faces: { a: [number, number]; b: [number, number]; zLo: number; zHi: number; n: [number, number]; src: string }[]
  stats: { boxes: number; byKind: Record<string, number> }
}

export interface TravelDto {
  total: number
  arrive: number
  legs: { mode: 'walk' | 'wait' | 'ride' | 'orbit'; line?: string; from: [number, number]; to: [number, number]; duration: number }[]
}

export interface PortCapacityDto {
  limits: { corridor: number; stack: number; fleet: number; field: number }
  capacity: number
  binding: 'corridor' | 'stack' | 'fleet' | 'field'
  tripsPerFreighter: number
  demand: number | null
}
