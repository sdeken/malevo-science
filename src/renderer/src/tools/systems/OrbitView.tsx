import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AU, stateAt, type OrbitalElements } from '@malevo/core'
import type { ElementsInfo, SystemInfoDto } from '../../../../shared/types'
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
 * orbits, where each body is now, the habitable zone (green band) and the
 * collapse radius around the star, inside which the foam fails (dashed).
 */
export function OrbitView({ system, now, selected, onSelect, center, bodies, scale }: Props): React.JSX.Element {
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
        {center === null && system.collapse && (
          <g className="ov-collapse">
            <circle r={map(system.collapse)}>
              <title>The foam collapses inside this radius</title>
            </circle>
            <text x={0} y={-map(system.collapse) - 4}>
              collapse {sig(system.collapse / AU, 3)} AU
            </text>
          </g>
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
