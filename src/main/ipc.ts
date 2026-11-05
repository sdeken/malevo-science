import { app, dialog, ipcMain, nativeImage, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { WORLD_FORMAT } from '@malevo/model'
import { IPC } from '../shared/ipc'
import type { AppInfo, ApproachQueryDto, EditableKind, Settings, ViewpointDto, WorldResult } from '../shared/types'
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
  'route',
  'viewpoint',
  'historySettings',
  'terrain',
  'city',
  'cityPlan'
]
const asKind = (k: unknown): EditableKind => {
  if (!EDITABLE.includes(k as EditableKind)) throw new Error(`"${String(k)}" cannot be edited.`)
  return k as EditableKind
}

function asViewpoint(v: unknown): ViewpointDto {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    body: String(o.body ?? ''),
    lat_deg: Number(o.lat_deg) || 0,
    lon_deg: Number(o.lon_deg) || 0,
    elevation_m: o.elevation_m === undefined ? undefined : Number(o.elevation_m) || 0
  }
}

function asApproach(v: unknown): ApproachQueryDto {
  const o = (v ?? {}) as Record<string, unknown>
  const off = Array.isArray(o.offset) && o.offset.length === 2 ? (o.offset.map((x) => Number(x) || 0) as [number, number]) : undefined
  return {
    system: String(o.system ?? ''),
    from: String(o.from ?? ''),
    t: Number(o.t) || 0,
    offset: off,
    margin: Number(o.margin) || undefined
  }
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
  ipcMain.handle(IPC.worldAddSolarSystem, () => world.addSolarSystem())
  ipcMain.handle(IPC.worldAddKnownPlanets, (_e, sys: unknown, candidates: unknown) =>
    world.addKnownPlanets(String(sys), candidates === true)
  )
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
  ipcMain.handle(IPC.skyStars, (_e, system: unknown) => world.skyStars(String(system)))
  ipcMain.handle(IPC.skyScene, (_e, vp: unknown, t: unknown) => world.skyScene(asViewpoint(vp), Number(t)))
  ipcMain.handle(IPC.skyNoon, (_e, body: unknown, lon: unknown, t: unknown) =>
    world.skyNoon(String(body), Number(lon) || 0, Number(t) || 0)
  )
  ipcMain.handle(IPC.historyPropose, (_e, seed: unknown) =>
    world.historyPropose(seed === undefined || seed === null ? undefined : Number(seed) >>> 0)
  )
  ipcMain.handle(IPC.historyAccept, (_e, keys: unknown) => world.historyAccept(Array.isArray(keys) ? keys.map(String) : []))
  ipcMain.handle(IPC.historyNews, (_e, event: unknown) => world.historyNews(String(event)))
  ipcMain.handle(IPC.planGeometry, (_e, id: unknown) => world.planGeometry(String(id)))
  ipcMain.handle(IPC.planTravel, (_e, id: unknown, from: unknown, to: unknown, depart: unknown, hour: unknown) => {
    const xy = (v: unknown): [number, number] => (Array.isArray(v) && v.length >= 2 ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0])
    return world.planTravel(String(id), xy(from), to === 'orbit' ? 'orbit' : xy(to), Number(depart) || 0, Number(hour) || 3600)
  })
  ipcMain.handle(IPC.planPort, (_e, id: unknown) => world.planPort(String(id)))
  ipcMain.handle(IPC.cityConditions, (_e, id: unknown, t: unknown) => world.cityConditions(String(id), Number(t) || 0))
  ipcMain.handle(IPC.terrainRaster, (_e, body: unknown, w: unknown, h: unknown) =>
    world.terrainRaster(
      String(body),
      Math.max(16, Math.min(4096, Math.trunc(Number(w)) || 512)),
      Math.max(8, Math.min(2048, Math.trunc(Number(h)) || 256))
    )
  )
  ipcMain.handle(IPC.terrainExport, async (e, body: unknown, what: unknown) => {
    // Exports go wherever the author chooses, for reference; they are never part of the world.
    const r = world.terrainRaster(String(body), 2048, 1024)
    if ('error' in r) return null
    const win = winOf(e)
    const heightMap = what === 'height'
    const cloudMap = what === 'clouds' && r.clouds !== null
    const opts = {
      title: 'Export map',
      defaultPath: `${String(body)}-${heightMap ? 'height' : cloudMap ? 'clouds' : 'colour'}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    const bgra = Buffer.alloc(r.width * r.height * 4)
    for (let k = 0; k < r.width * r.height; k++) {
      if (cloudMap) {
        // The cloud colour, with the coverage as transparency, to lay over the colour map.
        // createFromBitmap takes premultiplied alpha, so the colour is scaled by the coverage.
        const a = r.clouds![k]
        bgra[k * 4] = Math.round((r.cloudColour![2] * a) / 255)
        bgra[k * 4 + 1] = Math.round((r.cloudColour![1] * a) / 255)
        bgra[k * 4 + 2] = Math.round((r.cloudColour![0] * a) / 255)
        bgra[k * 4 + 3] = a
        continue
      }
      if (heightMap) {
        const v = Math.round(((r.heights[k] - r.stats.lowest) / Math.max(1e-9, r.stats.highest - r.stats.lowest)) * 255)
        bgra[k * 4] = bgra[k * 4 + 1] = bgra[k * 4 + 2] = v
      } else {
        bgra[k * 4] = r.rgba[k * 4 + 2]
        bgra[k * 4 + 1] = r.rgba[k * 4 + 1]
        bgra[k * 4 + 2] = r.rgba[k * 4]
      }
      bgra[k * 4 + 3] = 255
    }
    await fs.writeFile(res.filePath, nativeImage.createFromBitmap(bgra, { width: r.width, height: r.height }).toPNG())
    return res.filePath
  })
  ipcMain.handle(IPC.approachInfo, (_e, q: unknown) => world.approachInfo(asApproach(q)))
  ipcMain.handle(IPC.approachMap, (_e, q: unknown, extent: unknown, n: unknown) =>
    world.approachMap(asApproach(q), Number(extent) || 1, Math.max(5, Math.min(121, Math.trunc(Number(n)) || 41)))
  )
  ipcMain.handle(IPC.approachSeries, (_e, q: unknown, t0: unknown, t1: unknown, n: unknown) =>
    world.approachSeries(asApproach(q), Number(t0), Number(t1), Math.max(2, Math.min(1000, Math.trunc(Number(n)) || 120)))
  )
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
