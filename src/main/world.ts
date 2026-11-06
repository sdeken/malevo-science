/**
 * The open world and its unsaved changes. All file access to world folders
 * goes through @malevo/model. Unsaved edits live here, in a WorldEditor, as
 * pending file writes on top of the files on disk; the renderer only ever
 * sees snapshots, and nothing reaches the disk until save().
 *
 * All calendar work (formatting, parsing, timeline ticks) is done here too,
 * because script calendars run in a Node vm sandbox that the renderer cannot
 * host. One code path serves built-in and script calendars alike.
 */
import { EventEmitter } from 'node:events'
import { randomInt } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  calendarTicks,
  compareStrings,
  allowedImbalance,
  formatInstant,
  parseInstant,
  starDistance,
  starPhysics,
  type Calendar,
  type StarRecord
} from '@malevo/core'
import { planets, runGenerator } from '@malevo/gen'
import {
  WorldError,
  bodyKind,
  cultureKind,
  cultureSettingsKind,
  polityKind,
  relationKind,
  nebulaKind,
  routeKind,
  stationKind,
  allRoutes,
  balanceTolerance,
  nodePath,
  planRoute,
  routeWorld,
  suggestBalancing,
  trafficReport,
  viewpointKind,
  skyStars,
  skyScene,
  approachInfo,
  approachMap,
  approachSeries,
  meridianForNoon,
  historySettingsKind,
  proposeHistory,
  solarSystemFor,
  planTrip,
  sizeShipForTrip,
  shipKind,
  knownPlanetsFor,
  terrainKind,
  terrainRaster,
  cityKind,
  cityInfos,
  conditionsAt,
  cityPlanKind,
  planGeometry,
  cityTravel,
  portCapacity,
  type CityPlanFile,
  newsArrival,
  KINDS,
  type HistoryProposal,
  systemHistory,
  whenResolver,
  calendarKind,
  canonicalFixes,
  compareWorlds,
  entitiesOf,
  entityPath,
  eventKind,
  physicsKind,
  precisionFromText,
  resolveEvents,
  runChecks,
  serializeWorldManifest,
  systemInfo,
  systemKind,
  worldCalendars,
  worldStars,
  type BodyInfo,
  type CultureSettings,
  type KindDef,
  type SystemFile,
  type BodyFile,
  type WhenResolver,
  type PhysicsSettings,
  type SystemInfo,
  type WorldEnv,
  type ResolvedTime,
  type WorldData
} from '@malevo/model'
import {
  WorldEditor,
  addMissingTemplateFiles,
  applyFixes,
  createWorld,
  inspectFolder,
  entityText,
  loadWorld,
  openWorld,
  type FileChange,
  type OpenWorld
} from '@malevo/model/node'
import type {
  BodyInfoDto,
  EntityDto,
  CalendarInfo,
  CheckReport,
  CompareReport,
  EditableKind,
  EventInfo,
  FolderInfo,
  ParsedDate,
  PlanetProposal,
  BalanceSuggestionDto,
  RouteInfoDto,
  RouteNodeDto,
  RoutePlanDto,
  TrafficDto,
  ApproachInfoDto,
  ApproachMapDto,
  ApproachQueryDto,
  ApproachSeriesDto,
  SkySceneDto,
  SkyStarsDto,
  ViewpointDto,
  HistoryProposalDto,
  NewsDto,
  TerrainRasterDto,
  ConditionsDto,
  PlanGeometryDto,
  TravelDto,
  PortCapacityDto,
  TripPlanDto,
  TripQueryDto,
  StarField,
  StarInfoDto,
  StarSearchHit,
  SystemInfoDto,
  TickInfo,
  TimeInfo,
  WorldInfo,
  WorldResult,
  WorldSnapshot
} from '../shared/types'

const KIND_DEFS: Record<EditableKind, KindDef> = {
  event: eventKind as KindDef,
  calendar: calendarKind as KindDef,
  physics: physicsKind as KindDef,
  system: systemKind as KindDef,
  body: bodyKind as KindDef,
  culture: cultureKind as KindDef,
  polity: polityKind as KindDef,
  relation: relationKind as KindDef,
  cultureSettings: cultureSettingsKind as KindDef,
  station: stationKind as KindDef,
  nebula: nebulaKind as KindDef,
  route: routeKind as KindDef,
  viewpoint: viewpointKind as KindDef,
  historySettings: historySettingsKind as KindDef,
  terrain: terrainKind as KindDef,
  city: cityKind as KindDef,
  cityPlan: cityPlanKind as KindDef,
  ship: shipKind as KindDef
}

