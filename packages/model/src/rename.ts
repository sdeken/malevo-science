/**
 * Giving an entity a new id: its files move to the new name, and every
 * reference to it elsewhere in the world is rewritten. One undoable edit.
 *
 * Ids are what files are named after, so a placeholder id ("sol-8") would
 * otherwise outlive the placeholder name. A file named after the same id
 * that belongs to the renamed entity (a body's terrain, a city's plan) moves
 * with it.
 */
import type { FileChange } from './editor'
import { entityText } from './editor'
import { entityPath, type KindDef } from './kinds'
import type { WorldData } from './load'
import { isId } from './schema'

export interface RenamePlan {
  changes: FileChange[]
  /** Entities whose references were rewritten, as "kind/id". */
  updated: string[]
  /** Entities that could not be updated (their files have errors); the checks will show the dangling references. */
  skipped: string[]
}

/** Split "a.b[2].c" into ["a", "b", 2, "c"]. */
export function fieldPath(field: string): (string | number)[] {
  const out: (string | number)[] = []
  for (const m of field.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1])
  return out
}

function setAt(root: unknown, at: (string | number)[], v: string): boolean {
  let cur = root as Record<string | number, unknown>
  for (let i = 0; i < at.length - 1; i++) {
    const next = cur?.[at[i]]
    if (typeof next !== 'object' || next === null) return false
    cur = next as Record<string | number, unknown>
  }
  const last = at[at.length - 1]
  if (cur === null || typeof cur !== 'object') return false
  cur[last] = v
  return true
}

export function renamePlan(
  world: WorldData,
  files: ReadonlyMap<string, string | null>,
  kind: KindDef,
  oldId: string,
  newId: string
): RenamePlan | { error: string } {
  if (!kind.folder) return { error: `A ${kind.label} has no id to change.` }
  if (!isId(newId)) return { error: `"${newId}" can't be an id: lowercase letters, digits, ".", "_" and "-" only.` }
  if (newId === oldId) return { error: 'That is already its id.' }
  const key = (k: KindDef, id: string): string => `${k.kind}/${id}`
  if (!world.entities.has(key(kind, oldId))) return { error: `There is no ${kind.label} "${oldId}".` }
  if (world.entities.has(key(kind, newId))) return { error: `There is already a ${kind.label} called "${newId}".` }

  // Entities to move: the renamed one, plus any entity of another kind with the same id that refers to it.
  const moves: { kind: KindDef; id: string }[] = [{ kind, id: oldId }]
  for (const e of world.entities.values()) {
    if (e.id !== oldId || e.kind.kind === kind.kind) continue
    const k = e.kind
    if (k?.folder && e.refs.some((r) => r.kind === kind.kind && r.id === oldId) && !world.entities.has(key(k, newId)))
      moves.push({ kind: k, id: oldId })
  }
  const movedKeys = new Set(moves.map((m) => key(m.kind, m.id)))

  // New values for every entity that refers to the old id.
  const values = new Map<string, { kind: KindDef; id: string; value: unknown }>()
  const updated: string[] = []
  const skipped: string[] = []
  for (const e of world.entities.values()) {
    const refs = e.refs.filter((r) => r.kind === kind.kind && r.id === oldId)
    if (!refs.length) continue
    const k = e.kind
    if (e.value === undefined) {
      skipped.push(e.key)
      continue
    }
    const value = structuredClone(e.value)
    let ok = true
    for (const r of refs) ok = setAt(value, fieldPath(r.field), newId) && ok
    if (!ok) {
      skipped.push(e.key)
      continue
    }
    values.set(e.key, { kind: k, id: e.id, value })
    updated.push(e.key)
  }

  const changes: FileChange[] = []
  for (const m of moves) {
    const from = entityPath(m.kind, m.id).replace(/\.json$/, '')
    const to = entityPath(m.kind, newId).replace(/\.json$/, '')
    for (const ext of ['json', 'md', 'js']) {
      const text = files.get(`${from}.${ext}`)
      if (text === undefined || text === null) continue
      const v = ext === 'json' ? values.get(key(m.kind, m.id)) : undefined
      changes.push({ path: `${to}.${ext}`, text: v ? entityText(v.kind, v.value) : text })
      changes.push({ path: `${from}.${ext}`, text: null })
    }
  }
  for (const [k, v] of values) {
    if (movedKeys.has(k)) continue
    // A kind whose id comes from its contents (a relation's pair) moves to the id its new contents give.
    const own = v.kind.idOf?.(v.value as never) ?? null
    if (own && own !== v.id && !world.entities.has(key(v.kind, own))) {
      const from = entityPath(v.kind, v.id).replace(/\.json$/, '')
      const to = entityPath(v.kind, own).replace(/\.json$/, '')
      changes.push({ path: `${to}.json`, text: entityText(v.kind, v.value) })
      changes.push({ path: `${from}.json`, text: null })
      for (const ext of ['md', 'js']) {
        const text = files.get(`${from}.${ext}`)
        if (text === undefined || text === null) continue
        changes.push({ path: `${to}.${ext}`, text })
        changes.push({ path: `${from}.${ext}`, text: null })
      }
      continue
    }
    changes.push({ path: entityPath(v.kind, v.id), text: entityText(v.kind, v.value) })
  }
  return { changes, updated: updated.filter((k) => !movedKeys.has(k)), skipped }
}
