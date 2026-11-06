import { useEffect, useMemo, useState } from 'react'
import { AU, DEG, G0, burnAllTheWayTime, contourGrid, foamLoad, stateAt, type Vec3 } from '@malevo/core'
import { systemFrame } from '@malevo/model'
import type { ApproachInfoDto, RouteInfoDto, SystemInfoDto, WorldSnapshot } from '../../../../shared/types'
import { duration, sig } from '../../components/fields'
import { systemMasses } from '../systems/OrbitView'

interface Props {
  route: RouteInfoDto
  snapshot: WorldSnapshot
  now: number
}

const PANEL = 340
const GRID = 120

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: readonly number[]): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2])
  return [a[0] / n, a[1] / n, a[2] / n]
}
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]

/**
 * One leg between two star systems, seen side-on: the leg runs left to right,
 * each end drawn in its own panel to the same scale with its plane tilted as
 * it really is against the other's. In each panel the collapse region is cut
 * through the plane that holds the leg (where ships fly), with isolines, and
 * the approach model's drop point and crawl to the port are drawn. Turn the
 * view about the leg to see the planes from another side.
 */
export function LegView({ route, snapshot, now }: Props): React.JSX.Element | null {
  const legs = route.nodes
    .map((n, i) => ({ i, a: n, b: route.nodes[i + 1] ?? null }))
    .filter((l) => l.a?.startsWith('system:') && l.b?.startsWith('system:'))
  const [legIndex, setLegIndex] = useState<number | null>(null)
  const [roll, setRoll] = useState(0)
  const leg = legs.find((l) => l.i === legIndex) ?? legs[0] ?? null
  const sysA = leg ? snapshot.systems.find((s) => `system:${s.id}` === leg.a) : undefined
  const sysB = leg ? snapshot.systems.find((s) => `system:${s.id}` === leg.b) : undefined

  // The view's axes, galactic: e1 along the leg, e2 up the screen (galactic north turned by the roll), about e1.
  const axes = useMemo(() => {
    if (!sysA?.star || !sysB?.star) return null
    const e1 = unit([sysB.star.pos[0] - sysA.star.pos[0], sysB.star.pos[1] - sysA.star.pos[1], sysB.star.pos[2] - sysA.star.pos[2]])
    const n0: Vec3 = Math.abs(e1[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1]
    const up0 = unit(cross(cross(e1, n0), e1))
    const side = cross(e1, up0)
    const c = Math.cos(roll * DEG)
    const s = Math.sin(roll * DEG)
    const e2: Vec3 = [up0[0] * c + side[0] * s, up0[1] * c + side[1] * s, up0[2] * c + side[2] * s]
    return {
      e1,
      e2,
      ly: Math.hypot(sysB.star.pos[0] - sysA.star.pos[0], sysB.star.pos[1] - sysA.star.pos[1], sysB.star.pos[2] - sysA.star.pos[2])
    }
  }, [sysA, sysB, roll])

  // The trip: the departure burn from the origin's port out to the foam, the foam, then the destination's crawl
  // from the drop to its port (flip-and-burn: accelerate to the midpoint, then brake). The destination's approach is
  // worked out at the moment of the drop, so its planets are where the ship finds them.
  const legInfo = leg ? route.legs.find((l) => l.index === leg.i) : undefined
  const foam = legInfo?.foam ?? null
  const [apA, setApA] = useState<ApproachInfoDto | { error: string } | null>(null)
  const [apB, setApB] = useState<ApproachInfoDto | { error: string } | null>(null)
  // Out without stopping: burn the whole way to the foam (the drop at the far end leaves the ship at rest anyway).
  const depart =
    apA && !('error' in apA) && apA.crawlDistance !== null
      ? burnAllTheWayTime(apA.crawlDistance, (snapshot.physics?.torch.cruiseAccel_g ?? 1) * G0)
      : null
  const tDrop = now + (depart ?? 0) + (foam ?? 0)
  useEffect(() => {
    let live = true
    setApA(null)
    if (!sysA || !leg?.b) return
    void window.malevo.approach.info({ system: sysA.id, from: leg.b, t: now }).then((r) => live && setApA(r))
    return () => {
      live = false
    }
  }, [sysA?.id, leg?.b, now, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true
    setApB(null)
    if (!sysB || !leg?.a || !apA) return
    void window.malevo.approach.info({ system: sysB.id, from: leg.a, t: tDrop }).then((r) => live && setApB(r))
    return () => {
      live = false
    }
  }, [sysB?.id, leg?.a, tDrop, apA, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const arrive = apB && !('error' in apB) ? apB.crawl : null

  // Both panels to one scale: room for the larger collapse region.
  const extent = 1.6 * Math.max(sysA?.collapse ?? 0, sysB?.collapse ?? 0, 0.5 * AU)
  if (!legs.length) return null
  return (
    <div className="leg-view" id="legView">
      <h3>A leg, end to end</h3>
      <div className="field-row">
        <label className="field">
          Leg
          <select value={leg?.i ?? ''} onChange={(e) => setLegIndex(Number(e.target.value))} id="legPick">
            {legs.map((l) => (
              <option key={l.i} value={l.i}>
                {nameOf(snapshot, l.a!)} → {nameOf(snapshot, l.b!)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Turn the view about the leg: {roll}°
          <input type="range" min={-180} max={180} step={5} value={roll} onChange={(e) => setRoll(Number(e.target.value))} />
        </label>
      </div>
      {(!sysA?.star || !sysB?.star || !axes) && <p className="muted">Both ends need a star to draw this leg.</p>}
      {sysA?.star && sysB?.star && axes && (
        <>
          <div className="leg-panels">
            <End
              system={sysA}
              approach={apA && !('error' in apA) ? apA : null}
              approachError={apA && 'error' in apA ? apA.error : null}
              axes={axes}
              snapshot={snapshot}
              now={now}
              outbound
              extent={extent}
            />
            <div className="leg-gap muted small">
              <span>{sig(axes.ly, 3)} ly</span>
              <span>→</span>
            </div>
            <End
              system={sysB}
              approach={apB && !('error' in apB) ? apB : null}
              approachError={apB && 'error' in apB ? apB.error : null}
              axes={axes}
              snapshot={snapshot}
              now={tDrop}
              outbound={false}
              extent={extent}
            />
          </div>
          <Stages depart={depart} foam={foam} arrive={arrive} />
          <p className="muted small">
            Seen side-on to the leg, which runs left to right; each system’s plane is tilted as it is against the other’s. Both panels are
            to the same scale. The dashed line is where the foam collapses, cut through the plane that holds the leg, with isolines at 1/8
            to 8 times the collapse load. The origin is drawn at departure (the current date) and the destination at the moment of the drop,
            so each system's planets are where the ship finds them.
          </p>
        </>
      )}
    </div>
  )
}

/** The four stages of the trip, as a bar to scale and their times. */
function Stages({ depart, foam, arrive }: { depart: number | null; foam: number | null; arrive: number | null }): React.JSX.Element {
  const stages = [
    { key: 'depart', label: 'Departure burn', t: depart, note: 'from the port out to the foam, burning the whole way (no braking)' },
    { key: 'foam', label: 'Foam', t: foam, note: 'between the stars' },
    { key: 'accel', label: 'Acceleration burn', t: arrive === null ? null : arrive / 2, note: 'from the drop to the flip' },
    { key: 'decel', label: 'Deceleration burn', t: arrive === null ? null : arrive / 2, note: 'from the flip to insertion at the port' }
  ]
  const known = stages.every((s) => s.t !== null)
  const total = stages.reduce((a, s) => a + (s.t ?? 0), 0)
  return (
    <div className="leg-stages" id="legStages">
      {known && total > 0 && (
        <div className="leg-bar">
          {stages.map((s) => (
            <span
              key={s.key}
              className={`leg-seg leg-st-${s.key}`}
              style={{ flexGrow: s.t! / total }}
              title={`${s.label}: ${duration(s.t)}`}
            />
          ))}
        </div>
      )}
      <table className="data small">
        <tbody>
          {stages.map((s) => (
            <tr key={s.key}>
              <td>
                <span className={`leg-swatch leg-st-${s.key}`} /> {s.label}
              </td>
              <td>{s.t === null ? '…' : duration(s.t)}</td>
              <td className="muted">{s.note}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>Port to port</strong>
            </td>
            <td>
              <strong>{known ? duration(total) : '…'}</strong>
            </td>
            <td className="muted">at the world's cruise acceleration, from rest in orbit to rest in orbit</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function nameOf(snapshot: WorldSnapshot, node: string): string {
  const id = node.slice('system:'.length)
  return snapshot.systems.find((s) => s.id === id)?.name ?? id
}

function End({
  system,
  approach,
  approachError,
  axes,
  snapshot,
  now,
  outbound,
  extent
}: {
  /** Half the panel's width, m: the same for both ends. */
  extent: number
  system: SystemInfoDto
  approach: ApproachInfoDto | null
  approachError: string | null
  axes: { e1: Vec3; e2: Vec3 }
  snapshot: WorldSnapshot
  /** When this end is drawn: departure at the origin, the drop at the destination. */
  now: number
  outbound: boolean
}): React.JSX.Element {
  const f = systemFrame(system.value as { frame?: { poleL_deg: number; poleB_deg: number; zero_deg?: number } })
  /** System frame → galactic. */
  const toG = (v: readonly number[]): Vec3 => [
    v[0] * f.x[0] + v[1] * f.y[0] + v[2] * f.z[0],
    v[0] * f.x[1] + v[1] * f.y[1] + v[2] * f.z[1],
    v[0] * f.x[2] + v[1] * f.y[2] + v[2] * f.z[2]
  ]
  const k = PANEL / 2 / extent
  const proj = (v: readonly number[]): [number, number] => {
    const g = toG(v)
    return [dot(g, axes.e1) * k, -dot(g, axes.e2) * k]
  }
  const state = useMemo(() => systemMasses(system, now), [system, now])

  // The collapse region, cut through the plane of the screen (it holds the leg) through the star.
  const contours = useMemo(() => {
    const phys = snapshot.physics
    if (!state || !phys) return []
    const s = { collapseRadius: phys.collapseRadius_au * AU, rule: phys.loadRule }
    const h = (2 * extent) / GRID
    const vals = new Float64Array((GRID + 1) * (GRID + 1))
    for (let a = 0; a <= GRID; a++)
      for (let b = 0; b <= GRID; b++) {
        const X = -extent + b * h
        const Y = extent - a * h
        const g: Vec3 = [X * axes.e1[0] + Y * axes.e2[0], X * axes.e1[1] + Y * axes.e2[1], X * axes.e1[2] + Y * axes.e2[2]]
        const p: Vec3 = [dot(g, f.x), dot(g, f.y), dot(g, f.z)]
        const L = foamLoad(p, state.masses, s)
        vals[a * (GRID + 1) + b] = Number.isNaN(L) || L === Infinity ? 700 : L > 0 ? Math.log(L) : -700
      }
    return [-3, -2, -1, 0, 1, 2, 3].map((n) => ({
      level: n,
      d: contourGrid(vals, GRID, GRID, -extent * k, -extent * k, h * k, h * k, n * Math.LN2)
        .map((l) => 'M ' + l.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L '))
        .join(' ')
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, snapshot.physics, axes, extent])

  const planets = system.bodies.filter((b) => b.elements && !b.parent && b.cls !== 'belt')
  const orbitPath = (b: (typeof planets)[number]): string => {
    const e = b.elements!
    const el = { a: e.a, e: e.e, i: e.i, node: e.node, peri: e.peri, meanAnomaly: 0, epoch: 0, mu: e.mu }
    const pts: string[] = []
    for (let n = 0; n <= 180; n++) {
      const p = proj(stateAt({ ...el, meanAnomaly: (2 * Math.PI * n) / 180 }, 0).r)
      pts.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    }
    return 'M ' + pts.join(' L ')
  }
  const normal = proj([0, 0, 0.25 * extent])
  const tilt = Math.asin(Math.max(-1, Math.min(1, Math.abs(dot(axes.e1, toG([0, 0, 1])))))) / DEG
  const drop = approach?.drop ? proj(approach.drop) : null
  const port = approach ? proj(approach.port) : null
  const edgeX = outbound ? PANEL / 2 : -PANEL / 2

  return (
    <div className="leg-end" data-leg-end={system.id}>
      <svg width={PANEL} height={PANEL} viewBox={`${-PANEL / 2} ${-PANEL / 2} ${PANEL} ${PANEL}`} role="img" aria-label={system.name}>
        {contours.map((c) => (
          <path key={c.level} d={c.d} className={c.level === 0 ? 'ov-collapse-edge' : 'ov-isoline'} />
        ))}
        {planets.map((b) => (
          <path key={b.id} d={orbitPath(b)} className="ov-orbit" />
        ))}
        {/* The system's north pole (a quarter of the panel long), so its plane's tilt reads at a glance. */}
        <line x1={0} y1={0} x2={normal[0]} y2={normal[1]} className="leg-pole" />
        {drop && port && (
          <g className="leg-path">
            <line x1={edgeX} y1={drop[1]} x2={drop[0]} y2={drop[1]} className="leg-foam" />
            <line x1={drop[0]} y1={drop[1]} x2={port[0]} y2={port[1]} className="leg-crawl" />
            <circle cx={drop[0]} cy={drop[1]} r={3.5} className="leg-drop" />
          </g>
        )}
        {state &&
          planets.map((b) => {
            const p = state.pos.get(b.id)
            if (!p) return null
            const q = proj(p)
            return (
              <g key={`p-${b.id}`} className={`ov-body ov-${b.cls}`} transform={`translate(${q[0]} ${q[1]})`}>
                <circle r={b.cls.endsWith('giant') ? 4 : 2.5} />
                {(b.cls.endsWith('giant') || b.id === (system.value.port as string)) && (
                  <text className="ov-label" x={6} y={3}>
                    {b.name}
                  </text>
                )}
              </g>
            )
          })}
        <circle r={5} className="ov-star" fill="#ffe9b0" />
      </svg>
      <div className="small">
        <strong>{system.name}</strong> · the leg runs {sig(tilt, 2)}° {tilt < 0.5 ? '(in its plane)' : 'out of its plane'}
        {approachError && <div className="error">{approachError}</div>}
        {approach && (
          <div className="muted">
            {outbound ? 'Leaves the foam' : 'Drops out'} {approach.dropRadius !== null ? `${sig(approach.dropRadius / AU, 3)} AU out` : '—'}
            ; crawl {approach.crawl !== null ? duration(approach.crawl) : '—'}
            {approach.leeGain !== null && approach.leeGain > 0.005 && <> · the lee saves {sig(approach.leeGain * 100, 2)}%</>}
          </div>
        )}
      </div>
    </div>
  )
}
