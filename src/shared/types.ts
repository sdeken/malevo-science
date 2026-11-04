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
