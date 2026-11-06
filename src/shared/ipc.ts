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
  worldCheck: 'world:check',
  worldFix: 'world:fix',
  worldAddTemplate: 'world:addTemplate',
  worldAddSolarSystem: 'world:addSolarSystem',
  worldAddKnownPlanets: 'world:addKnownPlanets',
  proseRead: 'prose:read',
  proseWrite: 'prose:write',
  worldSnapshot: 'world:snapshot',
  worldSetEntity: 'world:setEntity',
  worldDeleteEntity: 'world:deleteEntity',
  worldDeleteEntities: 'world:deleteEntities',
  worldSetScript: 'world:setScript',
  worldUndo: 'world:undo',
  worldRedo: 'world:redo',
  worldSave: 'world:save',
  worldDiscard: 'world:discard',
  worldFork: 'world:fork',
  worldCompare: 'world:compare',
  worldTake: 'world:take',

  starsNear: 'stars:near',
  starsGet: 'stars:get',
  starsSearch: 'stars:search',
  systemsRoll: 'systems:roll',
  systemsKeep: 'systems:keep',
  routesPlan: 'routes:plan',
  routesBalance: 'routes:balance',
  skyStars: 'sky:stars',
  skyScene: 'sky:scene',
  skyNoon: 'sky:noon',
  approachInfo: 'approach:info',
  historyPropose: 'history:propose',
  historyAccept: 'history:accept',
  historyNews: 'history:news',
  approachMap: 'approach:map',
  approachSeries: 'approach:series',
  terrainRaster: 'terrain:raster',
  cityConditions: 'city:conditions',
  planGeometry: 'plan:geometry',
  planTravel: 'plan:travel',
  planPort: 'plan:port',
  terrainExport: 'terrain:export',

  calTicks: 'cal:ticks',
  calFormat: 'cal:format',
  calParse: 'cal:parse',

  updatesStatus: 'updates:status',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',

  evWorldChanged: 'ev:worldChanged',
  evSnapshot: 'ev:snapshot',
  evSettingsChanged: 'ev:settingsChanged',
  evUpdateStatus: 'ev:updateStatus',
  evMenu: 'ev:menu'
} as const

/** Menu items the renderer acts on (the rest are handled in main). */
export type MenuCommand = 'new-world' | 'open-world' | 'close-world' | 'about' | 'save' | 'undo' | 'redo' | 'fork-world'
