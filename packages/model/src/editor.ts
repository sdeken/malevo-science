/**
 * Unsaved changes to a world (docs/PLAN.md §3.7).
 *
 * The editor keeps the files on disk and, on top of them, a set of pending
 * writes (a path's new text, or null to delete it). Everything the app shows
 * is read from disk-plus-pending, so an edit is visible everywhere at once
 * but nothing touches the disk until `save()`, which writes exactly the
 * pending files and nothing else. Each edit is one undo step; a pending write
 * that brings a file back to what is on disk simply disappears.
 */
import { isProsePath } from './prose'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { compareStrings } from '@malevo/core'
import { canonicalJson } from './canonical'
import { KINDS, entityPath, type KindDef } from './kinds'
import { readWorld, type WorldData, type WorldFile } from './load'
import { readWorldFiles, writeWorldFile } from './node'
import { isId, parseWith } from './schema'
import { WorldError } from './world'

export interface FileChange {
  path: string
  /** New text, or null to delete the file. */
  text: string | null
}

type Pending = Map<string, string | null>

export class WorldEditor {
  private disk = new Map<string, string | null>()
  private pending: Pending = new Map()
  private past: Pending[] = []
  private future: Pending[] = []
  private cached: WorldData | null = null

  constructor(
    readonly root: string,
    readonly kinds: readonly KindDef[] = KINDS
  ) {}

  /** Read the folder from disk. Pending changes that now match the disk are dropped. */
  async load(): Promise<void> {
    this.disk = new Map((await readWorldFiles(this.root)).map((f) => [f.path, f.text]))
    for (const [p, text] of [...this.pending]) if (this.matchesDisk(p, text)) this.pending.delete(p)
    this.cached = null
  }

  /** The world as the app sees it: disk plus pending changes. */
  world(): WorldData {
    this.cached ??= readWorld(this.files(), this.kinds)
    return this.cached
  }

  files(): WorldFile[] {
    const out = new Map<string, string | null>(this.disk)
    for (const [p, text] of this.pending) {
      if (text === null) out.delete(p)
      else out.set(p, text)
    }
    return [...out].map(([p, text]) => ({ path: p, text }))
  }

  /** Paths with unsaved changes, sorted. */
  get dirty(): string[] {
    return [...this.pending.keys()].sort(compareStrings)
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** The disk text of a path (null if absent or not a text file). */
  diskText(p: string): string | null {
    return this.disk.get(p) ?? null
  }

  /** Apply some file changes as one undoable step. Only paths that belong to the world format are accepted. */
  edit(changes: readonly FileChange[]): void {
    for (const c of changes) assertWorldPath(c.path, this.kinds)
    const before = new Map(this.pending)
    for (const c of changes) {
      if (this.matchesDisk(c.path, c.text)) this.pending.delete(c.path)
      else this.pending.set(c.path, c.text)
    }
    if (!samePending(before, this.pending)) {
      this.past.push(before)
      this.future = []
      this.cached = null
    }
  }

  /** Set an entity's value. Valid values are written canonically; invalid ones are kept as plain JSON so the checks can show what is wrong. */
  setEntity<T>(kind: KindDef<T>, id: string, value: T): void {
    this.edit([{ path: entityPath(kind as KindDef, id), text: entityText(kind, value) }])
  }

  undo(): void {
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.pending)
    this.pending = prev
    this.cached = null
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.pending)
    this.pending = next
    this.cached = null
  }

  discard(): void {
    if (this.pending.size === 0) return
    this.past.push(this.pending)
    this.future = []
    this.pending = new Map()
    this.cached = null
  }

  /** Write every pending change to disk, and only those. Returns the paths written or deleted. */
  async save(): Promise<string[]> {
    const done: string[] = []
    for (const [p, text] of [...this.pending].sort(([a], [b]) => compareStrings(a, b))) {
      if (text === null) await fs.rm(path.join(path.resolve(this.root), ...p.split('/')), { force: true })
      else await writeWorldFile(this.root, p, text)
      done.push(p)
    }
    this.pending = new Map()
    this.past = []
    this.future = []
    await this.load()
    return done
  }

  private matchesDisk(p: string, text: string | null): boolean {
    return text === null ? !this.disk.has(p) : this.disk.get(p) === text
  }
}

/** The text an entity value is saved as: canonical when it is valid, plain JSON otherwise. */
export function entityText<T>(kind: KindDef<T>, value: T): string {
  const parsed = parseWith(kind.schema, value)
  if (parsed.value !== undefined) return canonicalJson(kind.schema.toJson(parsed.value))
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Edits may only touch files the world format owns: an entity's .json, its .md note, or its .js script. */
export function assertWorldPath(p: string, kinds: readonly KindDef[]): void {
  if (kinds.some((k) => k.file === p)) return
  if (isProsePath(p, kinds)) return
  const m = /^([a-z]+)\/([^/]+)\.(json|md|js)$/.exec(p)
  const kind = m && kinds.find((k) => k.folder === m[1])
  if (!m || !kind || !isId(m[2]) || (m[3] === 'js' && !kind.scripts))
    throw new WorldError('io', `"${p}" is not a file the world format owns.`)
}

function samePending(a: Pending, b: Pending): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v || !b.has(k)) return false
  return true
}
