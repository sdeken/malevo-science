import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AU, M_SUN, collapseOutlines, stateAt, type MassPoint, type OrbitalElements, type Vec3 } from '@malevo/core'
import type { ElementsInfo, PhysicsSummary, SystemInfoDto } from '../../../../shared/types'
import { sig, starColour } from '../../components/fields'

export interface Drawn {
  id: string
  name: string
  cls: string
  radius: number
  parent: string | null
  elements: ElementsInfo
  /** A proposal, not yet kept. */
  ghost?: boolean
  /** For a belt: inner and outer edges, m. */
  extent?: [number, number]
}

interface Props {
  system: SystemInfoDto
  /** The world's foam settings, for the collapse surface. */
  foam: PhysicsSummary | null
  now: number
  selected: string | null
  onSelect(id: string | null): void
  /** Draw around this body (its moons), or the star when null. */
  center: string | null
  bodies: Drawn[]
  scale: 'log' | 'linear'
}

const SIZE = 440
const R = SIZE / 2 - 24

/**
 * The system seen from above (its reference plane), at the current date:
 * orbits, where each body is now, the habitable zone (green band) and where
 * the foam collapses (dashed): the slice, in this plane, of the collapse
 * surface @malevo/core works out from every body's tide at the current date.
 * A giant out past the star's region has its own; a close one bulges the
 * star's region to take it in.
 */
