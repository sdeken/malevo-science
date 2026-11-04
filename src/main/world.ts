/**
 * The currently open world. All file access to world folders goes through
 * @malevo/model; this class only tracks which world is open and tells the
 * renderer when that changes.
 */
import { EventEmitter } from 'node:events'
import { randomInt } from 'node:crypto'
import { WorldError, canonicalFixes, runChecks } from '@malevo/model'
import { addMissingTemplateFiles, applyFixes, createWorld, inspectFolder, loadWorld, openWorld, type OpenWorld } from '@malevo/model/node'
import type { CheckReport, FolderInfo, WorldInfo, WorldResult } from '../shared/types'

export class WorldSession extends EventEmitter {
  private current: OpenWorld | null = null

  info(): WorldInfo | null {
    return this.current ? toInfo(this.current) : null
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

  /** Run every check on the open world. Reads only. */
  async check(): Promise<CheckReport | null> {
    if (!this.current) return null
    const world = await loadWorld(this.current.root)
    return { issues: runChecks(world), fixable: canonicalFixes(world).map((f) => f.path) }
  }

  /**
   * Rewrite the named files into canonical form, and only those: the renderer
   * has shown the list and the user has agreed. Files whose content changed
   * since the list was made are re-derived from what is on disk now.
   */
  async fix(paths: readonly string[]): Promise<string[]> {
    if (!this.current) return []
    const wanted = new Set(paths)
    const fixes = canonicalFixes(await loadWorld(this.current.root)).filter((f) => wanted.has(f.path))
    return applyFixes(this.current.root, fixes)
  }

  /** Copy any new-world template files the open world lacks; never touches existing files. */
  async addTemplate(): Promise<string[]> {
    return this.current ? addMissingTemplateFiles(this.current.root) : []
  }

  close(): void {
    if (!this.current) return
    this.current = null
    this.emit('changed', null)
  }

  private async attempt(load: () => Promise<OpenWorld>): Promise<WorldResult> {
    try {
      this.current = await load()
    } catch (err) {
      if (err instanceof WorldError) return { ok: false, code: err.code, message: err.message }
      return { ok: false, code: 'io', message: (err as Error).message ?? String(err) }
    }
    const info = toInfo(this.current)
    this.emit('changed', info)
    return { ok: true, world: info }
  }
}

function toInfo(w: OpenWorld): WorldInfo {
  return { root: w.root, format: w.manifest.format, name: w.manifest.name, seed: w.manifest.seed }
}
