import type { WorldSnapshot } from '../../../../shared/types'
import type { MapNebula, MapRoute, MapSystem } from '../stars/StarMap'

export const ROUTE_COLOR = '#6fd0a0'
export const NEBULA_COLOR = '#b07fe0'

/** Every route's waypoints that have positions, for the star map. */
export function mapRoutes(snapshot: WorldSnapshot, current?: string | null): MapRoute[] {
  return snapshot.routes.map((r) => ({
    id: r.id,
    color: r.color ?? ROUTE_COLOR,
    current: r.id === current,
    points: r.nodes.map((n) => (n ? snapshot.nodes[n]?.pos : null)).filter((p): p is [number, number, number] => Boolean(p))
  }))
}

export function mapNebulae(snapshot: WorldSnapshot): MapNebula[] {
  return snapshot.nebulae
    .filter((n) => n.value)
    .map((n) => {
      const v = n.value as { center_ly: number[]; radii_ly: number[]; color?: string }
      return {
        id: n.id,
        center: [v.center_ly[0], v.center_ly[1], v.center_ly[2]],
        radii: [v.radii_ly[0], v.radii_ly[1], v.radii_ly[2]],
        color: v.color ?? NEBULA_COLOR
      }
    })
}

/** Stations, drawn like systems in grey. */
export function mapStations(snapshot: WorldSnapshot): MapSystem[] {
  return snapshot.stations
    .map((s) => snapshot.nodes[`station:${s.id}`])
    .filter((n) => n?.pos)
    .map((n) => ({ id: n.id, name: n.name, pos: n.pos!, color: '#9aa4b2' }))
}