export function OrbitView({ system, foam, now, selected, onSelect, center, bodies, scale }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(SIZE)
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.min(900, el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const px = width / SIZE

  const shown = bodies.filter((b) => (center === null ? !isMoonOf(b, bodies) : parentOf(b) === center))
  const extra: number[] = center === null ? [system.habitableZone?.[1] ?? 0, system.collapse ?? 0] : []
  const outer = Math.max(
    ...shown.map((b) => b.elements.a * (1 + b.elements.e)),
    ...extra.filter((x) => x > 0),
    center === null ? 0.1 * AU : 1e6
  )
  const inner = Math.max(Math.min(...shown.map((b) => b.elements.a * (1 - b.elements.e)), outer / 50), outer / 1e4)
  const lo = Math.log10(inner * 0.5)
  const hi = Math.log10(outer * 1.08)
  const map = (r: number): number => {
    if (scale === 'linear') return (r / (outer * 1.08)) * R
    if (r <= 0) return 0
    return Math.max(0, ((Math.log10(r) - lo) / (hi - lo)) * R)
  }
  const at = (x: number, y: number): [number, number] => {
    const r = Math.hypot(x, y)
    const m = map(r)
    return r === 0 ? [0, 0] : [(x / r) * m, -(y / r) * m]
  }

  // The collapse surface at the current date, sliced in the system plane (positions relative to the star).
  const collapse = useMemo(() => {
    if (!foam || !system.star || system.star.mass === null) return []
    const els = new Map(system.bodies.filter((b) => b.elements && b.cls !== 'belt').map((b) => [b.id, b]))
    const abs = (id: string, guard = 0): Vec3 | null => {
      const b = els.get(id)
      if (!b || guard > 20) return null
      const r = stateAt(toElements(b.elements!), now).r
      const p = b.parent ? abs(b.parent, guard + 1) : [0, 0, 0]
      return p ? [r[0] + p[0], r[1] + p[1], r[2] + p[2]] : null
    }
    const masses: MassPoint[] = [{ pos: [0, 0, 0], mass: system.star.mass * M_SUN }]
    for (const id of els.keys()) {
      const p = abs(id)
      if (p) masses.push({ pos: p, mass: els.get(id)!.mass })
    }
    const settings = { collapseRadius: foam.collapseRadius_au * AU, rule: foam.loadRule }
    return collapseOutlines(masses, settings, [0, 0, 0], [1, 0, 0], [0, 1, 0], { minRadius: outer / 400, grid: 160 }).map((o) => ({
      star: o.body === 0,
      center: o.center,
      // The outer boundary, then any holes.
      loops: o.loops,
      points: o.loops[0]
    }))
  }, [foam, system, now, outer])
  const hostPos = useMemo((): Vec3 => {
    if (center === null) return [0, 0, 0]
    const byId = new Map(system.bodies.map((b) => [b.id, b]))
    let p: Vec3 = [0, 0, 0]
    for (let b = byId.get(center), g = 0; b?.elements && g < 20; b = b.parent ? byId.get(b.parent) : undefined, g++) {
      const r = stateAt(toElements(b.elements), now).r
      p = [p[0] + r[0], p[1] + r[1], p[2] + r[2]]
    }
    return p
  }, [center, system, now])

  // Zoomed in on a body, the whole view can lie inside a collapse region far bigger than it: say so.
  const enclosing = useMemo(() => {
    if (center === null) return null
    for (const c of collapse) {
      if (c.points.length < 3) continue
      const d = c.points.map((p) => Math.hypot(p[0] - hostPos[0], p[1] - hostPos[1]))
      const inside = pointInPolygon([hostPos[0], hostPos[1]], c.points)
      if (inside && Math.min(...d) > outer) {
        const r = Math.min(...d)
        return r > 0.01 * AU ? `${sig(r / AU, 3)} AU out at its nearest` : `${sig(r / 1000, 3)} km out at its nearest`
      }
    }
    return null
  }, [collapse, center, hostPos, outer])

  const orbits = useMemo(
    () =>
      shown.map((b) => {
        const el = toElements(b.elements)
        const pts: string[] = []
        for (let k = 0; k <= 96; k++) {
          const r = stateAt({ ...el, meanAnomaly: (2 * Math.PI * k) / 96, epoch: 0 }, 0).r
          const [x, y] = at(r[0], r[1])
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
        }
        const now3 = stateAt(el, now).r
        return { b, path: pts.join(' '), pos: at(now3[0], now3[1]) }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown.map((b) => JSON.stringify(b.elements) + b.id).join(), now, scale, outer, inner]
  )

  const unit = center === null ? AU : 1000
  const unitLabel = center === null ? 'AU' : 'km'
  const rings = scale === 'log' ? niceLogRings(inner * 0.5, outer * 1.08) : niceLinearRings(outer * 1.08)
  const host = center ? bodies.find((b) => b.id === center) : null
  const starRgb = system.star ? starColour(system.star.ci) : [1, 0.9, 0.6]

  const annulus = (r0: number, r1: number): string =>
    `M ${map(r1)} 0 A ${map(r1)} ${map(r1)} 0 1 0 ${-map(r1)} 0 A ${map(r1)} ${map(r1)} 0 1 0 ${map(r1)} 0 Z M ${map(r0)} 0 A ${map(r0)} ${map(r0)} 0 1 0 ${-map(r0)} 0 A ${map(r0)} ${map(r0)} 0 1 0 ${map(r0)} 0 Z`

  return (
    <div className="orbit-view" ref={box}>
      <svg
        width={width}
        height={width}
        viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
        onClick={() => onSelect(null)}
        className={enclosing ? 'inside-collapse' : undefined}
        role="img"
        aria-label="Orbits"
      >
        {rings.map((r) => (
          <g key={r} className="ov-ring">
            <circle r={map(r)} />
            <text x={map(r) * 0.7071 + 3} y={-map(r) * 0.7071 - 3}>
              {sig(r / unit, 2)} {unitLabel}
            </text>
          </g>
        ))}
        {center === null && system.habitableZone && (
          <path
            className="ov-hz"
            fillRule="evenodd"
            d={`M ${map(system.habitableZone[1])} 0 A ${map(system.habitableZone[1])} ${map(system.habitableZone[1])} 0 1 0 ${-map(system.habitableZone[1])} 0 A ${map(system.habitableZone[1])} ${map(system.habitableZone[1])} 0 1 0 ${map(system.habitableZone[1])} 0 Z M ${map(system.habitableZone[0])} 0 A ${map(system.habitableZone[0])} ${map(system.habitableZone[0])} 0 1 0 ${-map(system.habitableZone[0])} 0 A ${map(system.habitableZone[0])} ${map(system.habitableZone[0])} 0 1 0 ${map(system.habitableZone[0])} 0 Z`}
          >
            <title>Habitable zone</title>
          </path>
        )}
        {orbits
          .filter(({ b }) => b.extent && center === null)
          .map(({ b }) => (
            <g
              key={`belt-${b.id}`}
              className={`ov-belt${b.id === selected ? ' selected' : ''}`}
              data-body={b.id}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(b.id)
              }}
            >
              <path fillRule="evenodd" d={annulus(b.extent![0], b.extent![1])}>
                <title>{b.name}</title>
              </path>
              <text className="ov-label" x={0} y={map(b.extent![1]) + 12}>
                {b.name}
              </text>
            </g>
          ))}
        {orbits
          .filter(({ b }) => !b.extent)
          .map(({ b, path }) => (
            <polyline
              key={`o-${b.id}`}
              className={`ov-orbit${b.ghost ? ' ghost' : ''}${b.id === selected ? ' selected' : ''}`}
              points={path}
            />
          ))}
        {center === null ? (
          <circle className="ov-star" r={7} fill={`rgb(${starRgb.map((c) => Math.round(c * 255)).join(',')})`} />
        ) : (
          <g>
            <circle className="ov-host" r={6} />
            <text className="ov-label" x={9} y={4}>
              {host?.name}
            </text>
          </g>
        )}
        {orbits
          .filter(({ b }) => !b.extent)
          .map(({ b, pos }) => (
            <g
              key={`b-${b.id}`}
              className={`ov-body ov-${b.cls}${b.ghost ? ' ghost' : ''}${b.id === selected ? ' selected' : ''}`}
              transform={`translate(${pos[0]} ${pos[1]})`}
              onClick={(e) => {
                e.stopPropagation()
                if (!b.ghost) onSelect(b.id)
              }}
              data-body={b.id}
            >
              <circle r={Math.max(2.5, Math.min(9, 2 + Math.log10(b.radius / 1e6 + 1) * 6)) / px} />
              <text className="ov-label" x={8 / px} y={4 / px}>
                {b.name}
              </text>
            </g>
          ))}
        {collapse.map((c, k) => {
          // On the log scale, a region away from the view's centre would be squashed toward its orbit (distances
          // out from the centre shrink, distances along the orbit do not). A small one is drawn in its true shape
          // instead, at the scale along the orbit where its centre sits. A big one (a third of its distance or more)
          // is mapped like everything else, so a gap or a join with the star's region reads as it is; between, a blend.
          const cx = c.center[0] - hostPos[0]
          const cy = c.center[1] - hostPos[1]
          const rc = Math.hypot(cx, cy)
          const size = Math.max(...c.points.map((p) => Math.hypot(p[0] - c.center[0], p[1] - c.center[1])))
          const w = scale === 'log' && rc > 1e-9 * outer ? Math.max(0, Math.min(1, (0.35 - size / rc) / 0.25)) : 0
          const [mx, my] = at(cx, cy)
          const kl = rc > 0 ? map(rc) / rc : 0
          const place = (p: Vec3): [number, number] => {
            const g = at(p[0] - hostPos[0], p[1] - hostPos[1])
            if (w === 0) return g
            const t: [number, number] = [mx + (p[0] - c.center[0]) * kl, my - (p[1] - c.center[1]) * kl]
            return [t[0] * w + g[0] * (1 - w), t[1] * w + g[1] * (1 - w)]
          }
          const pts = c.points.map(place)
          if (pts.length < 3) return null
          const d = c.loops
            .map(
              (l) =>
                'M ' +
                l
                  .map((p) =>
                    place(p)
                      .map((x) => x.toFixed(1))
                      .join(',')
                  )
                  .join(' L ') +
                ' Z'
            )
            .join(' ')
          const top = pts.reduce((a, b) => (b[1] < a[1] ? b : a))
          return (
            <g key={`c-${k}`} className="ov-collapse" pointerEvents="none">
              <path d={d} fillRule="evenodd">
                <title>The foam collapses inside this line (every body's tide, at the current date)</title>
              </path>
              {c.star && center === null && system.collapse && (
                <text x={top[0]} y={top[1] - 4}>
                  collapse {sig(system.collapse / AU, 3)} AU
                </text>
              )}
            </g>
          )
        })}
        {enclosing && (
          <text className="ov-inside" x={0} y={SIZE / 2 - 10} textAnchor="middle">
            All of this lies inside {host?.name}’s collapse region, which reaches {enclosing}
          </text>
        )}
      </svg>
    </div>
  )
}

function parentOf(b: Drawn): string | null {
  return b.parent
}

function isMoonOf(b: Drawn, all: Drawn[]): boolean {
  const p = parentOf(b)
  return p !== null && all.some((x) => x.id === p)
}

function pointInPolygon(p: [number, number], poly: readonly (readonly number[])[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function toElements(e: ElementsInfo): OrbitalElements {
  return { a: e.a, e: e.e, i: e.i, node: e.node, peri: e.peri, meanAnomaly: e.meanAnomaly, epoch: e.epoch, mu: e.mu }
}

function niceLogRings(lo: number, hi: number): number[] {
  const out: number[] = []
  const unit = hi > 0.05 * AU ? AU : 1000
  for (let p = Math.floor(Math.log10(lo / unit)); p <= Math.ceil(Math.log10(hi / unit)); p++) {
    const v = 10 ** p * unit
    if (v >= lo && v <= hi) out.push(v)
  }
  return out
}

function niceLinearRings(hi: number): number[] {
  const unit = hi > 0.05 * AU ? AU : 1000
  const span = hi / unit
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 1e4, 1e5, 1e6].find((s) => span / s <= 6) ?? 1e6
  const out: number[] = []
  for (let v = step; v * unit < hi; v += step) out.push(v * unit)
  return out
}
