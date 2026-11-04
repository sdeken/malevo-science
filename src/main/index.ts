import path from 'node:path'
import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { SettingsStore } from './settings'
import { Updater } from './updates'
import { WorldSession } from './world'

// Tests point userData at a throwaway folder.
if (process.env.MALEVO_USER_DATA) app.setPath('userData', process.env.MALEVO_USER_DATA)

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))
const world = new WorldSession()
let mainWindow: BrowserWindow | null = null
let screenLocked = false
let busy = false

const updater = new Updater({
  enabled: () => settings.get().autoUpdate,
  windowVisible: () => Boolean(mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()),
  windowFocused: () => Boolean(mainWindow?.isFocused()),
  locked: () => screenLocked,
  busy: () => busy,
  prepareQuit: async () => {
    /* Nothing to flush yet: Phase 0 never holds unsaved world data. */
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
  // A reload discards any unsaved state the renderer held.
  win.webContents.on('did-start-loading', () => {
    busy = false
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

    registerIpc({ settings, world, updater, setBusy: (b) => (busy = b) })

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