export class WorldSession extends EventEmitter {
  private current: OpenWorld | null = null
  private editor: WorldEditor | null = null
  private version = 0

  /** Script sandbox and star catalogue (see index.ts). */
  constructor(private readonly env: WorldEnv) {
    super()
  }

  info(): WorldInfo | null {
    return this.current ? toInfo(this.current) : null
  }

  /** Unsaved changes exist. */
  get dirty(): boolean {
    return (this.editor?.dirty.length ?? 0) > 0
  }

  async inspect(dir: string): Promise<FolderInfo> {
    const found = await inspectFolder(dir)
    switch (found.kind) {
      case 'world':
        return { kind: 'world', name: found.manifest.name }
      case 'invalid':
        return { kind: 'invalid', code: found.error.code, message: found.error.message }
      default:
        return { kind: found.kind }
    }
  }

  async open(dir: string): Promise<WorldResult> {
    return this.attempt(() => openWorld(dir))
  }

  async create(dir: string, name: string): Promise<WorldResult> {
    // The world seed is the root of all procedural generation. It is drawn
    // once, here, and never changes (docs/PLAN.md §3.2).
    const seed = randomInt(0, 2 ** 32)
    return this.attempt(() => createWorld(dir, name, seed))
  }

  close(): void {
    if (!this.current) return
    this.current = null
    this.editor = null
    this.emit('changed', null)
  }

  // ---- reading ----

  private world(): WorldData {
    if (!this.editor) throw new WorldError('io', 'No world is open.')
    return this.editor.world()
  }

  private calendar(id: string): Calendar {
    const cal = worldCalendars(this.world(), this.env).set.get(String(id))
    if (!cal) throw new WorldError('io', `There is no usable calendar "${id}".`)
    return cal
  }

  snapshot(): WorldSnapshot | null {
    if (!this.current || !this.editor) return null
    const world = this.editor.world()
    const cals = worldCalendars(world, this.env)
    const calendars: CalendarInfo[] = [...world.entities.values()]
      .filter((e) => e.kind.kind === calendarKind.kind)
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((e) => {
        const built = cals.set.get(e.id)
        const value = e.value as { name?: string; kind?: string } | undefined
        return {
          id: e.id,
          path: e.path,
          name: value?.name ?? e.id,
          kind: value?.kind ?? '?',
          units: built ? built.units.map((u) => ({ name: u.name, time: u.time })) : [],
          error: built
            ? null
            : (cals.errors.get(e.id) ?? (e.value === undefined ? 'The file has errors; see Checks.' : 'Cannot be built.')),
          value: e.value ?? null,
          script: world.scripts.get(`${calendarKind.folder}/${e.id}.js`) ?? null
        }
      })
    const resolver = whenResolver(world, cals)
    const resolved = resolver.events()
    const events: EventInfo[] = [...world.entities.values()]
      .filter((e) => e.kind.kind === eventKind.kind)
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((e) => {
        const r = resolved.get(e.id)
        return {
          id: e.id,
          path: e.path,
          value: (e.value as EventInfo['value']) ?? null,
          start: r?.start ? timeInfo(r.start) : null,
          end: r?.end ? timeInfo(r.end) : null,
          errors: r ? r.errors : ['The file has errors; see Checks.'],
          warnings: r?.warnings ?? []
        }
      })
    const systems: SystemInfoDto[] = [...world.entities.values()]
      .filter((e) => e.kind.kind === systemKind.kind && e.value !== undefined)
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((e) => systemDto(systemInfo(world, this.env, e.id)!, e.path, resolver))
    const physicsFile = world.entities.get(physicsKind.kind)?.value as PhysicsSettings | undefined
    const { routes, nodes, traffic } = routesDto(world, this.env, physicsFile)
    const issues = runChecks(world, this.env)
    const count = (s: string): number => issues.filter((i) => i.severity === s).length
    return {
      version: this.version,
      world: toInfo(this.current),
      dirty: this.editor.dirty,
      canUndo: this.editor.canUndo,
      canRedo: this.editor.canRedo,
      calendars,
      events,
      systems,
      cultures: entityDtos(world, cultureKind.kind),
      polities: entityDtos(world, polityKind.kind),
      relations: entityDtos(world, relationKind.kind),
      cultureSettings: (world.entities.get(cultureSettingsKind.kind)?.value as CultureSettings | undefined) ?? null,
      stations: entityDtos(world, stationKind.kind),
      nebulae: entityDtos(world, nebulaKind.kind),
      routes,
      nodes,
      traffic,
      viewpoints: entityDtos(world, viewpointKind.kind),
      historySettings: (world.entities.get(historySettingsKind.kind)?.value as Record<string, unknown> | undefined) ?? null,
      physicsSettings: (world.entities.get(physicsKind.kind)?.value as Record<string, unknown> | undefined) ?? null,
      terrains: entityDtos(world, terrainKind.kind),
      cities: cityInfos(world, this.env)
        .sort((a, b) => compareStrings(a.id, b.id))
        .map((c) => ({
          id: c.id,
          path: `${cityKind.folder}/${c.id}.json`,
          value: c.file as unknown as Record<string, unknown>,
          founded: c.founded,
          population: c.population,
          errors: c.errors
        })),
      cityPlans: entityDtos(world, cityPlanKind.kind),
      ships: entityDtos(world, shipKind.kind),
      physics: physicsFile
        ? {
            legLimit_ly: physicsFile.foam.legLimit_ly,
            topSpeed_c: physicsFile.foam.topSpeed_c,
            collapseRadius_au: physicsFile.foam.collapseRadius_au,
            loadRule: physicsFile.foam.loadRule,
            torch: {
              exhaustSpeed_c: physicsFile.torch.exhaustSpeed_c,
              propellantFraction: physicsFile.torch.propellantFraction,
              cruiseAccel_g: physicsFile.torch.cruiseAccel_g
            }
          }
        : null,
      issueCounts: { error: count('error'), warning: count('warning'), info: count('info') }
    }
  }

