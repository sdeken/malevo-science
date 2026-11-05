/**
 * Cultures, polities and how they relate (docs/PLAN.md §7.2). Everything here
 * is derived from the files; nothing is stored.
 *
 * Affinity between two cultures, from −1 (hostile) to 1 (close):
 *
 *   d       = √(Σ wₖ·(aₖ − bₖ)²) / √(Σ wₖ)       how different their traits are, 0–1
 *   s       = 1 − d                               how alike they are
 *   o       = √(openₐ · open_b)                   how open both are (1 if no openness trait)
 *   warmth  = floor + (1 − floor)·o               closed cultures warm to no one
 *   derived = 2·s·warmth − 1
 *
 * Two identical, open cultures come out at 1; two identical, closed ones at
 * 2·floor − 1; opposites at −1. A relation file can replace the derived value
 * and change it at events (a war, a treaty); the latest change at or before
 * a date holds.
 */
import { compareStrings } from '@malevo/core'
import type { WhenResolver } from './events'
import { cultureKind, cultureSettingsKind, type CultureFile, type CultureSettings, type RelationFile, type SystemFile } from './kinds'
import { entitiesOf, type WorldData } from './load'

const NEUTRAL = 0.5

export function cultureSettings(world: WorldData): CultureSettings | null {
  return entitiesOf(world, cultureSettingsKind)[0]?.value ?? null
}

/** A trait's value, 0.5 when the culture does not give it. */
export function traitOf(c: CultureFile, trait: string): number {
  return c.traits[trait] ?? NEUTRAL
}

/** The affinity worked out from two cultures' traits alone. */
export function derivedAffinity(a: CultureFile, b: CultureFile, s: CultureSettings): number {
  let sum = 0
  let weights = 0
  for (const t of s.traits) {
    sum += t.weight * (traitOf(a, t.id) - traitOf(b, t.id)) ** 2
    weights += t.weight
  }
  const d = weights > 0 ? Math.sqrt(sum / weights) : 0
  const open = s.affinity.opennessTrait ? Math.sqrt(traitOf(a, s.affinity.opennessTrait) * traitOf(b, s.affinity.opennessTrait)) : 1
  const warmth = s.affinity.closedFloor + (1 - s.affinity.closedFloor) * open
  return Math.max(-1, Math.min(1, 2 * (1 - d) * warmth - 1))
}

/** The file id of the relation between two cultures: their ids, sorted, joined by "--". */
export function relationId(a: string, b: string): string {
  return [a, b].sort(compareStrings).join('--')
}

export interface AffinityAt {
  value: number
  /** What the traits alone give. */
  derived: number
  source: 'traits' | 'set' | 'change'
  /** The change in force, if one is. */
  change?: { event: string; note?: string; t: number }
}

/**
 * The affinity between two cultures at time t. `eventTime(id, from)` gives
 * an event's start or end (null if it cannot be worked out; such changes are
 * skipped, and the checks report them).
 */
export function affinityAt(
  a: CultureFile,
  b: CultureFile,
  relation: RelationFile | undefined,
  s: CultureSettings,
  t: number,
  eventTime: (id: string, from: 'start' | 'end') => number | null
): AffinityAt {
  const derived = derivedAffinity(a, b, s)
  let best: { event: string; note?: string; t: number; value: number } | null = null
  for (const c of relation?.changes ?? []) {
    const at = eventTime(c.event, c.from ?? 'start')
    if (at === null || at > t) continue
    if (!best || at >= best.t) best = { event: c.event, note: c.note, t: at, value: c.affinity }
  }
  if (best) return { value: best.value, derived, source: 'change', change: { event: best.event, note: best.note, t: best.t } }
  if (relation?.affinity !== undefined) return { value: relation.affinity, derived, source: 'set' }
  return { value: derived, derived, source: 'traits' }
}

// ---- system history ----

export interface HistoryEntry {
  /** Index in the file's history list. */
  index: number
  t: number | null
  polity: string | null
  /** Culture shares, normalised to sum to 1 (empty when none are given). */
  cultures: { culture: string; share: number }[]
  note: string | null
  errors: string[]
}

/** A system's history, resolved and in time order (entries whose date cannot be worked out go last). */
export function systemHistory(file: SystemFile, resolver: WhenResolver): HistoryEntry[] {
  return (file.history ?? [])
    .map((h, index) => {
      const { time, errors } = resolver.resolve(h.from)
      const total = (h.cultures ?? []).reduce((sum, c) => sum + c.share, 0)
      return {
        index,
        t: time?.t ?? null,
        polity: h.polity ?? null,
        cultures: total > 0 ? (h.cultures ?? []).map((c) => ({ culture: c.culture, share: c.share / total })) : [],
        note: h.note ?? null,
        errors
      }
    })
    .sort((x, y) => (x.t ?? Infinity) - (y.t ?? Infinity) || x.index - y.index)
}

/** Who held a system and who lived there at time t: the latest entry at or before t, or null before the first. */
export function historyAt(history: readonly HistoryEntry[], t: number): HistoryEntry | null {
  let found: HistoryEntry | null = null
  for (const h of history) if (h.t !== null && h.t <= t) found = h
  return found
}

/** The calendar a culture uses at time t: the latest entry whose event has started, or the first without one. */
export function cultureCalendarAt(c: CultureFile, t: number, eventStart: (id: string) => number | null): string | null {
  let found: string | null = null
  let foundT = -Infinity
  for (const entry of c.calendars ?? []) {
    if (entry.from === undefined) {
      if (found === null) found = entry.calendar
      continue
    }
    const at = eventStart(entry.from)
    if (at !== null && at <= t && at >= foundT) {
      found = entry.calendar
      foundT = at
    }
  }
  return found
}

/** Every culture of a world, by id. */
export function cultureFiles(world: WorldData): Map<string, CultureFile> {
  return new Map(entitiesOf(world, cultureKind).map((e) => [e.id, e.value]))
}
