/**
 * Everything that can be open as a blade: every tool, and the pages about one thing (a body, a star, the way
 * to somewhere).
 */
import type { ComponentType } from 'react'
import type { WorldSnapshot } from '../../../shared/types'
import { TOOLS } from '../tools'
import type { ToolProps } from '../tools/registry'
import { BodyBlade, RouteToBlade, StarBlade } from './details'
import { refLabel } from './entities'
import type { Blade } from './stack'

export interface BladeDef {
  type: string
  /** Narrow for a page about one thing; wide for a tool. */
  width: 'narrow' | 'medium' | 'wide'
  title(params: Record<string, string>, snapshot: WorldSnapshot): string
  View: ComponentType<ToolProps>
}

const DETAILS: BladeDef[] = [
  { type: 'body', width: 'medium', title: (p, s) => refLabel({ kind: 'body', id: p.id ?? '' }, s), View: BodyBlade },
  { type: 'star', width: 'medium', title: (p, s) => `Star: ${refLabel({ kind: 'star', id: p.id ?? '' }, s)}`, View: StarBlade },
  { type: 'route-to', width: 'narrow', title: () => 'Route to…', View: RouteToBlade }
]

const DEFS = new Map<string, BladeDef>([
  ...TOOLS.map((t): [string, BladeDef] => [t.id, { type: t.id, width: 'wide', title: () => t.title, View: t.View }]),
  ...DETAILS.map((d): [string, BladeDef] => [d.type, d])
])

export function bladeDef(type: string): BladeDef | undefined {
  return DEFS.get(type)
}

export function bladeTitle(b: Blade, snapshot: WorldSnapshot): string {
  return DEFS.get(b.type)?.title(b.params, snapshot) ?? b.type
}
