/**
 * Comparing two worlds (docs/PLAN.md §3.6): which entities were added,
 * removed or changed, and in which fields. Values are compared in canonical
 * form, so formatting differences never show up as changes.
 */
import { compareStrings } from '@malevo/core'
import type { Entity, WorldData } from './load'

export interface FieldChange {
  /** JSON path, e.g. "when.offset.year". */
  field: string
  before: unknown
  after: unknown
}

export interface EntityChange {
  key: string
  path: string
  label: string
  fields: FieldChange[]
}

export interface WorldComparison {
  /** In the other world but not this one. */
  added: Entity[]
  /** In this world but not the other one. */
  removed: Entity[]
  changed: EntityChange[]
  /** Entities that differ but could not be compared field by field (one side does not parse). */
  unreadable: string[]
}

/** How `other` differs from `base`. */
export function compareWorlds(base: WorldData, other: WorldData): WorldComparison {
  const out: WorldComparison = { added: [], removed: [], changed: [], unreadable: [] }
  const keys = [...new Set([...base.entities.keys(), ...other.entities.keys()])].sort(compareStrings)
  for (const key of keys) {
    const a = base.entities.get(key)
    const b = other.entities.get(key)
    if (!a) out.added.push(b!)
    else if (!b) out.removed.push(a)
    else if (a.hash !== b.hash) {
      if (a.canonical === null || b.canonical === null) out.unreadable.push(key)
      else
        out.changed.push({
          key,
          path: a.path,
          label: a.kind.label,
          fields: diffValues(JSON.parse(a.canonical), JSON.parse(b.canonical), '')
        })
    }
  }
  return out
}

/** Leaf-level differences between two JSON values. Arrays are compared as whole values unless both hold objects of equal length. */
export function diffValues(a: unknown, b: unknown, field: string): FieldChange[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareStrings)
    return keys.flatMap((k) => diffValues(a[k], b[k], field ? `${field}.${k}` : k))
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(isObj) && b.every(isObj)) {
    return a.flatMap((x, i) => diffValues(x, b[i], `${field}[${i}]`))
  }
  return [{ field, before: a, after: b }]
}
