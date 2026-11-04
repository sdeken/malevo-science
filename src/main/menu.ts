import { Menu, app, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '../shared/ipc'

export interface MenuDeps {
  window: () => BrowserWindow | null
  hasWorld: () => boolean
  checkForUpdates: () => void
}

export function buildMenu(deps: MenuDeps): void {
  const send = (command: MenuCommand) => () => deps.window()?.webContents.send(IPC.evMenu, command)
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: '&New World…', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-world') },
        { label: '&Open World…', accelerator: 'CmdOrCtrl+O', click: send('open-world') },
        { type: 'separator' },
        { label: '&Save', accelerator: 'CmdOrCtrl+S', enabled: deps.hasWorld(), click: send('save') },
        { label: '&Fork World…', enabled: deps.hasWorld(), click: send('fork-world') },
        { type: 'separator' },
        { label: '&Close World', enabled: deps.hasWorld(), click: send('close-world') },
        { type: 'separator' },
        { role: 'quit', label: 'E&xit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        // Shown, not registered: in a text field Ctrl+Z undoes typing; elsewhere the page turns it into a world undo.
        { label: '&Undo Change', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, enabled: deps.hasWorld(), click: send('undo') },
        { label: '&Redo Change', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, enabled: deps.hasWorld(), click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Check for &Updates', enabled: app.isPackaged, click: () => deps.checkForUpdates() },
        { label: `&About ${app.getName()}`, click: send('about') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