  ticks(calId: string, t0: number, t1: number, target: number): TickInfo[] {
    try {
      return calendarTicks(this.calendar(calId), Number(t0), Number(t1), Math.max(2, Math.min(60, Number(target) || 10))).ticks
    } catch {
      return []
    }
  }

  format(calId: string, items: { t: number; precision?: string | null }[]): (string | null)[] {
    let cal: Calendar
    try {
      cal = this.calendar(calId)
    } catch {
      return items.map(() => null)
    }
    return items.map((it) => {
      try {
        return formatInstant(cal, Number(it.t), it.precision ?? undefined)
      } catch {
        return null
      }
    })
  }

  parse(calId: string, text: string): ParsedDate | null {
    try {
      const cal = this.calendar(calId)
      const t = parseInstant(cal, String(text))
      return t === null ? null : { t, precision: precisionFromText(cal, t, String(text)) }
    } catch {
      return null
    }
  }

  async check(): Promise<CheckReport | null> {
    if (!this.editor) return null
    // Checks report on what is on disk, which is what a commit would hold.
    const world = await loadWorld(this.editor.root)
    return { issues: runChecks(world, this.env), fixable: canonicalFixes(world).map((f) => f.path) }
  }

  // ---- stars ----

  /** Catalogue and generated stars within `radius` ly of `center`, packed for drawing. */
  starsNear(center: [number, number, number], radius: number, includeGenerated: boolean): StarField {
    const stars = worldStars(this.world(), this.env)
    const found = stars.near(center, Math.min(Math.max(radius, 1), 400)).filter((s) => includeGenerated || !s.generated)
    const n = found.length
    const out: StarField = {
      ids: new Array(n),
      pos: new Float32Array(n * 3),
      absmag: new Float32Array(n),
      ci: new Float32Array(n),
      names: {},
      generated: new Uint8Array(n)
    }
    found.forEach((s, i) => {
      out.ids[i] = s.id
      out.pos.set(s.pos, i * 3)
      out.absmag[i] = s.absmag
      out.ci[i] = s.ci
      out.generated[i] = s.generated ? 1 : 0
      if (s.name) out.names[i] = s.name
    })
    return out
  }

  star(id: string): StarInfoDto | null {
    const rec = worldStars(this.world(), this.env).get(String(id))
    return rec ? starDto(rec, starPhysics(rec), []) : null
  }

