/**
 * Things the world tracks, as the blades see them: what an element on screen is about (so a right-click
 * anywhere can offer the same actions), what to call it, and what can be done with it.
 */
import { KINDS, articlePath, type KindDef } from '@malevo/model'
import type { BodyInfoDto, SystemInfoDto, WorldSnapshot } from '../../../shared/types'
import type { BladeSpec } from '../tools/registry'

export interface Ref {
  kind: string
  id: string
}

export interface Action {
  label: string
  /** The view to open. */
  spec?: BladeSpec
  /** Or something to do here and now. */
  run?: () => void
  /** Shown first, and on a double-click. */
  primary?: boolean
}

const parse = (s: string | undefined | null): Ref | null => {
  if (!s) return null
  const k = s.indexOf(':')
  return k > 0 ? { kind: s.slice(0, k), id: s.slice(k + 1) } : null
}

/** What an element (or its nearest tagged ancestor) is about. */
export function refFromElement(el: Element | null, snapshot: WorldSnapshot): Ref | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const d = (e as HTMLElement).dataset
    if (!d) continue
    if (d.ref) return parse(d.ref)
    if (d.body && findBody(snapshot, d.body)) return { kind: 'body', id: d.body }
    if (d.bodyRow) return { kind: 'body', id: d.bodyRow }
    if (d.system) return { kind: 'system', id: d.system }
    if (d.city) return { kind: 'city', id: d.city }
    if (d.event) return { kind: 'event', id: d.event }
    if (d.star) return { kind: 'star', id: d.star }
    if (d.node) return parse(d.node)
    if (d.page) {
      const p = snapshot.pages.find((x) => x.path === d.page)
      return p?.kind && p.id ? { kind: p.kind, id: p.id } : { kind: 'page', id: d.page }
    }
  }
  return null
}

export function findBody(snapshot: WorldSnapshot, id: string): { body: BodyInfoDto; system: SystemInfoDto } | null {
  for (const system of snapshot.systems) {
    const body = system.bodies.find((b) => b.id === id)
    if (body) return { body, system }
  }
  return null
}

const kindDef = (kind: string): KindDef | undefined => KINDS.find((k) => k.kind === kind)

function entityList(snapshot: WorldSnapshot, kind: string): { id: string; value: Record<string, unknown> | null }[] {
  switch (kind) {
    case 'culture':
      return snapshot.cultures
    case 'polity':
      return snapshot.polities
    case 'station':
      return snapshot.stations
    case 'nebula':
      return snapshot.nebulae
    case 'ship':
      return snapshot.ships
    case 'traveller':
      return snapshot.travellers
    case 'drifter':
      return snapshot.drifters
    case 'landing':
      return snapshot.landings
    case 'city':
      return snapshot.cities
    case 'route':
      return snapshot.routes.map((r) => ({ id: r.id, value: r.value }))
    case 'event':
      return snapshot.events.map((e) => ({ id: e.id, value: e.value as unknown as Record<string, unknown> | null }))
    default:
      return []
  }
}

/** A name to show for it. */
export function refLabel(ref: Ref, snapshot: WorldSnapshot): string {
  switch (ref.kind) {
    case 'body':
      return findBody(snapshot, ref.id)?.body.name ?? ref.id
    case 'system':
      return snapshot.systems.find((s) => s.id === ref.id)?.name ?? ref.id
    case 'star': {
      const sys = snapshot.systems.find((s) => s.starId === ref.id)
      return sys?.star?.name ?? sys?.name ?? ref.id
    }
    case 'page':
      return snapshot.pages.find((p) => p.path === ref.id)?.title ?? ref.id
    default: {
      const v = entityList(snapshot, ref.kind).find((x) => x.id === ref.id)?.value
      return typeof v?.name === 'string' ? v.name : ref.id
    }
  }
}

/** What it is, in a word or two: "moon of Earth", "gas giant", "city". */
export function refKindLabel(ref: Ref, snapshot: WorldSnapshot): string {
  if (ref.kind === 'body') {
    const f = findBody(snapshot, ref.id)
    return f ? bodyKindLabel(f.body, f.system) : 'body'
  }
  if (ref.kind === 'page') return 'page'
  return kindDef(ref.kind)?.label ?? ref.kind
}

const CLASS_LABEL: Record<string, string> = {
  rocky: 'rocky planet',
  ocean: 'ocean world',
  'ice-giant': 'ice giant',
  'gas-giant': 'gas giant',
  dwarf: 'dwarf planet',
  belt: 'belt',
  comet: 'comet'
}

export function bodyKindLabel(b: BodyInfoDto, system: SystemInfoDto): string {
  if (b.parent && b.cls !== 'belt') {
    const host = system.bodies.find((x) => x.id === b.parent)
    return `moon${host ? ` of ${host.name}` : ''}`
  }
  return CLASS_LABEL[b.cls] ?? b.cls
}

