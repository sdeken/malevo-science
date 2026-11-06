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

export const tripsTool: ToolDefinition = {
  id: 'trips',
  title: 'Trip planner',
  description: 'A particular ship flying a charted route: its thrust, tanks and reserve, against the idealized times',
  View: TripsView
}
