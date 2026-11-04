import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MenuCommand } from '../shared/ipc'
import type { AppInfo, CheckReport, FolderInfo, Settings, UpdateStatus, WorldInfo, WorldResult } from '../shared/types'

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
    chooseFolder: (purpose: 'open' | 'create'): Promise<string | null> => ipcRenderer.invoke(IPC.worldChooseFolder, purpose),
    inspect: (dir: string): Promise<FolderInfo> => ipcRenderer.invoke(IPC.worldInspect, dir),
    open: (dir: string): Promise<WorldResult> => ipcRenderer.invoke(IPC.worldOpen, dir),
    create: (dir: string, name: string): Promise<WorldResult> => ipcRenderer.invoke(IPC.worldCreate, dir, name),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.worldClose),
    reveal: (): Promise<void> => ipcRenderer.invoke(IPC.worldReveal),
    forgetRecent: (dir: string): Promise<Settings> => ipcRenderer.invoke(IPC.worldForgetRecent, dir),
    /** Run every check on the open world (reads only). */
    check: (): Promise<CheckReport | null> => ipcRenderer.invoke(IPC.worldCheck),
    /** Rewrite exactly these files into canonical form. Resolves to the paths that changed. */
    fix: (paths: string[]): Promise<string[]> => ipcRenderer.invoke(IPC.worldFix, paths),
    /** Add any new-world template files the world is missing. Resolves to the paths added. */
    addTemplate: (): Promise<string[]> => ipcRenderer.invoke(IPC.worldAddTemplate),
    onChanged: (cb: (world: WorldInfo | null) => void): Unsubscribe => on(IPC.evWorldChanged, cb)
  },
  updates: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updatesStatus),
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updatesCheck),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updatesInstall),
    /** Tools report unsaved changes so an update never restarts the app under them. */
    setBusy: (busy: boolean): Promise<void> => ipcRenderer.invoke(IPC.updatesSetBusy, busy),
    onStatus: (cb: (status: UpdateStatus) => void): Unsubscribe => on(IPC.evUpdateStatus, cb)
  }
}

export type MalevoApi = typeof api

contextBridge.exposeInMainWorld('malevo', api)
