import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { WORLD_FORMAT } from '@malevo/model'
import { IPC } from '../shared/ipc'
import type { AppInfo, Settings } from '../shared/types'
import type { SettingsStore } from './settings'
import type { Updater } from './updates'
import type { WorldSession } from './world'

export interface IpcDeps {
  settings: SettingsStore
  world: WorldSession
  updater: Updater
  setBusy: (busy: boolean) => void
}

/** Registers every request handler. Arguments from the renderer are untrusted and are coerced here. */
export function registerIpc(deps: IpcDeps): void {
  const { settings, world, updater } = deps

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    worldFormat: WORLD_FORMAT
  }))

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, async (_e, patch: unknown) => {
    const safe: Partial<Settings> = {}
    if (patch && typeof patch === 'object' && 'autoUpdate' in patch) safe.autoUpdate = Boolean((patch as Settings).autoUpdate)
    return settings.set(safe)
  })

  ipcMain.handle(IPC.worldCurrent, () => world.info())
  ipcMain.handle(IPC.worldChooseFolder, async (event, purpose: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const creating = purpose === 'create'
    const options: Electron.OpenDialogOptions = {
      title: creating ? 'Choose an empty folder for the new world' : 'Open a world folder',
      buttonLabel: creating ? 'Use this folder' : 'Open world',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.worldInspect, (_e, dir: unknown) => world.inspect(String(dir)))
  ipcMain.handle(IPC.worldOpen, async (_e, dir: unknown) => {
    const result = await world.open(String(dir))
    if (result.ok) await settings.rememberWorld(result.world.root)
    return result
  })
  ipcMain.handle(IPC.worldCreate, async (_e, dir: unknown, name: unknown) => {
    const result = await world.create(String(dir), String(name ?? ''))
    if (result.ok) await settings.rememberWorld(result.world.root)
    return result
  })
  ipcMain.handle(IPC.worldClose, async () => {
    world.close()
    await settings.set({ lastWorld: null })
  })
  ipcMain.handle(IPC.worldReveal, () => {
    const info = world.info()
    if (info) void shell.openPath(info.root)
  })
  ipcMain.handle(IPC.worldForgetRecent, (_e, dir: unknown) => settings.forgetWorld(String(dir)))

  ipcMain.handle(IPC.updatesStatus, () => updater.getStatus())
  ipcMain.handle(IPC.updatesCheck, () => updater.check())
  ipcMain.handle(IPC.updatesInstall, () => updater.requestInstall())
  ipcMain.handle(IPC.updatesSetBusy, (_e, busy: unknown) => deps.setBusy(Boolean(busy)))
}