  /** Stars by name (catalogue names and the names of systems on them), nearest to Sol first. */
  searchStars(text: string, limit = 20): StarSearchHit[] {
    const q = String(text).trim().toLowerCase()
    if (!q) return []
    const world = this.world()
    const stars = worldStars(world, this.env)
    const hits = new Map<string, StarSearchHit>()
    const sol = stars.get('hyg.0')
    const dist = (r: StarRecord): number => (sol ? starDistance(sol, r) : Math.hypot(...r.pos))
    for (const e of world.entities.values()) {
      if (e.kind.kind !== systemKind.kind || e.value === undefined) continue
      const v = e.value as { name: string; star: string }
      const rec = stars.get(v.star)
      if (rec && (v.name.toLowerCase().includes(q) || e.id.includes(q)))
        hits.set(rec.id, { id: rec.id, name: v.name, system: e.id, distance: dist(rec) })
    }
    for (const r of this.env.catalog?.stars ?? []) {
      if (hits.size >= limit * 4) break
      if (r.name?.toLowerCase().includes(q) || r.id === q)
        if (!hits.has(r.id)) hits.set(r.id, { id: r.id, name: r.name ?? r.id, system: null, distance: dist(r) })
    }
    const direct = stars.get(q)
    if (direct && !hits.has(direct.id))
      hits.set(direct.id, { id: direct.id, name: direct.name ?? direct.id, system: null, distance: dist(direct) })
    return [...hits.values()]
      .sort((a, b) => Number(b.system !== null) - Number(a.system !== null) || a.distance - b.distance)
      .slice(0, limit)
  }

  // ---- planets@1: roll, then keep ----

  roll(systemId: string, roll: number): PlanetProposal {
    const world = this.world()
    const sys = systemInfo(world, this.env, String(systemId))
    if (!sys?.star) throw new WorldError('io', sys?.starError ?? `There is no system "${systemId}".`)
    const p = sys.star.physics
    if (p.mass === null) throw new WorldError('io', "The star's mass is unknown; give it one in the star overrides first.")
    const input = {
      system: sys.id,
      systemName: sys.file.name,
      star: { mass_msun: p.mass, luminosity_lsun: p.luminosity, cls: sys.star.record.cls },
      roll: Math.max(0, Math.trunc(roll))
    }
    const out = runGenerator(planets, input, world.manifest!.seed)
    // Bodies the system keeps whatever the roll (anything not from planets@): a rolled planet whose orbit crosses
    // one of theirs is left out, as the crossing-orbits check would flag it.
    const AU_KM = 1.495978707e8
    const band = (o: { a_au?: number; a_km?: number; e: number }): [number, number] | null => {
      const a = o.a_au ?? (o.a_km !== undefined ? o.a_km / AU_KM : null)
      return a === null ? null : [a * (1 - o.e), a * (1 + o.e)]
    }
    const fixed: { name: string; band: [number, number] }[] = []
    for (const e of world.entities.values()) {
      if (e.kind.kind !== bodyKind.kind || e.value === undefined) continue
      const v = e.value as BodyFile
      if (v.system !== sys.id || v.parent || v.lock?.gen?.startsWith('planets@') || v.class === 'belt' || v.class === 'dwarf') continue
      const bd = band(v.orbit)
      if (bd) fixed.push({ name: v.name, band: bd })
    }
    const clashes: { id: string; with: string }[] = []
    for (const b of out.bodies) {
      const bd = band(b.value.orbit)
      const hit = bd && fixed.find((f) => Math.max(f.band[0], bd[0]) <= Math.min(f.band[1], bd[1]))
      if (hit) clashes.push({ id: b.id, with: hit.name })
    }
    return {
      roll: input.roll,
      bodies: out.bodies.map((b) => ({ id: b.id, value: b.value as unknown as Record<string, unknown> })),
      clashes
    }
  }

  /** Keep a roll: write its bodies, replacing bodies kept from an earlier roll of planets@1. One undoable, unsaved step. */
  keep(systemId: string, roll: number): string[] {
    const world = this.world()
    const proposal = this.roll(systemId, roll)
    const changes: FileChange[] = []
    const left = new Set(proposal.clashes.map((c) => c.id))
    proposal.bodies = proposal.bodies.filter((b) => !left.has(b.id))
    const newIds = new Set(proposal.bodies.map((b) => b.id))
    for (const e of world.entities.values()) {
      if (e.kind.kind !== bodyKind.kind || e.value === undefined) continue
      const v = e.value as { system: string; lock?: { gen: string } }
      if (v.system === systemId && v.lock?.gen?.startsWith('planets@') && !newIds.has(e.id)) changes.push({ path: e.path, text: null })
    }
    for (const b of proposal.bodies)
      changes.push({ path: entityPath(bodyKind as KindDef, b.id), text: entityText(bodyKind as KindDef, b.value) })
    this.editor!.edit(changes)
    this.changed()
    return proposal.bodies.map((b) => b.id)
  }

  // ---- routes ----

