/**
 * Colouring the star map by who holds the stars: each settled system claims
 * the stars within a leg of it, strongest close in; a star goes to the
 * strongest claim, and where two polities' claims are nearly equal it is
 * contested. Drawn as tinted stars and faint bubbles that add up where they
 * overlap, so territory reads as coloured clouds with borders where they meet.
 */
import { historyAt } from '@malevo/model'
import type { WorldSnapshot } from '../../../../shared/types'

export type ColourBy = 'type' | 'culture' | 'polity'

export interface TerritoryHolder {
  /** The group: a culture or polity id. */
  key: string
  name: string
  color: string
  pos: [number, number, number]
}

export interface Territory {
  mode: 'culture' | 'polity'
  /** How far a system's claim reaches, ly (a leg). */
  reach: number
  holders: TerritoryHolder[]
}

/** A claim at least this share of the strongest one makes a star contested (polities only). */
export const CONTEST = 0.75
export const CONTESTED_COLOUR = '#ff5a4a'

/** The leading culture of a mix. */
export function leadingCulture(cultures: readonly { culture: string; share: number }[] | undefined): string | null {
  let best: string | null = null
  let v = -1
  for (const c of cultures ?? []) if (c.share > v) [best, v] = [c.culture, c.share]
  return best
}

/** Who holds each system at time `now`, by its history. */
export function territoryHolders(snapshot: WorldSnapshot, now: number, mode: 'culture' | 'polity'): TerritoryHolder[] {
  const out: TerritoryHolder[] = []
  const groups = mode === 'culture' ? snapshot.cultures : snapshot.polities
  for (const s of snapshot.systems) {
    if (!s.star) continue
    const h = historyAt(s.history, now)
    if (!h) continue
    const key = mode === 'culture' ? leadingCulture(h.cultures) : h.polity
    if (!key) continue
    const g = groups.find((x) => x.id === key)
    const color = typeof g?.value?.color === 'string' ? g.value.color : '#9aa4b2'
    out.push({ key, name: String(g?.value?.name ?? key), color, pos: s.star.pos })
  }
  return out
}

/** The groups on the map, largest first, for a legend. */
export function territoryLegend(holders: readonly TerritoryHolder[]): { key: string; name: string; color: string; systems: number }[] {
  const m = new Map<string, { key: string; name: string; color: string; systems: number }>()
  for (const h of holders) {
    const e = m.get(h.key) ?? { key: h.key, name: h.name, color: h.color, systems: 0 }
    e.systems++
    m.set(h.key, e)
  }
  return [...m.values()].sort((a, b) => b.systems - a.systems || a.name.localeCompare(b.name))
}

/**
 * For each star, the group with the strongest claim (index into `groups`, or -1), how strong (0–1),
 * and whether a rival's claim is nearly as strong.
 */
export function claims(
  pos: Float32Array,
  t: Territory
): { groups: { key: string; color: string }[]; owner: Int16Array; best: Float32Array; contested: Uint8Array } {
  const n = pos.length / 3
  const groups: { key: string; color: string }[] = []
  const gi = new Map<string, number>()
  for (const h of t.holders)
    if (!gi.has(h.key)) {
      gi.set(h.key, groups.length)
      groups.push({ key: h.key, color: h.color })
    }
  const owner = new Int16Array(n).fill(-1)
  const best = new Float32Array(n)
  const second = new Float32Array(n)
  const rival = new Int16Array(n).fill(-1)
  const R = Math.max(0.1, t.reach)
  // A grid of the stars, cells one reach across.
  const cell = (x: number): number => Math.floor(x / R)
  const grid = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const k = `${cell(pos[i * 3])},${cell(pos[i * 3 + 1])},${cell(pos[i * 3 + 2])}`
    let list = grid.get(k)
    if (!list) grid.set(k, (list = []))
    list.push(i)
  }
  // The strongest claim each group has on each star.
  const per = groups.map(() => new Map<number, number>())
  for (const h of t.holders) {
    const m = per[gi.get(h.key)!]
    const [cx, cy, cz] = h.pos.map(cell)
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++)
          for (const j of grid.get(`${x},${y},${z}`) ?? []) {
            const d = Math.hypot(pos[j * 3] - h.pos[0], pos[j * 3 + 1] - h.pos[1], pos[j * 3 + 2] - h.pos[2])
            if (d >= R) continue
            const v = 1 - d / R
            if (!((m.get(j) ?? -1) >= v)) m.set(j, v)
          }
  }
  per.forEach((m, g) =>
    m.forEach((v, j) => {
      if (v > best[j]) {
        second[j] = best[j]
        rival[j] = owner[j]
        best[j] = v
        owner[j] = g
      } else if (v > second[j]) {
        second[j] = v
        rival[j] = g
      }
    })
  )
  const contested = new Uint8Array(n)
  if (t.mode === 'polity')
    for (let j = 0; j < n; j++) if (owner[j] >= 0 && rival[j] >= 0 && second[j] >= best[j] * CONTEST) contested[j] = 1
  return { groups, owner, best, contested }
}
