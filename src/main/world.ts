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
import { calendarTicks, compareStrings, formatInstant, parseInstant, type Calendar } from '@malevo/core'
import {
  WorldError,
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
  worldCalendars,
  type KindDef,
  type ResolvedTime,
  type WorldData
} from '@malevo/model'
import {
  WorldEditor,
  addMissingTemplateFiles,
  applyFixes,
  createWorld,
  inspectFolder,
  loadWorld,
  nodeEnv,
  openWorld,
  type FileChange,
  type OpenWorld
} from '@malevo/model/node'
import type {
  CalendarInfo,
  CheckReport,
  CompareReport,
  EditableKind,
  EventInfo,
  FolderInfo,
  ParsedDate,
  TickInfo,
  TimeInfo,
  WorldInfo,
  WorldResult,
  WorldSnapshot
} from '../shared/types'

const KIND_DEFS: Record<EditableKind, KindDef> = {
  event: eventKind as KindDef,
  calendar: calendarKind as KindDef,
  physics: physicsKind as KindDef
}

export class WorldSession extends EventEmitter {
  private current: OpenWorld | null = null
  private editor: WorldEditor | null = null
  private version = 0

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
    const cal = worldCalendars(this.world(), nodeEnv).set.get(String(id))
    if (!cal) throw new WorldError('io', `There is no usable calendar "${id}".`)
    return cal
  }

  snapshot(): WorldSnapshot | null {
    if (!this.current || !this.editor) return null
    const world = this.editor.world()
    const cals = worldCalendars(world, nodeEnv)
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
    const resolved = resolveEvents(world, cals)
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
    const issues = runChecks(world, nodeEnv)
    const count = (s: string): number => issues.filter((i) => i.severity === s).length
    return {
      version: this.version,
      world: toInfo(this.current),
      dirty: this.editor.dirty,
      canUndo: this.editor.canUndo,
      canRedo: this.editor.canRedo,
      calendars,
      events,
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
    return { issues: runChecks(world, nodeEnv), fixable: canonicalFixes(world).map((f) => f.path) }
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
    const def = KIND_DEFS[kind]
    if (!def?.folder) throw new WorldError('io', `"${kind}" entities cannot be deleted.`)
    const base = entityPath(def, String(id)).replace(/\.json$/, '')
    const files = this.editor!.files().map((f) => f.path)
    const changes: FileChange[] = [`${base}.json`, `${base}.md`, `${base}.js`]
      .filter((p) => files.includes(p))
      .map((p) => ({ path: p, text: null }))
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
    const rHere = resolveEvents(here, worldCalendars(here, nodeEnv))
    const rThere = resolveEvents(other, worldCalendars(other, nodeEnv))
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