  planRoute(from: string, to: string): RoutePlanDto | null {
    const plan = planRoute(this.world(), this.env, from, to)
    return plan ? { waypoints: plan.waypoints as Record<string, string>[], duration: plan.duration, ly: plan.ly } : null
  }

  balance(onlyRoutes?: readonly string[]): BalanceSuggestionDto | null {
    const p = suggestBalancing(this.world(), this.env, onlyRoutes)
    return p ? { suggestions: p.suggestions, cost: p.cost, remaining: p.remaining } : null
  }

  // ---- sky and approach ----

  skyStars(systemId: string): SkyStarsDto | null {
    return skyStars(this.world(), this.env, systemId)
  }

  skyScene(vp: ViewpointDto, t: number): SkySceneDto | { error: string } {
    return skyScene(this.world(), this.env, vp, t) as SkySceneDto | { error: string }
  }

  skyNoon(body: string, lon: number, t: number): number | null {
    return meridianForNoon(this.world(), this.env, body, lon, t)
  }

  /** Add the real Solar System (or what of it is missing): one undoable, unsaved step. Returns the system's id. */
  addSolarSystem(): string | null {
    const files = solarSystemFor(this.world())
    if (!files.length) return null
    this.editor!.edit(files.map((f) => ({ path: f.path, text: entityText(f.kind, f.value) })))
    this.changed()
    const sys = files.find((f) => f.kind.kind === systemKind.kind)
    return sys?.id ?? (files[0].value as { system?: string }).system ?? null
  }

  /** Add a system's known planets (from published data) that it lacks: one undoable, unsaved step. Returns their ids. */
  addKnownPlanets(systemId: string, candidates: boolean): string[] {
    const files = knownPlanetsFor(this.world(), systemId, { candidates })
    if (!files.length) return []
    this.editor!.edit(files.map((f) => ({ path: f.path, text: entityText(f.kind, f.value) })))
    this.changed()
    return files.map((f) => f.id)
  }

  // ---- terrain: rasters are derived, cached here, never written to the world ----

  private rasters = new Map<string, TerrainRasterDto | { error: string }>()

  terrainRaster(body: string, width: number, height: number): TerrainRasterDto | { error: string } {
    const key = `${this.version}|${body}|${width}x${height}`
    const hit = this.rasters.get(key)
    if (hit) return hit
    const r = terrainRaster(this.world(), this.env, body, width, height)
    for (const k of [...this.rasters.keys()]) if (!k.startsWith(`${this.version}|`)) this.rasters.delete(k)
    if (this.rasters.size > 12) this.rasters.clear()
    this.rasters.set(key, r)
    return r
  }

  planGeometry(planId: string): PlanGeometryDto | null {
    return planGeometry(this.world(), planId) as PlanGeometryDto | null
  }

  planTravel(
    planId: string,
    from: [number, number],
    to: [number, number] | 'orbit',
    depart: number,
    hour_s: number
  ): TravelDto | { error: string } {
    const f = this.world().entities.get(`${cityPlanKind.kind}/${planId}`)?.value as CityPlanFile | undefined
    if (!f) return { error: `There is no plan "${planId}".` }
    return cityTravel(f, from, to, depart, hour_s) as TravelDto | { error: string }
  }

  planTrip(q: TripQueryDto): TripPlanDto | { error: string } {
    return planTrip(this.world(), this.env, q)
  }

  sizeShip(q: TripQueryDto): { propellant_t: number; thrust_MN: number; hardest: string } | { error: string } {
    return sizeShipForTrip(this.world(), this.env, q)
  }

  planPort(planId: string): PortCapacityDto | null {
    const f = this.world().entities.get(`${cityPlanKind.kind}/${planId}`)?.value as CityPlanFile | undefined
    return f ? portCapacity(this.world(), this.env, f) : null
  }

  cityConditions(id: string, t: number): ConditionsDto | { error: string } {
    return conditionsAt(this.world(), this.env, id, t)
  }

  // ---- history ----

  private lastProposal: { version: number; proposal: HistoryProposal } | null = null

  historyPropose(seed?: number): HistoryProposalDto | { error: string } {
    const p = proposeHistory(this.world(), this.env, seed)
    if ('error' in p) return p
    this.lastProposal = { version: this.version, proposal: p }
    return p
  }

