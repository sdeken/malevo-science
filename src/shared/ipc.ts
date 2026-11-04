/**
 * IPC channel names. Requests are `domain:verb` (ipcRenderer.invoke);
 * main-to-renderer events are `ev:name`.
 */
export const IPC = {
  appInfo: 'app:info',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  worldCurrent: 'world:current',
  worldChooseFolder: 'world:chooseFolder',
  worldInspect: 'world:inspect',
  worldOpen: 'world:open',
  worldCreate: 'world:create',
  worldClose: 'world:close',
  worldReveal: 'world:reveal',
  worldForgetRecent: 'world:forgetRecent',

  updatesStatus: 'updates:status',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesSetBusy: 'updates:setBusy',

  evWorldChanged: 'ev:worldChanged',
  evSettingsChanged: 'ev:settingsChanged',
  evUpdateStatus: 'ev:updateStatus',
  evMenu: 'ev:menu'
} as const

/** Menu items the renderer acts on (the rest are handled in main). */
export type MenuCommand = 'new-world' | 'open-world' | 'close-world' | 'about'
