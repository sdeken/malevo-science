import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { WORLD_FORMAT } from '@malevo/model'
import { IPC } from '../shared/ipc'
import type { AppInfo, EditableKind, Settings, WorldResult } from '../shared/types'
import type { SettingsStore } from './settings'
import type { Updater } from './updates'
import type { WorldSession } from './world'

export interface IpcDeps {
  settings: SettingsStore
  world: WorldSession
  updater: Updater
}

/**
 * Before leaving a world with unsaved changes (opening another, closing,
 * quitting): Save, Don't save, or Cancel. Resolves true when it is fine to go on.
 */
export async function confirmLeave(world: WorldSession, win: BrowserWindow | null): Promise<boolean> {
  if (!world.dirty) return true
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Unsaved changes',
    message: `${world.info()?.name ?? 'This world'} has unsaved changes.`,
    detail: 'Save them before leaving the world?'
  }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (response === 2) return false
  if (response === 0) await world.save()
  return true
}

const EDITABLE: readonly EditableKind[] = [
  'event',
  'calendar',
  'physics',
  'system',
  'body',
  'culture',
  'polity',
  'relation',
  'cultureSettings',
  'station',
  'nebula',
  'route'
]
const asKind = (k: unknown): EditableKind => {
  if (!EDITABLE.includes(k as EditableKind)) throw new Error(`"${String(k)}" cannot be edited.`)
  return k as EditableKind
}

/** Registers every request handler. Arguments from the renderer are untrusted and are coerced here. */
export function registerIpc(deps: IpcDeps): void {
  const { settings, world, updater } = deps
  const winOf = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)
  const cancelled: WorldResult = { ok: false, code: 'cancelled', message: '' }

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
    const win = winOf(event)
    const creating = purpose === 'create' || purpose === 'fork'
    const options: Electron.OpenDialogOptions = {
      title:
        purpose === 'fork'
          ? 'Choose an empty folder for the fork'
          : creating
            ? 'Choose an empty folder for the new world'
            : 'Choose a world folder',
      buttonLabel: purpose === 'fork' ? 'Fork here' : creating ? 'Use this folder' : purpose === 'compare' ? 'Compare' : 'Open world',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.worldInspect, (_e, dir: unknown) => world.inspect(String(dir)))
  ipcMain.handle(IPC.worldOpen, async (e, dir: unknown) => {
    if (!(await confirmLeave(world, winOf(e)))) return cancelled
    const result = await world.open(String(dir))
    if (result.ok) await settings.rememberWorld(result.world.root)
    return result
  })
  ipcMain.handle(IPC.worldCreate, async (e, dir: unknown, name: unknown) => {
    if (!(await confirmLeave(world, winOf(e)))) return cancelled
    const result = await world.create(String(dir), String(name ?? ''))
    if (result.ok) await settings.rememberWorld(result.world.root)
    return result
  })
  ipcMain.handle(IPC.worldClose, async (e) => {
    if (!(await confirmLeave(world, winOf(e)))) return false
    world.close()
    await settings.set({ lastWorld: null })
    return true
  })
  ipcMain.handle(IPC.worldReveal, () => {
    const info = world.info()
    if (info) void shell.openPath(info.root)
  })
  ipcMain.handle(IPC.worldForgetRecent, (_e, dir: unknown) => settings.forgetWorld(String(dir)))
  ipcMain.handle(IPC.worldCheck, () => world.check())
  ipcMain.handle(IPC.worldAddTemplate, () => world.addTemplate())
  ipcMain.handle(IPC.worldFix, (_e, paths: unknown) => world.fix(Array.isArray(paths) ? paths.map(String) : []))

  ipcMain.handle(IPC.worldSnapshot, () => world.snapshot())
  ipcMain.handle(IPC.worldSetEntity, (_e, kind: unknown, id: unknown, value: unknown) => world.setEntity(asKind(kind), String(id), value))
  ipcMain.handle(IPC.worldDeleteEntity, (_e, kind: unknown, id: unknown) => world.deleteEntity(asKind(kind), String(id)))
  ipcMain.handle(IPC.worldDeleteEntities, (_e, items: unknown) =>
    world.deleteEntities(
      Array.isArray(items) ? items.map((i) => ({ kind: asKind((i as { kind: unknown }).kind), id: String((i as { id: unknown }).id) })) : []
    )
  )
  ipcMain.handle(IPC.worldSetScript, (_e, id: unknown, code: unknown) => world.setScript(String(id), code === null ? null : String(code)))
  ipcMain.handle(IPC.worldUndo, () => world.undo())
  ipcMain.handle(IPC.worldRedo, () => world.redo())
  ipcMain.handle(IPC.worldSave, () => world.save())
  ipcMain.handle(IPC.worldDiscard, () => world.discard())
  ipcMain.handle(IPC.worldFork, (_e, dest: unknown) => world.fork(String(dest)))
  ipcMain.handle(IPC.worldCompare, (_e, other: unknown) => world.compare(String(other)))
  ipcMain.handle(IPC.worldTake, (_e, other: unknown, keys: unknown) =>
    world.take(String(other), Array.isArray(keys) ? keys.map(String) : [])
  )

  ipcMain.handle(IPC.starsNear, (_e, center: unknown, radius: unknown, generated: unknown) => {
    const c =
      Array.isArray(center) && center.length === 3
        ? (center.map(Number) as [number, number, number])
        : ([0, 0, 0] as [number, number, number])
    return world.starsNear(c, Number(radius) || 20, Boolean(generated))
  })
  ipcMain.handle(IPC.starsGet, (_e, id: unknown) => world.star(String(id)))
  ipcMain.handle(IPC.starsSearch, (_e, text: unknown) => world.searchStars(String(text)))
  ipcMain.handle(IPC.systemsRoll, (_e, id: unknown, roll: unknown) => world.roll(String(id), Number(roll)))
  ipcMain.handle(IPC.systemsKeep, (_e, id: unknown, roll: unknown) => world.keep(String(id), Number(roll)))
  ipcMain.handle(IPC.routesPlan, (_e, from: unknown, to: unknown) => world.planRoute(String(from), String(to)))
  ipcMain.handle(IPC.routesBalance, (_e, only: unknown) => world.balance(Array.isArray(only) ? only.map(String) : undefined))

  ipcMain.handle(IPC.calTicks, (_e, cal: unknown, t0: unknown, t1: unknown, target: unknown) =>
    world.ticks(String(cal), Number(t0), Number(t1), Number(target))
  )
  ipcMain.handle(IPC.calFormat, (_e, cal: unknown, items: unknown) =>
    world.format(
      String(cal),
      Array.isArray(items)
        ? items.map((i) => ({ t: Number((i as { t: unknown }).t), precision: (i as { precision?: string | null }).precision ?? null }))
        : []
    )
  )
  ipcMain.handle(IPC.calParse, (_e, cal: unknown, text: unknown) => world.parse(String(cal), String(text)))

  ipcMain.handle(IPC.updatesStatus, () => updater.getStatus())
  ipcMain.handle(IPC.updatesCheck, () => updater.check())
  ipcMain.handle(IPC.updatesInstall, () => updater.requestInstall())
}
