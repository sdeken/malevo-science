import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AU, M_SUN, contourGrid, stateAt, topDownLoad, type MassPoint, type OrbitalElements, type Vec3 } from '@malevo/core'
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
  /** Measuring: clicks report a place (relative to the star, in the system plane) or a body, instead of selecting. */
  onMeasure?: (p: { body: string } | { pos: Vec3 }) => void
  /** A measured leg to draw, star-relative positions. */
  measureLine?: [Vec3, Vec3] | null
  /** Draw the load's isolines (1/8 to 8 times the collapse load) as well as the collapse edge. */
  isolines?: boolean
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
export function OrbitView({
  system,
  foam,
  now,
  selected,
  onSelect,
  center,
  bodies,
  scale,
  onMeasure,
  measureLine,
  isolines = false
}: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(SIZE)
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.min(900, el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Pan and zoom: the view's centre in drawing units and how far it is magnified. Wheel zooms about the cursor,
  // dragging pans; marks and labels keep their size on screen.
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  useEffect(() => setView({ x: 0, y: 0, zoom: 1 }), [center, system.id, scale])
  const zoom = view.zoom
  const px = (width / SIZE) * zoom
  const toUnits = (clientX: number, clientY: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [view.x + ((clientX - r.left) / r.width - 0.5) * (SIZE / zoom), view.y + ((clientY - r.top) / r.height - 0.5) * (SIZE / zoom)]
  }
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const v = viewRef.current
      const r = el.getBoundingClientRect()
      const fx = (e.clientX - r.left) / r.width - 0.5
      const fy = (e.clientY - r.top) / r.height - 0.5
      const z = Math.max(1, Math.min(5000, v.zoom * Math.exp(-e.deltaY * 0.0015)))
      // Keep the point under the cursor where it is.
      const ux = v.x + (fx * SIZE) / v.zoom
      const uy = v.y + (fy * SIZE) / v.zoom
      setView(z === 1 ? { x: 0, y: 0, zoom: 1 } : { x: ux - (fx * SIZE) / z, y: uy - (fy * SIZE) / z, zoom: z })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

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
  /** Drawing units back to a distance from the view's centre body (the inverse of `map`). */
  const unmap = (m: number): number => (scale === 'linear' ? (m / R) * outer * 1.08 : Math.pow(10, lo + (m / R) * (hi - lo)))
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

  // The collapse region, seen from above: one load field for the whole system, sampled on a grid laid out in this
  // view's own drawing units (log or linear, panned and zoomed), and contoured there. Every line is the field's,
  // mapped point by point; nothing is drawn per body. Isolines at 1/8 to 8 times the collapse load show its shape.
  const field = useMemo(() => {
    if (!foam || !system.star || system.star.mass === null) return null
    const { masses } = systemMasses(system, now)!
    return topDownLoad(masses, { collapseRadius: foam.collapseRadius_au * AU, rule: foam.loadRule }, [0, 0, 0], [1, 0, 0], [0, 1, 0])
  }, [foam, system, now])
  /** Drawing units to the star-relative position they show. */
  const toWorld = (ux: number, uy: number): [number, number] => {
    const m = Math.hypot(ux, uy)
    if (m === 0) return [hostPos[0], hostPos[1]]
    const r = unmap(m)
    return [hostPos[0] + (ux / m) * r, hostPos[1] - (uy / m) * r]
  }
  const [contours, setContours] = useState<{ level: number; d: string }[]>([])
  const [enclosing, setEnclosing] = useState<string | null>(null)
  const geometry = `${view.x}|${view.y}|${zoom}|${scale}|${outer}|${inner}|${hostPos.join()}`
  useEffect(() => {
    if (!field) {
      setContours([])
      setEnclosing(null)
      return
    }
    // Wait for panning and zooming to settle; until then the old lines, in drawing units, stay where they belong.
    const timer = setTimeout(() => {
      const N = 180
      const span = (SIZE / zoom) * 1.1
      const x0 = view.x - span / 2
      const y0 = view.y - span / 2
      const h = span / N
      const f = new Float64Array((N + 1) * (N + 1))
      let allInside = true
      for (let a = 0; a <= N; a++)
        for (let b = 0; b <= N; b++) {
          const [wx, wy] = toWorld(x0 + b * h, y0 + a * h)
          const v = field(wx, wy)
          f[a * (N + 1) + b] = v
          if (v < 0) allInside = false
        }
      const levels = isolines ? [-3, -2, -1, 0, 1, 2, 3].map((k) => k * Math.LN2) : [0]
      const out: { level: number; d: string }[] = []
      for (const L of levels) {
        // log₂ steps of 1, 2 and 3 are loads of 2, 4 and 8 times (or under) the collapse load.
        const lines = contourGrid(f, N, N, x0, y0, h, h, L)
        const d = lines
          .map((l) => {
            const closed = Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 2 * h
            return 'M ' + l.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ') + (closed ? ' Z' : '')
          })
          .join(' ')
        if (d) out.push({ level: L, d })
      }
      setContours(out)
      // Zoomed in on a body, the whole view can lie inside a collapse region far bigger than it: say how far out it ends.
      if (center !== null && allInside) {
        let nearest = Infinity
        for (let k = 0; k < 24; k++) {
          const a = (2 * Math.PI * k) / 24
          const dir = [Math.cos(a), Math.sin(a)]
          const inside = (r: number): boolean => field(hostPos[0] + dir[0] * r, hostPos[1] + dir[1] * r) >= 0
          let lo2 = outer
          let hi2 = outer * 2
          while (inside(hi2) && hi2 < 1e6 * outer) {
            lo2 = hi2
            hi2 *= 2
          }
          for (let i = 0; i < 30; i++) {
            const m = (lo2 + hi2) / 2
            if (inside(m)) lo2 = m
            else hi2 = m
          }
          nearest = Math.min(nearest, hi2)
        }
        setEnclosing(
          nearest > 0.01 * AU ? `${sig(nearest / AU, 3)} AU out at its nearest` : `${sig(nearest / 1000, 3)} km out at its nearest`
        )
      } else setEnclosing(null)
    }, 120)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, geometry, isolines])

  const orbits = useMemo(
    () =>
      shown.map((b) => {
        const el = toElements(b.elements)
        const pts: string[] = []
        for (let k = 0; k <= 360; k++) {
          const r = stateAt({ ...el, meanAnomaly: (2 * Math.PI * k) / 360, epoch: 0 }, 0).r
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
        ref={svgRef}
        width={width}
        height={width}
        viewBox={`${view.x - SIZE / 2 / zoom} ${view.y - SIZE / 2 / zoom} ${SIZE / zoom} ${SIZE / zoom}`}
        style={{ ['--ovs' as string]: String(1 / zoom), cursor: onMeasure ? 'crosshair' : drag.current?.moved ? 'grabbing' : undefined }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || zoom === 1) return
          if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
          d.moved = true
          const k = SIZE / zoom / svgRef.current!.getBoundingClientRect().width
          setView({ zoom, x: d.vx - (e.clientX - d.x) * k, y: d.vy - (e.clientY - d.y) * k })
        }}
        onPointerUp={() => {
          // A drag is not a click: keep it from selecting or measuring.
          if (drag.current?.moved) setTimeout(() => (drag.current = null))
          else drag.current = null
        }}
        onClick={(e) => {
          if (drag.current?.moved) return
          if (onMeasure) {
            const [ux, uy] = toUnits(e.clientX, e.clientY)
            const m = Math.hypot(ux, uy)
            const r = m === 0 ? 0 : unmap(m)
            onMeasure({ pos: [hostPos[0] + (ux / (m || 1)) * r, hostPos[1] - (uy / (m || 1)) * r, 0] })
            return
          }
          onSelect(null)
        }}
        className={enclosing ? 'inside-collapse' : undefined}
        role="img"
        aria-label="Orbits"
      >
        {rings.map((r) => (
          <g key={r} className="ov-ring">
            <circle r={map(r)} />
            <text x={map(r) * 0.7071 + 3 / zoom} y={-map(r) * 0.7071 - 3 / zoom}>
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
              <text className="ov-label" x={0} y={map(b.extent![1]) + 12 / zoom}>
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
          <circle className="ov-star" r={7 / zoom} fill={`rgb(${starRgb.map((c) => Math.round(c * 255)).join(',')})`} />
        ) : (
          <g>
            <circle className="ov-host" r={6 / zoom} />
            <text className="ov-label" x={9 / zoom} y={4 / zoom}>
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
                if (drag.current?.moved) return
                if (onMeasure) onMeasure({ body: b.id })
                else if (!b.ghost) onSelect(b.id)
              }}
              data-body={b.id}
            >
              <circle r={Math.max(2.5, Math.min(9, 2 + Math.log10(b.radius / 1e6 + 1) * 6)) / px} />
              <text className="ov-label" x={8 / px} y={4 / px}>
                {b.name}
              </text>
            </g>
          ))}
        {contours.map((c) => (
          <path key={`c${c.level}`} className={c.level === 0 ? 'ov-collapse-edge' : 'ov-isoline'} d={c.d} pointerEvents="none">
            {c.level === 0 && <title>The foam collapses inside this line (every body's tide, at the current date)</title>}
          </path>
        ))}
        {center === null && system.collapse && contours.some((c) => c.level === 0) && (
          <text className="ov-collapse-label" x={0} y={-map(system.collapse) - 4 / zoom} textAnchor="middle" pointerEvents="none">
            collapse {sig(system.collapse / AU, 3)} AU
          </text>
        )}
        {measureLine && (
          <g className="ov-measure" pointerEvents="none">
            {(() => {
              const [a, b] = measureLine.map((p) => at(p[0] - hostPos[0], p[1] - hostPos[1]))
              return (
                <>
                  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
                  <circle cx={a[0]} cy={a[1]} r={3 / px} />
                  <circle cx={b[0]} cy={b[1]} r={3 / px} />
                </>
              )
            })()}
          </g>
        )}
      </svg>
      {zoom > 1 && (
        <button className="ov-reset small" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>
          Reset view ({sig(zoom, 2)}×)
        </button>
      )}
      {enclosing && (
        <p className="ov-inside small">
          All of this lies inside {host?.name}’s collapse region, which reaches {enclosing}
        </p>
      )}
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

/**
 * Every body's position relative to the star at time t (m, the system's frame), and the masses for the foam:
 * the star first, then each body with an orbit (belts left out). Null without a star of known mass.
 */
export function systemMasses(system: SystemInfoDto, t: number): { masses: MassPoint[]; ids: string[]; pos: Map<string, Vec3> } | null {
  if (!system.star || system.star.mass === null) return null
  const els = new Map(system.bodies.filter((b) => b.elements && b.cls !== 'belt').map((b) => [b.id, b]))
  const pos = new Map<string, Vec3>()
  const abs = (id: string, guard = 0): Vec3 | null => {
    const hit = pos.get(id)
    if (hit) return hit
    const b = els.get(id)
    if (!b || guard > 20) return null
    const r = stateAt(toElements(b.elements!), t).r
    const p = b.parent ? abs(b.parent, guard + 1) : [0, 0, 0]
    if (!p) return null
    const out: Vec3 = [r[0] + p[0], r[1] + p[1], r[2] + p[2]]
    pos.set(id, out)
    return out
  }
  const masses: MassPoint[] = [{ pos: [0, 0, 0], mass: system.star.mass * M_SUN }]
  const ids = ['']
  for (const id of els.keys()) {
    const p = abs(id)
    if (p) {
      masses.push({ pos: p, mass: els.get(id)!.mass })
      ids.push(id)
    }
  }
  return { masses, ids, pos }
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
