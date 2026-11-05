import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MenuCommand } from '../shared/ipc'
import type {
  AppInfo,
  CheckReport,
  CompareReport,
  EditableKind,
  FolderInfo,
  ParsedDate,
  PlanetProposal,
  Settings,
  StarField,
  StarInfoDto,
  StarSearchHit,
  TickInfo,
  UpdateStatus,
  WorldInfo,
  WorldResult,
  WorldSnapshot
} from '../shared/types'

type Unsubscribe = () => void

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** The renderer's only way to reach the main process. The renderer never touches the file system. */
const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
    onMenu: (cb: (command: MenuCommand) => void): Unsubscribe => on(IPC.evMenu, cb)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<Pick<Settings, 'autoUpdate'>>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  world: {
    current: (): Promise<WorldInfo | null> => ipcRenderer.invoke(IPC.worldCurrent),
    /** Shows a folder picker; resolves to the chosen path, or null if cancelled. */
    chooseFolder: (purpose: 'open' | 'create' | 'fork' | 'compare'): Promise<string | null> =>
      ipcRenderer.invoke(IPC.worldChooseFolder, purpose),
    inspect: (dir: string): Promise<FolderInfo> => ipcRenderer.invoke(IPC.worldInspect, dir),
    /** Asks to save first if there are unsaved changes; resolves with code "cancelled" if the user cancels. */
    open: (dir: string): Promise<WorldResult> => ipcRenderer.invoke(IPC.worldOpen, dir),
    create: (dir: string, name: string): Promise<WorldResult> => ipcRenderer.invoke(IPC.worldCreate, dir, name),
    /** Resolves false if the user cancelled because of unsaved changes. */
    close: (): Promise<boolean> => ipcRenderer.invoke(IPC.worldClose),
    reveal: (): Promise<void> => ipcRenderer.invoke(IPC.worldReveal),
    forgetRecent: (dir: string): Promise<Settings> => ipcRenderer.invoke(IPC.worldForgetRecent, dir),
    /** Run every check on the saved world (reads only). */
    check: (): Promise<CheckReport | null> => ipcRenderer.invoke(IPC.worldCheck),
    /** Rewrite exactly these files into canonical form. Resolves to the paths that changed. */
    fix: (paths: string[]): Promise<string[]> => ipcRenderer.invoke(IPC.worldFix, paths),
    /** Add any new-world template files the world is missing. Resolves to the paths added. */
    addTemplate: (): Promise<string[]> => ipcRenderer.invoke(IPC.worldAddTemplate),
    snapshot: (): Promise<WorldSnapshot | null> => ipcRenderer.invoke(IPC.worldSnapshot),
    onSnapshot: (cb: (snapshot: WorldSnapshot | null) => void): Unsubscribe => on(IPC.evSnapshot, cb),
    onChanged: (cb: (world: WorldInfo | null) => void): Unsubscribe => on(IPC.evWorldChanged, cb),
    // Edits are unsaved until save(); each is one undo step.
    setEntity: (kind: EditableKind, id: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC.worldSetEntity, kind, id, value),
    deleteEntity: (kind: EditableKind, id: string): Promise<void> => ipcRenderer.invoke(IPC.worldDeleteEntity, kind, id),
    deleteEntities: (items: { kind: EditableKind; id: string }[]): Promise<void> => ipcRenderer.invoke(IPC.worldDeleteEntities, items),
    setScript: (id: string, code: string | null): Promise<void> => ipcRenderer.invoke(IPC.worldSetScript, id, code),
    undo: (): Promise<void> => ipcRenderer.invoke(IPC.worldUndo),
    redo: (): Promise<void> => ipcRenderer.invoke(IPC.worldRedo),
    save: (): Promise<string[]> => ipcRenderer.invoke(IPC.worldSave),
    discard: (): Promise<void> => ipcRenderer.invoke(IPC.worldDiscard),
    fork: (dest: string): Promise<WorldResult> => ipcRenderer.invoke(IPC.worldFork, dest),
    compare: (other: string): Promise<CompareReport> => ipcRenderer.invoke(IPC.worldCompare, other),
    take: (other: string, keys: string[]): Promise<void> => ipcRenderer.invoke(IPC.worldTake, other, keys)
  },
  stars: {
    /** Stars within `radius` light-years of `center` (galactic ly), packed for drawing. */
    near: (center: [number, number, number], radius: number, generated: boolean): Promise<StarField> =>
      ipcRenderer.invoke(IPC.starsNear, center, radius, generated),
    get: (id: string): Promise<StarInfoDto | null> => ipcRenderer.invoke(IPC.starsGet, id),
    search: (text: string): Promise<StarSearchHit[]> => ipcRenderer.invoke(IPC.starsSearch, text)
  },
  systems: {
    /** A planets@1 proposal for a system (nothing is written). */
    roll: (id: string, roll: number): Promise<PlanetProposal> => ipcRenderer.invoke(IPC.systemsRoll, id, roll),
    /** Keep a roll as locked bodies, replacing an earlier kept roll. Unsaved, undoable. */
    keep: (id: string, roll: number): Promise<string[]> => ipcRenderer.invoke(IPC.systemsKeep, id, roll)
  },
  calendar: {
    ticks: (cal: string, t0: number, t1: number, target: number): Promise<TickInfo[]> =>
      ipcRenderer.invoke(IPC.calTicks, cal, t0, t1, target),
    format: (cal: string, items: { t: number; precision?: string | null }[]): Promise<(string | null)[]> =>
      ipcRenderer.invoke(IPC.calFormat, cal, items),
    parse: (cal: string, text: string): Promise<ParsedDate | null> => ipcRenderer.invoke(IPC.calParse, cal, text)
  },
  updates: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updatesStatus),
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updatesCheck),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updatesInstall),
    onStatus: (cb: (status: UpdateStatus) => void): Unsubscribe => on(IPC.evUpdateStatus, cb)
  }
}

export type MalevoApi = typeof api

contextBridge.exposeInMainWorld('malevo', api)