  /** Accept pieces of the last proposal: one undoable, unsaved step. */
  historyAccept(keys: readonly string[]): number {
    const last = this.lastProposal
    if (!last) throw new WorldError('io', 'Run the history first.')
    if (last.version !== this.version) throw new WorldError('io', 'The world has changed since the run. Run it again before accepting.')
    const want = new Set(keys)
    const changes: FileChange[] = []
    for (const f of last.proposal.files) {
      if (!want.has(f.key)) continue
      const kind = KINDS.find((k) => k.kind === f.kind)
      if (kind) changes.push({ path: f.path, text: entityText(kind, f.value) })
    }
    if (!changes.length) return 0
    this.editor!.edit(changes)
    this.changed()
    // Accepted pieces are now fixed points; the rest of the proposal is out of date.
    this.lastProposal = null
    return changes.length
  }

  historyNews(eventId: string): NewsDto | { error: string } {
    return newsArrival(this.world(), this.env, eventId)
  }

  approachInfo(q: ApproachQueryDto): ApproachInfoDto | { error: string } {
    return approachInfo(this.world(), this.env, q) as ApproachInfoDto | { error: string }
  }

  approachMap(q: ApproachQueryDto, extent: number, n: number): ApproachMapDto | { error: string } {
    return approachMap(this.world(), this.env, q, extent, n)
  }

  approachSeries(q: ApproachQueryDto, t0: number, t1: number, n: number): ApproachSeriesDto | { error: string } {
    return approachSeries(this.world(), this.env, q, t0, t1, n)
  }

  // ---- editing (unsaved until save) ----

  setEntity(kind: EditableKind, id: string, value: unknown): void {
    const def = KIND_DEFS[kind]
    if (!def) throw new WorldError('io', `"${kind}" cannot be edited here.`)
    this.editor!.setEntity(def, def.file ? def.kind : String(id), value)
    this.changed()
  }

  /** Delete an entity and the note and script beside it. */
  deleteEntity(kind: EditableKind, id: string): void {
    this.deleteEntities([{ kind, id }])
  }

  /** Delete several entities (with their notes and scripts) as one undoable step. */
  deleteEntities(items: readonly { kind: EditableKind; id: string }[]): void {
    const files = new Set(this.editor!.files().map((f) => f.path))
    const changes: FileChange[] = []
    for (const { kind, id } of items) {
      const def = KIND_DEFS[kind]
      if (!def?.folder) throw new WorldError('io', `"${kind}" entities cannot be deleted.`)
      const base = entityPath(def, String(id)).replace(/\.json$/, '')
      for (const p of [`${base}.json`, `${base}.md`, `${base}.js`]) if (files.has(p)) changes.push({ path: p, text: null })
    }
    this.editor!.edit(changes)
    this.changed()
  }

  /** Set (or with null, remove) a script calendar's code. */
  setScript(id: string, code: string | null): void {
    this.editor!.edit([{ path: `${calendarKind.folder}/${String(id)}.js`, text: code === null ? null : String(code) }])
    this.changed()
  }

  undo(): void {
    this.editor?.undo()
    this.changed()
  }

  redo(): void {
    this.editor?.redo()
    this.changed()
  }

  discard(): void {
    this.editor?.discard()
    this.changed()
  }

  async save(): Promise<string[]> {
    if (!this.editor) return []
    const written = await this.editor.save()
    this.changed()
    return written
  }

  /** Re-read the folder (it may have been edited outside the app). Unsaved changes stay on top. */
  async reload(): Promise<void> {
    if (!this.editor) return
    await this.editor.load()
    this.changed()
  }

  // ---- checks fixes, template (write straight to disk, on explicit request) ----

  async fix(paths: readonly string[]): Promise<string[]> {
    if (!this.editor) return []
    const wanted = new Set(paths)
    const fixes = canonicalFixes(await loadWorld(this.editor.root)).filter((f) => wanted.has(f.path))
    const done = await applyFixes(this.editor.root, fixes)
    await this.reload()
    return done
  }

  async addTemplate(): Promise<string[]> {
    if (!this.editor) return []
    const added = await addMissingTemplateFiles(this.editor.root)
    await this.reload()
    return added
  }

  // ---- fork and compare (docs/PLAN.md §3.6) ----

