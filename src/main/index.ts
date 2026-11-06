import path from 'node:path'
import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { confirmLeave, registerIpc } from './ipc'
import { buildMenu } from './menu'
import { SettingsStore } from './settings'
import { Updater } from './updates'
import { WorldSession } from './world'
import { existsSync } from 'node:fs'
import type { WorldEnv } from '@malevo/model'
import { loadCatalog, nodeEnv } from '@malevo/model/node'

// Tests point userData at a throwaway folder.
if (process.env.MALEVO_USER_DATA) app.setPath('userData', process.env.MALEVO_USER_DATA)

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))
// The catalogue is loaded once at start, before any world opens (caches key on this object).
const env: WorldEnv = { loadScript: nodeEnv.loadScript }
const world = new WorldSession(env)

/** The star catalogue: beside the app when installed, in assets/ when run from the repository. */
function catalogPath(): string | null {
  for (const p of [
    path.join(process.resourcesPath ?? '', 'catalog', 'hyg-stars.json'),
    path.join(app.getAppPath(), 'assets', 'catalog', 'hyg-stars.json')
  ]) {
    if (existsSync(p)) return p
  }
  return null
}
let mainWindow: BrowserWindow | null = null
let screenLocked = false
let closeConfirmed = false
let lastReload = 0

const updater = new Updater({
  enabled: () => settings.get().autoUpdate,
  windowVisible: () => Boolean(mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()),
  windowFocused: () => Boolean(mainWindow?.isFocused()),
  locked: () => screenLocked,
  busy: () => world.dirty,
  prepareQuit: async () => {
    /* Nothing to flush yet: no tool holds unsaved world data. */
  }
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Malevo Science',
    backgroundColor: '#14161c',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? process.env.ELECTRON_RENDERER_URL! : 'file://'
    if (!url.startsWith(allowed)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
  // Leaving with unsaved changes asks first.
  win.on('close', (event) => {
    if (closeConfirmed || !world.dirty) return
    event.preventDefault()
    void confirmLeave(world, win).then((ok) => {
      if (!ok) return
      closeConfirmed = true
      win.close()
    })
  })
  // Coming back to the window picks up edits made outside the app (unsaved changes stay on top).
  win.on('focus', () => {
    if (Date.now() - lastReload < 2000) return
    lastReload = Date.now()
    void world.reload()
  })
  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

function refreshMenu(): void {
  buildMenu({
    window: () => mainWindow,
    hasWorld: () => world.info() !== null,
    checkForUpdates: () => void updater.check()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.sdeken.malevo-science')
    await settings.load()
    const catalog = catalogPath()
    if (catalog) {
      try {
        env.catalog = await loadCatalog(catalog)
      } catch (err) {
        console.error('[stars] could not load the catalogue', err)
      }
    } else console.error('[stars] the star catalogue is missing')

    registerIpc({ settings, world, updater })

    let lastDirty = false
    world.on('snapshot', () => {
      mainWindow?.webContents.send(IPC.evSnapshot, world.snapshot())
      if (world.dirty !== lastDirty) {
        lastDirty = world.dirty
        const info = world.info()
        mainWindow?.setTitle(info ? `${world.dirty ? '• ' : ''}${info.name} — Malevo Science` : 'Malevo Science')
      }
    })
    world.on('changed', (info) => {
      mainWindow?.webContents.send(IPC.evWorldChanged, info)
      mainWindow?.setTitle(info ? `${info.name} — Malevo Science` : 'Malevo Science')
      refreshMenu()
    })
    updater.on('status', (status) => mainWindow?.webContents.send(IPC.evUpdateStatus, status))

    powerMonitor.on('lock-screen', () => (screenLocked = true))
    powerMonitor.on('unlock-screen', () => (screenLocked = false))

    // Reopen the last world. A world that has moved or no longer opens is
    // simply not reopened; it stays in the recent list, marked, for the user to deal with.
    const last = settings.get().lastWorld
    if (last) await world.open(last)

    refreshMenu()
    mainWindow = createWindow()
    if (world.info()) mainWindow.setTitle(`${world.info()!.name} — Malevo Science`)
    updater.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    updater.stop()
    app.quit()
  })
}
