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

export type EditableKind = 'event' | 'calendar' | 'physics' | 'system' | 'body' | 'culture' | 'polity' | 'relation' | 'cultureSettings'

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