  /** Copy the saved world into an empty folder, named "<name> (fork)". Unsaved changes are not copied. */
  async fork(dest: string): Promise<WorldResult> {
    if (!this.current) return { ok: false, code: 'io', message: 'No world is open.' }
    const source = this.current.root
    const target = path.resolve(dest)
    const rel = path.relative(source, target)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return { ok: false, code: 'io', message: 'A fork cannot go inside the world it is a fork of.' }
    }
    const found = await inspectFolder(target)
    if (found.kind !== 'empty' && found.kind !== 'missing') {
      return { ok: false, code: 'not-empty', message: `${target} is not empty. Choose an empty folder for the fork.` }
    }
    await fs.cp(source, target, { recursive: true, filter: (src) => src === source || !path.basename(src).startsWith('.') })
    const manifest = { ...this.current.manifest, name: `${this.current.manifest.name} (fork)` }
    await fs.writeFile(path.join(target, 'world.json'), serializeWorldManifest(manifest), 'utf8')
    const forked = await openWorld(target)
    return { ok: true, world: toInfo(forked) }
  }

  /** How another world differs from this one (including this one's unsaved changes). */
  async compare(otherDir: string): Promise<CompareReport> {
    const other = await loadWorld(path.resolve(otherDir))
    if (!other.manifest) throw new WorldError('not-a-world', `${otherDir} is not a world folder.`)
    const here = this.world()
    const cmp = compareWorlds(here, other)
    const nameOf = (value: unknown, fallback: string): string =>
      value && typeof value === 'object' && 'name' in value ? String((value as { name: unknown }).name) : fallback
    const entry = (e: { key: string; path: string; kind: KindDef; id: string; value: unknown }): CompareReport['added'][number] => ({
      key: e.key,
      path: e.path,
      label: e.kind.label,
      name: nameOf(e.value, e.id)
    })
    const rHere = resolveEvents(here, worldCalendars(here, this.env))
    const rThere = resolveEvents(other, worldCalendars(other, this.env))
    const timeChanges: CompareReport['timeChanges'] = []
    for (const e of entitiesOf(here, eventKind)) {
      const a = rHere.get(e.id)
      const b = rThere.get(e.id)
      if (!a || !b) continue
      const same = (x: ResolvedTime | null, y: ResolvedTime | null): boolean => (x?.t ?? null) === (y?.t ?? null)
      if (!same(a.start, b.start) || !same(a.end, b.end)) {
        timeChanges.push({
          id: e.id,
          name: e.value.name,
          startHere: a.start?.t ?? null,
          startThere: b.start?.t ?? null,
          endHere: a.end?.t ?? null,
          endThere: b.end?.t ?? null
        })
      }
    }
    return {
      otherRoot: path.resolve(otherDir),
      otherName: other.manifest.name,
      added: cmp.added.map(entry),
      removed: cmp.removed.map(entry),
      changed: cmp.changed.map((c) => ({ ...entry(here.entities.get(c.key)!), fields: c.fields })),
      unreadable: cmp.unreadable,
      timeChanges
    }
  }

  /**
   * Take entities as they are in another world: copy their files (and a
   * script calendar's code) or, for entities the other world lacks, delete
   * them here. One undoable, unsaved step.
   */
  async take(otherDir: string, keys: readonly string[]): Promise<void> {
    const other = await loadWorld(path.resolve(otherDir))
    const here = this.world()
    const changes: FileChange[] = []
    for (const key of keys.map(String)) {
      const theirs = other.entities.get(key)
      const ours = here.entities.get(key)
      const entity = theirs ?? ours
      if (!entity) continue
      const json = entity.path
      const js = json.replace(/\.json$/, '.js')
      changes.push({ path: json, text: theirs ? theirs.text : null })
      const theirScript = theirs ? (other.scripts.get(js) ?? null) : null
      if (theirScript !== null || here.scripts.has(js)) changes.push({ path: js, text: theirScript })
    }
    this.editor!.edit(changes)
    this.changed()
  }

  // ---- internals ----

  private changed(): void {
    this.version++
    this.emit('snapshot')
  }

  private async attempt(load: () => Promise<OpenWorld>): Promise<WorldResult> {
    let opened: OpenWorld
    let editor: WorldEditor
    try {
      opened = await load()
      editor = new WorldEditor(opened.root)
      await editor.load()
    } catch (err) {
      if (err instanceof WorldError) return { ok: false, code: err.code, message: err.message }
      return { ok: false, code: 'io', message: (err as Error).message ?? String(err) }
    }
    this.current = opened
    this.editor = editor
    this.version++
    const info = toInfo(opened)
    this.emit('changed', info)
    this.emit('snapshot')
    return { ok: true, world: info }
  }
}

function toInfo(w: OpenWorld): WorldInfo {
  return { root: w.root, format: w.manifest.format, name: w.manifest.name, seed: w.manifest.seed }
}

