import { useEffect, useState } from 'react'
import { C, G0 } from '@malevo/core'
import { newShip, type ShipFile } from '@malevo/model'
import type { TripBurnDto, TripPlanDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * The trip planner: a particular ship (its masses, thrust, tanks and reserve)
 * flying a charted route, leg by leg, against the route planner's idealized
 * times. Ships are world files, ships/<id>.json.
 */
function TripsView({ world, snapshot, now }: ToolProps): React.JSX.Element {
  const [shipId, setShipId] = useWorldPref<string | null>(world.root, 'tripShip', null)
  const ship = snapshot.ships.find((s) => s.id === shipId) ?? snapshot.ships[0] ?? null
  return (
    <div className="split-tool trips">
      <nav className="split-list">
        <h2>Trip planner</h2>
        <ul>
          {snapshot.ships.map((s) => (
            <li key={s.id}>
              <button className={s.id === ship?.id ? 'list-item is-current' : 'list-item'} onClick={() => setShipId(s.id)} data-ship={s.id}>
                <span>{String(s.value?.name ?? s.id)}</span>
                <span className="muted small">
                  {s.value ? `${sig(Number(s.value.dryMass_t) + Number(s.value.propellant_t), 3)} t full` : 'has errors'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <NewShip snapshot={snapshot} onMade={setShipId} />
      </nav>
      <div className="tool-page wide">
        {!ship?.value ? (
          <>
            <h1>Trip planner</h1>
            <p className="muted">
              The route planner gives idealized times: the world’s cruise acceleration, tanks that never run short. Here a particular ship
              flies a charted route: its own thrust, tanks and reserve, refuelling at every port. Add a ship to start.
            </p>
          </>
        ) : (
          <>
            <ShipEditor key={ship.id} id={ship.id} ship={ship.value as unknown as ShipFile} snapshot={snapshot} />
            <Trip shipId={ship.id} snapshot={snapshot} now={now} rootKey={world.root} />
          </>
        )}
      </div>
    </div>
  )
}

function NewShip({ snapshot, onMade }: { snapshot: WorldSnapshot; onMade(id: string): void }): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        const id = slugId(
          name,
          snapshot.ships.map((s) => s.id)
        )
        void window.malevo.world.setEntity('ship', id, newShip(name.trim())).then(() => onMade(id))
        setName('')
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New ship…" id="newShipName" />
      <button type="submit" disabled={!name.trim()} id="newShip">
        Add
      </button>
    </form>
  )
}

function ShipEditor({ id, ship, snapshot }: { id: string; ship: ShipFile; snapshot: WorldSnapshot }): React.JSX.Element {
  const save = (patch: Partial<ShipFile>): void => {
    const next = { ...ship, ...patch } as Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    void window.malevo.world.setEntity('ship', id, next)
  }
  const pos = (f: (x: number) => void) => (x: number | undefined) => x !== undefined && x > 0 && f(x)
  const torch = snapshot.physics?.torch
  const exhaust = (ship.exhaustSpeed_c ?? torch?.exhaustSpeed_c ?? 0.05) * C
  const dry = ship.dryMass_t * 1000
  const full = dry + ship.propellant_t * 1000
  const thrust = ship.thrust_MN * 1e6
  const comfort = (ship.comfort_g ?? torch?.cruiseAccel_g ?? 1) * G0
  const dv = exhaust * Math.log(full / dry)
  const reserveKg = Math.max(
    (ship.reserve.share ?? 0) * ship.propellant_t * 1000,
    dry * (Math.exp(((ship.reserve.dv_kms ?? 0) * 1000) / exhaust) - 1)
  )
  const usable = exhaust * Math.log(full / (dry + reserveKg))
  const burnFull = (ship.propellant_t * 1000 * exhaust) / Math.min(thrust, comfort * full)
  return (
    <section className="ship-editor" id="shipEditor">
      <div className="field-row">
        <TextField label="Ship" value={ship.name} onCommit={(v) => v.trim() && save({ name: v.trim() })} id="shipName" />
      </div>
      <div className="field-row">
        <NumberField label="Dry mass, t" value={ship.dryMass_t} onCommit={pos((x) => save({ dryMass_t: x }))} id="shipDry" />
        <NumberField
          label="Propellant, t (full tanks)"
          value={ship.propellant_t}
          onCommit={pos((x) => save({ propellant_t: x }))}
          id="shipProp"
        />
        <NumberField label="Thrust, MN" value={ship.thrust_MN} onCommit={pos((x) => save({ thrust_MN: x }))} id="shipThrust" />
        <NumberField
          label="Comfort cap, g"
          value={ship.comfort_g}
          optional
          placeholder={`${torch?.cruiseAccel_g ?? 1} (world)`}
          onCommit={(x) => save({ comfort_g: x !== undefined && x > 0 ? x : undefined })}
        />
        <NumberField
          label="Exhaust speed, c"
          value={ship.exhaustSpeed_c}
          optional
          placeholder={`${torch?.exhaustSpeed_c ?? 0.05} (world)`}
          onCommit={(x) => save({ exhaustSpeed_c: x !== undefined && x > 0 && x <= 1 ? x : undefined })}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Reserve, share of tanks"
          value={ship.reserve.share}
          optional
          onCommit={(x) => save({ reserve: { ...ship.reserve, share: x !== undefined ? Math.max(0, Math.min(1, x)) : undefined } })}
          id="shipReserve"
        />
        <NumberField
          label="…or Δv kept for insertion, km/s"
          value={ship.reserve.dv_kms}
          optional
          onCommit={(x) => save({ reserve: { ...ship.reserve, dv_kms: x !== undefined ? Math.max(0, x) : undefined } })}
        />
        <NumberField
          label="Foam power, GW"
          value={ship.foamPower_GW}
          optional
          placeholder="0"
          hint="Fusion fuel burned to make and hold the foam"
          onCommit={(x) => save({ foamPower_GW: x !== undefined ? Math.max(0, x) : undefined })}
        />
        <NumberField
          label="Torch in the foam, share of thrust"
          value={ship.foamThrottle}
          optional
          placeholder="0"
          hint="Run to dump heat"
          onCommit={(x) => save({ foamThrottle: x !== undefined ? Math.max(0, Math.min(1, x)) : undefined })}
        />
        <NumberField
          label="Refuelling, t/hour"
          value={ship.refuel_tph}
          optional
          placeholder="500"
          onCommit={(x) => save({ refuel_tph: x !== undefined && x > 0 ? x : undefined })}
        />
      </div>
      <p className="muted small" id="shipFacts">
        Full: {sig(full / 1000, 4)} t, {sig(Math.min(thrust / full, comfort) / G0, 3)} g · dry:{' '}
        {sig(Math.min(thrust / dry, comfort) / G0, 3)} g{thrust / full < comfort && ' (thrust-limited when full)'} · Δv {sig(dv / 1000, 4)}{' '}
        km/s full, {sig(usable / 1000, 4)} km/s above the reserve · about {duration(burnFull)} of burning on a full tank
      </p>
    </section>
  )
}

function Trip({
  shipId,
  snapshot,
  now,
  rootKey
}: {
  shipId: string
  snapshot: WorldSnapshot
  now: number
  rootKey: string
}): React.JSX.Element {
  const [routeId, setRouteId] = useWorldPref<string | null>(rootKey, 'tripRoute', null)
  const route = snapshot.routes.find((r) => r.id === routeId) ?? snapshot.routes[0] ?? null
  const n = route?.nodes.length ?? 0
  const [ends, setEnds] = useState<[number, number]>([0, 1])
  const from = Math.min(ends[0], Math.max(0, n - 1))
  const to = Math.min(ends[1], Math.max(0, n - 1))
  const [plan, setPlan] = useState<TripPlanDto | { error: string } | null>(null)
  useEffect(() => {
    if (!route || from === to) {
      setPlan(null)
      return
    }
    let live = true
    void window.malevo.trips.plan({ ship: shipId, route: route.id, from, to, t: now }).then((r) => live && setPlan(r))
    return () => {
      live = false
    }
  }, [shipId, route?.id, from, to, now, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!route) return <p className="muted">There are no routes yet: the trip planner flies charted routes. Make one in the Routes tool.</p>
  const name = (i: number): string => {
    const node = route.nodes[i]
    return node ? (snapshot.nodes[node]?.name ?? node) : `waypoint ${i + 1}`
  }
  return (
    <section className="trip" id="trip">
      <h2>A trip</h2>
      <div className="field-row">
        <label className="field">
          Route
          <select value={route.id} onChange={(e) => setRouteId(e.target.value)} id="tripRoute">
            {snapshot.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <select value={from} onChange={(e) => setEnds([Number(e.target.value), to])} id="tripFrom">
            {route.nodes.map((_, i) => (
              <option key={i} value={i}>
                {name(i)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          To
          <select value={to} onChange={(e) => setEnds([from, Number(e.target.value)])} id="tripTo">
            {route.nodes.map((_, i) => (
              <option key={i} value={i}>
                {name(i)}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">Leaving at the current date.</span>
      </div>
      {from === to && <p className="muted">Pick two different waypoints.</p>}
      {plan && 'error' in plan && <p className="error">{plan.error}</p>}
      {plan && !('error' in plan) && <TripResult plan={plan} />}
    </section>
  )
}

const span = (b: TripBurnDto | null): number => (b ? b.accel.time + b.coast.time + b.decel.time : 0)
const tonnes = (kg: number): string => `${sig(kg / 1000, 3)} t`

function BurnCell({ b }: { b: TripBurnDto | null }): React.JSX.Element {
  if (!b) return <span className="muted">—</span>
  return (
    <span title={`Speeding up ${duration(b.accel.time)}, coasting ${duration(b.coast.time)}, slowing ${duration(b.decel.time)}`}>
      {duration(span(b))}
      <span className="muted small">
        {' '}
        · {sig(b.peakSpeed / 1000, 3)} km/s{b.coast.time > 60 ? `, coasting ${duration(b.coast.time)}` : ''} · {tonnes(b.propellant)}
      </span>
    </span>
  )
}

function TripResult({ plan }: { plan: TripPlanDto }): React.JSX.Element {
  return (
    <div className="trip-result" id="tripResult">
      <p>
        <strong>{duration(plan.total)}</strong> port to port for the {plan.shipName}
        {plan.ideal !== null && (
          <span className="muted">
            {' '}
            · idealized {duration(plan.ideal)} (no waiting to refuel, the world’s cruise acceleration, tanks never short)
          </span>
        )}
      </p>
      <TripChart plan={plan} />
      {plan.problems.map((p) => (
        <p key={p} className="error">
          {p}
        </p>
      ))}
      <table className="data small" id="tripTable">
        <thead>
          <tr>
            <th>Leg</th>
            <th>Departure burn</th>
            <th>Foam</th>
            <th>Arrival burn</th>
            <th>Propellant</th>
            <th>Leg time</th>
            <th>Then</th>
          </tr>
        </thead>
        <tbody>
          {plan.legs.map((l, k) => (
            <tr key={k} data-trip-leg={k}>
              <td>
                {l.fromName} → {l.toName}
                {l.speedCap !== null && l.speedCap > 0 && (
                  <div className="warning small">tanks hold it to {sig(l.speedCap / 1000, 3)} km/s</div>
                )}
                {l.problems.map((p) => (
                  <div key={p} className="error small">
                    {p}
                  </div>
                ))}
              </td>
              <td>
                <BurnCell b={l.depart} />
              </td>
              <td>
                {duration(l.foam.time)}
                {l.foam.propellant > 0 && <span className="muted small"> · {tonnes(l.foam.propellant)}</span>}
              </td>
              <td>
                <BurnCell b={l.arrive} />
              </td>
              <td>
                {tonnes(l.propellantStart)} → {tonnes(l.propellantEnd)}
              </td>
              <td>
                {duration(l.arrives - l.departs)}
                {l.ideal !== null && <div className="muted small">idealized {duration(l.ideal)}</div>}
              </td>
              <td>{l.refuel ? `refuel ${tonnes(l.refuel.propellant)}, ${duration(l.refuel.time)}` : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Each leg is flown on what is in the tanks at its start, refuelling at every port and station. Burns run at the ship’s thrust over
        its current mass, up to its comfort cap. When the tanks cannot cover flip-and-burn and still arrive with the reserve, the ship holds
        a lower cruise speed and coasts. Hover a burn for its parts.
      </p>
    </div>
  )
}

// ---- the trip as a picture ----

type PhaseKind = 'accel' | 'coast' | 'decel' | 'foam' | 'refuel'

interface Phase {
  kind: PhaseKind
  t0: number
  t1: number
  /** Speed at each end, m/s (null in the foam: off this chart). */
  v0: number | null
  v1: number | null
  /** Propellant at each end, kg. */
  p0: number
  p1: number
}

const PHASE: Record<PhaseKind, { label: string; color: string }> = {
  accel: { label: 'speeding up', color: '#4fa38a' },
  coast: { label: 'coasting', color: '#9fc2b6' },
  decel: { label: 'braking', color: '#2f7462' },
  foam: { label: 'in the foam', color: '#6a7fd6' },
  refuel: { label: 'refuelling', color: '#b3a68c' }
}

/** The trip's events in time order, from the plan. */
function phasesOf(plan: TripPlanDto): Phase[] {
  const out: Phase[] = []
  const push = (kind: PhaseKind, t0: number, dt: number, v0: number | null, v1: number | null, p0: number, p1: number): number => {
    if (dt > 0) out.push({ kind, t0, t1: t0 + dt, v0, v1, p0, p1 })
    return t0 + dt
  }
  plan.legs.forEach((l, k) => {
    let t = l.departs - plan.departs
    let p = l.propellantStart
    const burn = (b: TripBurnDto | null): void => {
      if (!b) return
      t = push('accel', t, b.accel.time, 0, b.peakSpeed, p, p - b.accelPropellant)
      p -= b.accelPropellant
      t = push('coast', t, b.coast.time, b.peakSpeed, b.peakSpeed, p, p)
      const dec = b.propellant - b.accelPropellant
      t = push('decel', t, b.decel.time, b.peakSpeed, 0, p, p - dec)
      p -= dec
    }
    burn(l.depart)
    t = push('foam', t, l.foam.time, null, null, p, p - l.foam.propellant)
    p -= l.foam.propellant
    burn(l.arrive)
    if (l.refuel) push('refuel', t, l.refuel.time, 0, 0, p, plan.legs[k + 1]?.propellantStart ?? p + l.refuel.propellant)
  })
  return out
}

/**
 * The trip in one picture, on one time axis: above, the route (each system,
 * the crawl out to where the ship lifts into the foam, the foam, the drop and
 * the crawl in); below, what the ship is doing (shaded), its speed (solid)
 * and the propellant left (dashed).
 */
function TripChart({ plan }: { plan: TripPlanDto }): React.JSX.Element | null {
  const phases = phasesOf(plan)
  if (!phases.length || plan.total <= 0) return null
  const W = 900
  const PAD = 46
  const STRIP = 78
  const H = 170
  const AXIS = 22
  const x = (t: number): number => PAD + (t / plan.total) * (W - 2 * PAD)
  const vMax = Math.max(...phases.flatMap((p) => [p.v0 ?? 0, p.v1 ?? 0]), 1) * 1.12
  const pMax = Math.max(...phases.flatMap((p) => [p.p0, p.p1]), 1) * 1.05
  const yv = (v: number): number => STRIP + H - (v / vMax) * H
  const yp = (p: number): number => STRIP + H - (p / pMax) * H
  const days = plan.total / 86400
  const step = days <= 4 ? 0.5 : days <= 12 ? 1 : days <= 40 ? 5 : days <= 120 ? 10 : 30
  const ticks: number[] = []
  for (let d = 0; d <= days + 1e-9; d += step) ticks.push(d)
  const speedPath = phases
    .filter((p) => p.v0 !== null)
    .map((p) => `M ${x(p.t0).toFixed(1)} ${yv(p.v0!).toFixed(1)} L ${x(p.t1).toFixed(1)} ${yv(p.v1!).toFixed(1)}`)
    .join(' ')
  const fuelPath = phases
    .map((p, k) => `${k ? 'L' : 'M'} ${x(p.t0).toFixed(1)} ${yp(p.p0).toFixed(1)} L ${x(p.t1).toFixed(1)} ${yp(p.p1).toFixed(1)}`)
    .join(' ')
  const yMid = STRIP / 2 + 6
  return (
    <div className="trip-chart-box">
      <svg className="trip-chart" viewBox={`0 0 ${W} ${STRIP + H + AXIS + 8}`} role="img" aria-label="The trip, in time" id="tripChart">
        {/* What the ship is doing, shaded across the chart. */}
        {phases.map((p, k) => (
          <g key={k}>
            <rect x={x(p.t0)} y={STRIP} width={Math.max(0.8, x(p.t1) - x(p.t0))} height={H} fill={PHASE[p.kind].color} opacity={0.22}>
              <title>
                {PHASE[p.kind].label}: {duration(p.t1 - p.t0)}
              </title>
            </rect>
            {x(p.t1) - x(p.t0) > 64 && (
              <text className="trip-phase-label" x={(x(p.t0) + x(p.t1)) / 2} y={STRIP + H - 7} textAnchor="middle">
                {PHASE[p.kind].label}
              </text>
            )}
          </g>
        ))}
        {/* The route above, on the same time axis. */}
        {plan.legs.map((l, k) => {
          const t0 = l.departs - plan.departs
          const lift = t0 + (l.depart ? l.depart.accel.time + l.depart.coast.time : 0)
          const drop = lift + l.foam.time
          const end = l.arrives - plan.departs
          return (
            <g key={`leg-${k}`} className="trip-strip">
              <line x1={x(t0)} y1={yMid} x2={x(lift)} y2={yMid} className="crawl" />
              <line x1={x(lift)} y1={yMid} x2={x(drop)} y2={yMid} className="foam" />
              <line x1={x(drop)} y1={yMid} x2={x(end)} y2={yMid} className="crawl" />
              <line x1={x(lift)} y1={yMid - 9} x2={x(lift)} y2={yMid + 9} className="edge" />
              <line x1={x(drop)} y1={yMid - 9} x2={x(drop)} y2={yMid + 9} className="edge" />
              {x(drop) - x(lift) > 34 ? (
                <>
                  <text x={x(lift)} y={yMid + 22} textAnchor="middle" className="small-label">
                    lift
                  </text>
                  <text x={x(drop)} y={yMid + 22} textAnchor="middle" className="small-label">
                    drop
                  </text>
                </>
              ) : (
                <text x={(x(lift) + x(drop)) / 2} y={yMid + 22} textAnchor="middle" className="small-label">
                  lift · drop
                </text>
              )}
              <text x={(x(lift) + x(drop)) / 2} y={yMid - 13} textAnchor="middle" className="small-label foam-label">
                {duration(l.foam.time)} in the foam
              </text>
              {k === 0 && <System x={x(t0)} y={yMid} name={l.fromName} />}
              <System x={x(end)} y={yMid} name={l.toName} />
              {l.refuel && (
                <line x1={x(end)} y1={yMid + 30} x2={x(end + l.refuel.time)} y2={yMid + 30} className="refuel">
                  <title>
                    Refuelling at {l.toName}: {duration(l.refuel.time)}
                  </title>
                </line>
              )}
            </g>
          )
        })}
        {/* Speed (solid) and propellant (dashed). */}
        <path d={fuelPath} className="trip-fuel" />
        <path d={speedPath} className="trip-speed" />
        <line x1={PAD} y1={STRIP + H} x2={W - PAD} y2={STRIP + H} className="trip-axis" />
        {ticks.map((d) => (
          <g key={d}>
            <line x1={x(d * 86400)} y1={STRIP + H} x2={x(d * 86400)} y2={STRIP + H + 4} className="trip-axis" />
            <text x={x(d * 86400)} y={STRIP + H + 16} textAnchor="middle" className="small-label">
              {d === 0 ? 'day 0' : sig(d, 3)}
            </text>
          </g>
        ))}
        <line x1={PAD} y1={yv(vMax / 1.12)} x2={PAD + 6} y2={yv(vMax / 1.12)} className="trip-axis" />
        <text x={PAD + 9} y={yv(vMax / 1.12) + 4} className="small-label speed-label">
          {sig(vMax / 1.12 / 1000, 3)} km/s
        </text>
        <text x={W - PAD - 4} y={yp(pMax / 1.05) - 5} textAnchor="end" className="small-label fuel-label">
          {sig(pMax / 1.05 / 1000, 3)} t propellant
        </text>
        <text x={W - PAD} y={STRIP + H + 16} textAnchor="end" className="small-label">
          days
        </text>
      </svg>
      <div className="trip-legend small">
        {(Object.keys(PHASE) as PhaseKind[]).map((k) => (
          <span key={k}>
            <span className="swatch" style={{ background: PHASE[k].color }} /> {PHASE[k].label}
          </span>
        ))}
        <span>
          <span className="line speed" /> speed
        </span>
        <span>
          <span className="line fuel" /> propellant left
        </span>
      </div>
    </div>
  )
}

function System({ x, y, name }: { x: number; y: number; name: string }): React.JSX.Element {
  return (
    <g className="trip-system">
      <circle cx={x} cy={y} r={15} className="ring" />
      <circle cx={x} cy={y} r={4.5} className="star" />
      <text x={x} y={y - 22} textAnchor="middle">
        {name}
      </text>
    </g>
  )
}

export const tripsTool: ToolDefinition = {
  id: 'trips',
  title: 'Trip planner',
  description: 'A particular ship flying a charted route: its thrust, tanks and reserve, against the idealized times',
  View: TripsView
}
