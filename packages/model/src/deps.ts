/**
 * What depends on what (docs/PLAN.md §3.4). An entity depends on everything
 * it references and on everything its lock recorded as an input. The graph
 * answers "if I change this, what else is affected?" before anything is
 * written, and "which locked values are stale?" afterwards.
 */
import { compareStrings } from '@malevo/core'
import { entityKey, lockSchema, type Lock } from './kinds'
import type { WorldData } from './load'

export interface DependencyGraph {
  /** Keys this entity depends on directly, sorted. */
  dependsOn(key: string): string[]
  /** Keys that depend directly on this entity, sorted. */
  dependents(key: string): string[]
  /** Everything that depends on this entity, directly or not, sorted. */
  affectedBy(key: string): string[]
}

/** The lock of an entity, if its value carries a well-formed one. */
export function lockOf(value: unknown): Lock | null {
  if (typeof value !== 'object' || value === null || !('lock' in value)) return null
  const parsed = lockSchema.parse((value as { lock: unknown }).lock, 'lock', { issues: [], refs: [] })
  return parsed ?? null
}

export function dependencyGraph(world: WorldData): DependencyGraph {
  const out = new Map<string, Set<string>>()
  const into = new Map<string, Set<string>>()
  const link = (from: string, to: string): void => {
    if (from === to) return
    if (!out.has(from)) out.set(from, new Set())
    if (!into.has(to)) into.set(to, new Set())
    out.get(from)!.add(to)
    into.get(to)!.add(from)
  }
  const kinds = new Map(world.kinds.map((k) => [k.kind, k]))
  for (const e of world.entities.values()) {
    for (const r of e.refs) {
      const kind = kinds.get(r.kind)
      link(e.key, kind ? entityKey(kind, r.id) : `${r.kind}/${r.id}`)
    }
    const lock = lockOf(e.value)
    if (lock) for (const input of Object.keys(lock.inputs)) link(e.key, input)
  }
  const sorted = (s: Set<string> | undefined): string[] => [...(s ?? [])].sort()
  return {
    dependsOn: (key) => sorted(out.get(key)),
    dependents: (key) => sorted(into.get(key)),
    affectedBy(key) {
      const seen = new Set<string>()
      const queue = [key]
      while (queue.length) {
        for (const d of into.get(queue.shift()!) ?? []) {
          if (d !== key && !seen.has(d)) {
            seen.add(d)
            queue.push(d)
          }
        }
      }
      return [...seen].sort()
    }
  }
}

export interface StaleInput {
  /** The locked entity. */
  key: string
  path: string
  /** The input that changed or disappeared. */
  input: string
  recorded: string
  /** Null when the input no longer exists. */
  current: string | null
}

/** Locked entities whose recorded inputs have changed since they were locked. */
export function staleLocks(world: WorldData): StaleInput[] {
  const out: StaleInput[] = []
  for (const e of [...world.entities.values()].sort((a, b) => compareStrings(a.key, b.key))) {
    const lock = lockOf(e.value)
    if (!lock) continue
    for (const [input, recorded] of Object.entries(lock.inputs).sort(([a], [b]) => compareStrings(a, b))) {
      const current = world.entities.get(input)?.hash ?? null
      if (current !== recorded) out.push({ key: e.key, path: e.path, input, recorded, current })
    }
  }
  return out
}