const article = (kind: string, id: string): BladeSpec | null => {
  const k = kindDef(kind)
  return k?.folder ? { type: 'wiki', params: { focus: articlePath(k, id) } } : null
}

/** What can be done with it, best first. */
export function entityActions(ref: Ref, snapshot: WorldSnapshot, setNow: (t: number) => void): Action[] {
  const out: Action[] = []
  const add = (label: string, spec: BladeSpec | null, primary = false): void => {
    if (spec) out.push({ label, spec, primary })
  }
  const systemActions = (sysId: string, here: string): void => {
    add(`Events ${here}`, { type: 'timeline', params: { where: sysId } })
    add(`Route to ${here.replace(/^in /, '')}…`, { type: 'route-to', params: { to: `system:${sysId}` } })
    add('On the star map', { type: 'stars', params: { focus: sysId } })
  }
  switch (ref.kind) {
    case 'body': {
      const f = findBody(snapshot, ref.id)
      if (!f) break
      add('Details', { type: 'body', params: { id: ref.id } }, true)
      add('Article', article('body', ref.id))
      add(`In ${f.system.name}`, { type: 'systems', params: { focus: f.system.id, body: ref.id } })
      if (['rocky', 'ocean', 'dwarf', 'gas-giant', 'ice-giant'].includes(f.body.cls))
        add('Terrain', { type: 'terrain', params: { focus: ref.id } })
      systemActions(f.system.id, `in ${f.system.name}`)
      break
    }
    case 'system': {
      const s = snapshot.systems.find((x) => x.id === ref.id)
      if (!s) break
      add('Open the system', { type: 'systems', params: { focus: ref.id } }, true)
      add(`The star${s.star?.name ? `, ${s.star.name}` : ''}`, { type: 'star', params: { id: s.starId } })
      add('Article', article('system', ref.id))
      add('Approach', { type: 'approach', params: { focus: `system:${ref.id}` } })
      systemActions(ref.id, `in ${s.name}`)
      break
    }
    case 'star': {
      add('Details', { type: 'star', params: { id: ref.id } }, true)
      const sys = snapshot.systems.find((s) => s.starId === ref.id)
      if (sys) add(`Open ${sys.name}`, { type: 'systems', params: { focus: sys.id } })
      add('Route to it…', { type: 'route-to', params: { to: sys ? `system:${sys.id}` : `star:${ref.id}` } })
      add('On the star map', { type: 'stars', params: { focus: `star:${ref.id}` } })
      break
    }
    case 'city': {
      add('Details', { type: 'population', params: { focus: ref.id } }, true)
      add('Article', article('city', ref.id))
      add('City plan', { type: 'cityplan', params: { focus: ref.id } })
      const body = String(snapshot.cities.find((c) => c.id === ref.id)?.value.body ?? '')
      const f = findBody(snapshot, body)
      if (f) {
        add(`${f.body.name}`, { type: 'body', params: { id: body } })
        systemActions(f.system.id, `in ${f.system.name}`)
      }
      break
    }
    case 'culture':
    case 'polity':
      add('Details', { type: 'cultures', params: { focus: `${ref.kind}:${ref.id}` } }, true)
      add('Article', article(ref.kind, ref.id))
      add('Territory on the star map', { type: 'stars', params: { colourBy: ref.kind } })
      break
    case 'event': {
      const e = snapshot.events.find((x) => x.id === ref.id)
      add('On the timeline', { type: 'timeline', params: { focus: ref.id } }, true)
      add('Article', article('event', ref.id))
      if (e?.start) out.push({ label: 'Go to its date', run: () => setNow(e.start!.t) })
      const where = e?.value?.where
      if (where) add(`Where: ${snapshot.systems.find((s) => s.id === where)?.name ?? where}`, { type: 'systems', params: { focus: where } })
      break
    }
    case 'route':
    case 'station':
    case 'nebula':
      add('In Routes', { type: 'routes', params: { [ref.kind]: ref.id } }, true)
      add('Article', article(ref.kind, ref.id))
      if (ref.kind === 'station') add('Route to it…', { type: 'route-to', params: { to: `station:${ref.id}` } })
      break
    case 'ship':
      add('In the Shipyard', { type: 'shipyard', params: { focus: ref.id } }, true)
      add('Trip planner', { type: 'trips', params: { focus: ref.id } })
      add('Article', article('ship', ref.id))
      break
    case 'traveller':
    case 'drifter':
      add('In Whereabouts', { type: 'whereabouts', params: { focus: `${ref.kind}:${ref.id}` } }, true)
      add('Article', article(ref.kind, ref.id))
      break
    case 'landing':
      add('In Landings', { type: 'landings', params: { focus: ref.id } }, true)
      add('Article', article('landing', ref.id))
      break
    case 'page':
      add('Open the page', { type: 'wiki', params: { focus: ref.id } }, true)
      break
    default:
      break
  }
  return out
}
