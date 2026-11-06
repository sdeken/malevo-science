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
  BalanceSuggestionDto,
  SkyStarsDto,
  SkySceneDto,
  ViewpointDto,
  HistoryProposalDto,
  NewsDto,
  TerrainRasterDto,
  ConditionsDto,
  PlanGeometryDto,
  TravelDto,
  PortCapacityDto,
  ApproachQueryDto,
  ApproachInfoDto,
  ApproachMapDto,
  ApproachSeriesDto,
  RoutePlanDto,
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
    /** Add the real Solar System, or the parts of it the world lacks (unsaved, undoable). Resolves to Sol's system id. */
    addSolarSystem: (): Promise<string | null> => ipcRenderer.invoke(IPC.worldAddSolarSystem),
    addKnownPlanets: (system: string, candidates: boolean): Promise<string[]> =>
      ipcRenderer.invoke(IPC.worldAddKnownPlanets, system, candidates),
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
  sky: {
    /** Stars as seen from a system (directions in the system frame). */
    stars: (system: string): Promise<SkyStarsDto | null> => ipcRenderer.invoke(IPC.skyStars, system),
    /** The sun, bodies and torches from a point on a body at an instant. */
    scene: (vp: ViewpointDto, t: number): Promise<SkySceneDto | { error: string }> => ipcRenderer.invoke(IPC.skyScene, vp, t)
  },
  /** The prime meridian that makes it local noon at a longitude at an instant (for rotation.meridian_deg). */
  skyNoon: (body: string, lon: number, t: number): Promise<number | null> => ipcRenderer.invoke(IPC.skyNoon, body, lon, t),
  history: {
    /** Run history@1 and return what it proposes (nothing is written). */
    propose: (seed?: number): Promise<HistoryProposalDto | { error: string }> => ipcRenderer.invoke(IPC.historyPropose, seed),
    /** Accept pieces of the last run, by entity key: one undoable, unsaved step. */
    accept: (keys: string[]): Promise<number> => ipcRenderer.invoke(IPC.historyAccept, keys),
    /** When each system learned of an event. */
    news: (event: string): Promise<NewsDto | { error: string }> => ipcRenderer.invoke(IPC.historyNews, event)
  },
  plans: {
    /** A city plan's generated geometry (cityplan@1). */
    geometry: (id: string): Promise<PlanGeometryDto | null> => ipcRenderer.invoke(IPC.planGeometry, id),
    /** The quickest way across the city (or to orbit) leaving at a local time of day (s); a local hour is hour_s. */
    travel: (
      id: string,
      from: [number, number],
      to: [number, number] | 'orbit',
      depart: number,
      hour_s: number
    ): Promise<TravelDto | { error: string }> => ipcRenderer.invoke(IPC.planTravel, id, from, to, depart, hour_s),
    /** The port's capacity against the route network's arrivals. */
    port: (id: string): Promise<PortCapacityDto | null> => ipcRenderer.invoke(IPC.planPort, id)
  },
  cities: {
    /** Conditions at a city at an instant: local time, season, daylight, tide, who holds it, its port. */
    conditions: (id: string, t: number): Promise<ConditionsDto | { error: string }> => ipcRenderer.invoke(IPC.cityConditions, id, t)
  },
  terrain: {
    /** A derived height and colour map of a body's terrain (cached in main; never written to the world). */
    raster: (body: string, width: number, height: number): Promise<TerrainRasterDto | { error: string }> =>
      ipcRenderer.invoke(IPC.terrainRaster, body, width, height),
    /** Save a 2048×1024 colour or height map where the author chooses. Resolves to the path, or null if cancelled. */
    export: (body: string, what: 'colour' | 'height' | 'clouds'): Promise<string | null> =>
      ipcRenderer.invoke(IPC.terrainExport, body, what)
  },
  prose: {
    /** A prose or character file's current text (unsaved changes included), or null. */
    read: (path: string): Promise<string | null> => ipcRenderer.invoke(IPC.proseRead, path),
    /** Write (null: delete) a prose or character file: unsaved and undoable, like any edit. */
    write: (path: string, text: string | null): Promise<void> => ipcRenderer.invoke(IPC.proseWrite, path, text)
  },
  approach: {
    info: (q: ApproachQueryDto): Promise<ApproachInfoDto | { error: string }> => ipcRenderer.invoke(IPC.approachInfo, q),
    map: (q: ApproachQueryDto, extent: number, n: number): Promise<ApproachMapDto | { error: string }> =>
      ipcRenderer.invoke(IPC.approachMap, q, extent, n),
    series: (q: ApproachQueryDto, t0: number, t1: number, n: number): Promise<ApproachSeriesDto | { error: string }> =>
      ipcRenderer.invoke(IPC.approachSeries, q, t0, t1, n)
  },
  routes: {
    /** The quickest chain of legs between two nodes through the atlas (nothing is written). */
    plan: (from: string, to: string): Promise<RoutePlanDto | null> => ipcRenderer.invoke(IPC.routesPlan, from, to),
    /** Flows that would balance the network, as services on existing routes (nothing is written). */
    balance: (onlyRoutes?: string[]): Promise<BalanceSuggestionDto | null> => ipcRenderer.invoke(IPC.routesBalance, onlyRoutes)
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
