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

export type EditableKind = 'event' | 'calendar' | 'physics'