function timeInfo(r: ResolvedTime): TimeInfo {
  return { t: r.t, cal: r.cal, precision: r.precision, circa: r.circa, range: r.range }
}

function starDto(
  rec: StarRecord,
  p: { teff: number; luminosity: number; radius: number; mass: number | null; massSource: string },
  overridden: string[]
): StarInfoDto {
  return {
    id: rec.id,
    name: rec.name,
    spect: rec.spect,
    absmag: rec.absmag,
    mag: rec.mag,
    ci: rec.ci,
    pos: [rec.pos[0], rec.pos[1], rec.pos[2]],
    generated: rec.generated,
    teff: p.teff,
    luminosity: p.luminosity,
    radius: p.radius,
    mass: p.mass,
    massSource: p.massSource,
    overridden
  }
}

function bodyDto(b: BodyInfo): BodyInfoDto {
  const lock = (b.file as { lock?: { gen?: string } }).lock
  return {
    id: b.id,
    path: `bodies/${b.id}.json`,
    name: b.name,
    cls: b.cls,
    parent: b.parent,
    depth: b.depth,
    value: b.file as unknown as Record<string, unknown>,
    error: b.error,
    elements: b.elements,
    mass: b.mass,
    radius: b.radius,
    tilt: b.tilt,
    rotation: b.rotation,
    period: b.period,
    year: b.year,
    solarDay: b.solarDay,
    hill: b.hill,
    collapse: b.collapse,
    surfaceGravity: b.surfaceGravity,
    escapeVelocity: b.escapeVelocity,
    density: b.density,
    insolation: b.insolation,
    equilibriumTemp: b.equilibriumTemp,
    generatedBy: lock?.gen ?? null
  }
}

function entityDtos(world: WorldData, kind: string): EntityDto[] {
  return [...world.entities.values()]
    .filter((e) => e.kind.kind === kind)
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((e) => ({ id: e.id, path: e.path, value: (e.value as Record<string, unknown> | undefined) ?? null }))
}

function systemDto(sys: SystemInfo, path: string, resolver: WhenResolver): SystemInfoDto {
  return {
    id: sys.id,
    path,
    name: sys.file.name,
    starId: sys.file.star,
    value: sys.file as unknown as Record<string, unknown>,
    star: sys.star ? starDto(sys.star.record, sys.star.physics, sys.star.overridden) : null,
    starError: sys.starError,
    habitableZone: sys.habitableZone ? [sys.habitableZone.inner, sys.habitableZone.outer] : null,
    collapse: sys.collapse,
    bodies: sys.bodies.map(bodyDto),
    history: systemHistory(sys.file as SystemFile, resolver)
  }
}

function routesDto(
  world: WorldData,
  env: WorldEnv,
  physics: PhysicsSettings | undefined
): { routes: RouteInfoDto[]; nodes: Record<string, RouteNodeDto>; traffic: TrafficDto | null } {
  const rw = routeWorld(world, env)
  const nodes: Record<string, RouteNodeDto> = {}
  const add = (id: string | null): void => {
    if (!id || nodes[id]) return
    const n = rw.node(id)
    nodes[id] = { ...n, pos: n.pos ? [n.pos[0], n.pos[1], n.pos[2]] : null, path: nodePath(id) }
  }
  for (const e of entitiesOf(world, systemKind)) add(`system:${e.id}`)
  for (const e of entitiesOf(world, stationKind)) add(`station:${e.id}`)
  const routes: RouteInfoDto[] = allRoutes(world, env).map((r) => {
    r.nodes.forEach(add)
    for (const s of r.services) s.stops.forEach(add)
    return {
      id: r.id,
      path: `${routeKind.folder}/${r.id}.json`,
      value: r.file as unknown as Record<string, unknown>,
      name: r.file.name,
      color: r.file.color ?? null,
      nodes: r.nodes,
      legs: r.legs,
      services: r.services.map((s) => ({ ...s, note: s.note ?? null })),
      length: r.length
    }
  })
  const t = physics ? trafficReport(world, env) : null
  const tol = physics ? balanceTolerance(physics) : null
  const traffic: TrafficDto | null =
    t && tol
      ? {
          nodes: t.nodes.map((b) => {
            add(b.node)
            const allowed = allowedImbalance(b, tol)
            return { ...b, allowed, unbalanced: Math.abs(b.imbalance) > allowed }
          }),
          declaredTotal: t.declaredTotal,
          fleet: t.fleet,
          unknownDurations: t.unknownDurations,
          inTransit: t.inTransit
        }
      : null
  return { routes, nodes, traffic }
}
