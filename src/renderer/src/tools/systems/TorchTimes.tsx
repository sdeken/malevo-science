import { useMemo, useState } from 'react'
import { AU, C, G0, M_SUN, collapseOutlines, torchTrip, type Vec3 } from '@malevo/core'
import type { PhysicsSummary, SystemInfoDto } from '../../../../shared/types'
import { NumberField, duration, sig } from '../../components/fields'
import { systemMasses } from './OrbitView'

export type MeasurePoint = { body: string } | { pos: Vec3 }

interface Props {
  system: SystemInfoDto
  physics: PhysicsSummary | null
  now: number
  /** Measuring a leg on the orbit view: on, and the points clicked so far. */
  measuring: boolean
  setMeasuring(on: boolean): void
  points: MeasurePoint[]
  setPoints(p: MeasurePoint[]): void
}

interface Leg {
  label: string
  distance: number
}

/**
 * Torch travel times inside a system at the current date: from where ships
 * drop out of the foam (the star's collapse edge) to a body, and any leg
 * measured on the orbit view. Straight lines from rest; the target's motion
 * and gravity are ignored, the tanks are the world's torch settings.
 */
export function TorchTimes({ system, physics, now, measuring, setMeasuring, points, setPoints }: Props): React.JSX.Element | null {
  const torch = physics?.torch
  const [accelG, setAccelG] = useState<number | null>(null)
  const g = accelG ?? torch?.cruiseAccel_g ?? 1
  const planets = system.bodies.filter((b) => b.elements && b.cls !== 'belt')
  const port = typeof system.value.port === 'string' ? system.value.port : null
  const [targetId, setTargetId] = useState<string | null>(null)
  const target = planets.find((b) => b.id === (targetId ?? port)) ?? planets[0] ?? null

  const state = useMemo(() => systemMasses(system, now), [system, now])
  // The star's collapse edge in the system plane (its outer loop), where ships drop out of the foam.
  const edge = useMemo(() => {
    if (!state || !physics) return null
    const s = { collapseRadius: physics.collapseRadius_au * AU, rule: physics.loadRule }
    const star = collapseOutlines(state.masses, s, [0, 0, 0], [1, 0, 0], [0, 1, 0], {
      minRadius: 0.999 * physics.collapseRadius_au * AU * Math.cbrt(state.masses[0].mass / M_SUN),
      grid: 200
    }).find((o) => o.body === 0)
    return star ? star.loops[0] : null
  }, [state, physics])

  if (!state || !physics || !torch) return null
  const posOf = (p: MeasurePoint): Vec3 | null => ('body' in p ? (state.pos.get(p.body) ?? null) : p.pos)
  const nameOf = (p: MeasurePoint): string =>
    'body' in p ? (system.bodies.find((b) => b.id === p.body)?.name ?? p.body) : `(${sig(p.pos[0] / AU, 3)}, ${sig(p.pos[1] / AU, 3)}) AU`
  const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  const legs: Leg[] = []
  const tpos = target ? state.pos.get(target.id) : null
  if (edge && tpos) {
    const d = edge.map((p) => dist(p, tpos))
    legs.push({ label: `Nearest drop → ${target!.name}`, distance: Math.min(...d) })
    legs.push({ label: `Farthest drop → ${target!.name}`, distance: Math.max(...d) })
  }
  if (points.length === 2) {
    const a = posOf(points[0])
    const b = posOf(points[1])
    if (a && b) legs.push({ label: `${nameOf(points[0])} → ${nameOf(points[1])}`, distance: dist(a, b) })
  }

  const accel = g * G0
  const trip = (d: number, stop: boolean) =>
    torchTrip(d, { accel, exhaustSpeed: torch.exhaustSpeed_c * C, propellantFraction: torch.propellantFraction, stop })

  return (
    <div className="torch-times" id="torchTimes">
      <h3>Torch times</h3>
      <div className="field-row">
        <NumberField label="Acceleration, g" value={g} onCommit={(x) => x !== undefined && x > 0 && setAccelG(x)} id="torchAccel" />
        <label className="field">
          To
          <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)} id="torchTarget">
            {planets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={measuring ? 'on' : ''}
          onClick={() => {
            setMeasuring(!measuring)
            if (!measuring) setPoints([])
          }}
          id="measureLeg"
        >
          {measuring
            ? points.length === 0
              ? 'Click the start…'
              : points.length === 1
                ? 'Click the end…'
                : 'Measuring (click to restart)'
            : 'Measure a leg'}
        </button>
      </div>
      {!edge && <p className="muted small">The star has no collapse edge in the system plane to drop from.</p>}
      <table className="data small" id="torchTable">
        <thead>
          <tr>
            <th />
            <th>Distance</th>
            <th title="Light from the start reaching the end: how late the drop is seen">Light</th>
            <th title="Flip halfway, arrive at rest">To stop</th>
            <th title="Burn the whole way, no braking">Flying by</th>
            <th title="Arrival speed when flying by">at</th>
            <th title="From seeing the drop's light to a fly-by arriving">Warning</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((l) => {
            const stop = trip(l.distance, true)
            const by = trip(l.distance, false)
            const light = l.distance / C
            return (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td>{sig(l.distance / AU, 3)} AU</td>
                <td>{duration(light)}</td>
                <td title={stop.limit}>{duration(stop.time)}</td>
                <td title={by.limit}>{duration(by.time)}</td>
                <td>{sig(by.peakSpeed / 1000, 3)} km/s</td>
                <td>
                  <strong>{duration(by.time - light)}</strong>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted small">
        From rest, in a straight line, at the current date; gravity and the target’s motion are ignored. Tanks from the world’s torch
        settings ({sig(torch.exhaustSpeed_c, 2)} c exhaust, {sig(torch.propellantFraction * 100, 2)}% propellant): hover a time to see
        whether the burn or the tanks set it. Warning is the time from when the drop’s light arrives to when a ship burning all the way
        does.
      </p>
    </div>
  )
}
