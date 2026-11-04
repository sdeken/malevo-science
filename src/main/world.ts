/**
 * The currently open world. All file access to world folders goes through
 * @malevo/model; this class only tracks which world is open and tells the
 * renderer when that changes.
 */
import { EventEmitter } from 'node:events'
import { randomInt } from 'node:crypto'
import { WorldError } from '@malevo/model'
import { createWorld, inspectFolder, openWorld, type OpenWorld } from '@malevo/model/node'
import type { FolderInfo, WorldInfo, WorldResult } from '../shared/types'

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
