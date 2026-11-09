import {
  DESIGN_DEFAULTS,
  DESIGN_LABELS,
  applyDesign,
  designAssumptions,
  designReport,
  newDesign,
  newShip,
  type DesignAssumptions,
  type PhysicsSettings,
  type ShipDesign,
  type ShipFile
} from '@malevo/model'
import { useState } from 'react'
import type { WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

const G0 = 9.80665
const C_KMS = 299792.458

/**
 * The Shipyard: a ship built from parts. What each part weighs, how much
 * power goes into the jet, how much heat is left for the radiators. The ship's
 * flying numbers (dry mass, propellant, engines, thrust, exhaust speed) follow
 * from the design, so the trip planner flies what you built.
 */
function ShipyardView({ world, snapshot, navigate }: ToolProps): React.JSX.Element {
  const [shipId, setShipId] = useWorldPref<string | null>(world.root, 'shipyardShip', null)
  const ship = snapshot.ships.find((s) => s.id === shipId) ?? snapshot.ships[0] ?? null
  const physics = (snapshot.physicsSettings as unknown as PhysicsSettings | null) ?? null
  return (
    <div className="split-tool shipyard">
      <nav className="split-list">
        <h2>Shipyard</h2>
        <ul>
          {snapshot.ships.map((s) => (
            <li key={s.id}>
              <button
                className={s.id === ship?.id ? 'list-item is-current' : 'list-item'}
                onClick={() => setShipId(s.id)}
                data-yard-ship={s.id}
              >
                <span>{String(s.value?.name ?? s.id)}</span>
                <span className="muted small">{s.value ? (s.value.design ? 'designed' : 'no design yet') : 'has errors'}</span>
              </button>
            </li>
          ))}
        </ul>
        <NewDesign snapshot={snapshot} physics={physics} onMade={setShipId} />
      </nav>
      <div className="tool-page wide">
        {!ship?.value ? (
          <>
            <h1>Shipyard</h1>
            <p className="muted">
              Build a ship from parts: hull, crew, hold, tanks, torches, power plant, radiators. The yard works out what it weighs, how hard
              it can burn, how far its tanks take it, and whether its radiators can shed the heat. The trip planner then flies what you
              built.
            </p>
          </>
        ) : (
          <ShipDesigner key={ship.id} id={ship.id} ship={ship.value as unknown as ShipFile} physics={physics} navigate={navigate} />
        )}
        <Assumptions physics={physics} />
      </div>
    </div>
  )
}

function NewDesign({
  snapshot,
  physics,
  onMade
}: {
  snapshot: WorldSnapshot
  physics: PhysicsSettings | null
  onMade(id: string): void
}): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        const id = slugId(
          name,
          snapshot.ships.map((s) => s.id)
        )
        const ship = applyDesign({ ...newShip(name.trim()), foamPower_GW: 20, design: newDesign() }, physics)
        void window.malevo.world.setEntity('ship', id, clean(ship)).then(() => onMade(id))
        setName('')
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New ship…" id="newDesignName" />
      <button type="submit" disabled={!name.trim()} id="newDesign">
        Add
      </button>
    </form>
  )
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** A design that matches a ship's existing numbers, with the hull taking up whatever mass is left. */
function designFromShip(ship: ShipFile, physics: PhysicsSettings | null): ShipDesign {
  const base: ShipDesign = {
    hull_t: 0,
    crew: 12,
    cargo_t: 0,
    tanks_t: ship.propellant_t,
    torches: { count: ship.engines ?? 1, thrust_MN: ship.thrust_MN, exhaust_c: ship.exhaustSpeed_c },
    plant_GW: Math.ceil((ship.foamPower_GW ?? 0) * 1.2 + 1),
    radiators_m2: 0
  }
  const first = designReport(base, ship, physics)
  base.radiators_m2 = Math.ceil(first.radiatorsNeeded_m2 / 1000) * 1000
  const second = designReport(base, ship, physics)
  base.hull_t = Math.max(0, Math.round(ship.dryMass_t - second.dry_t))
  return base
}

function ShipDesigner({
  id,
  ship,
  physics,
  navigate
}: {
  id: string
  ship: ShipFile
  physics: PhysicsSettings | null
  navigate: ToolProps['navigate']
}): React.JSX.Element {
  const save = (next: ShipFile): void => void window.malevo.world.setEntity('ship', id, clean(applyDesign(next, physics)))
  if (!ship.design)
    return (
      <section className="designer" id="designer">
        <h1>{ship.name}</h1>
        <p className="muted">
          This ship has numbers (dry mass, tanks, thrust) but no design. Start one from them: the hull takes up whatever mass the parts
          don’t.
        </p>
        <button className="primary" onClick={() => save({ ...ship, design: designFromShip(ship, physics) })} id="startDesign">
          Design it from its numbers
        </button>
      </section>
    )
  const d = ship.design
  const set = (patch: Partial<ShipDesign>): void => save({ ...ship, design: { ...d, ...patch } })
  const r = designReport(d, ship, physics)
  const a = designAssumptions(physics)
  const pos = (f: (x: number) => void) => (x: number | undefined) => x !== undefined && x >= 0 && f(x)
  const exhaust = r.exhaust_c * C_KMS
  const maxPart = Math.max(...r.parts.map((p) => p.mass_t), 1)
  return (
    <section className="designer" id="designer">
      <div className="field-row">
        <TextField label="Ship" value={ship.name} onCommit={(v) => v.trim() && save({ ...ship, name: v.trim() })} id="designName" />
        <button onClick={() => navigate('trips', id)}>Fly it in the trip planner</button>
      </div>

      <div className="design-grid">
        <div className="design-parts">
          <h3>Hull and people</h3>
          <div className="field-row">
            <NumberField label="Hull and frame, t" value={d.hull_t} onCommit={pos((hull_t) => set({ hull_t }))} id="dHull" />
            <NumberField label="People aboard" value={d.crew} onCommit={pos((crew) => set({ crew: Math.round(crew) }))} id="dCrew" />
            <NumberField
              label="Armour and shielding, t"
              value={d.shielding_t}
              optional
              onCommit={(x) => set({ shielding_t: x && x > 0 ? x : undefined })}
              id="dShield"
            />
          </div>
          <h3>Cargo</h3>
          <div className="field-row">
            <NumberField label="Hold takes, t" value={d.cargo_t} onCommit={pos((cargo_t) => set({ cargo_t }))} id="dCargo" />
            <NumberField
              label="Aboard for trips, t"
              value={d.load_t}
              optional
              onCommit={(x) => set({ load_t: x && x > 0 ? x : undefined })}
              id="dLoad"
            />
          </div>
          <h3>Propellant</h3>
          <div className="field-row">
            <NumberField
              label="Tanks hold, t"
              value={d.tanks_t}
              onCommit={(x) => x !== undefined && x > 0 && set({ tanks_t: x })}
              id="dTanks"
            />
            <span className="field muted small">
              {sig(r.tankVolume_m3, 3)} m³ at {a.propellantDensity_kg_m3} kg/m³ (a sphere{' '}
              {sig(2 * Math.cbrt((3 * r.tankVolume_m3) / (4 * Math.PI)), 3)} m across, or a bundle of capsules)
            </span>
          </div>
          <h3>Torches</h3>
          <div className="field-row">
            <NumberField
              label="How many"
              value={d.torches.count}
              onCommit={(x) => x !== undefined && x >= 1 && set({ torches: { ...d.torches, count: Math.round(x) } })}
              id="dTorches"
            />
            <NumberField
              label="Thrust each, MN"
              value={d.torches.thrust_MN}
              onCommit={(x) => x !== undefined && x > 0 && set({ torches: { ...d.torches, thrust_MN: x } })}
              id="dThrust"
            />
            <NumberField
              label="Exhaust speed, c"
              value={d.torches.exhaust_c}
              optional
              placeholder={String(physics?.torch.exhaustSpeed_c ?? 0.05)}
              onCommit={(x) => set({ torches: { ...d.torches, exhaust_c: x && x > 0 ? x : undefined } })}
              id="dExhaust"
              hint="blank: the world’s"
            />
          </div>
          <h3>Power and heat</h3>
          <div className="field-row">
            <NumberField label="Power plant, GW" value={d.plant_GW} onCommit={pos((plant_GW) => set({ plant_GW }))} id="dPlant" />
            <NumberField
              label="Foam field draws, GW"
              value={ship.foamPower_GW}
              optional
              onCommit={(x) => save({ ...ship, foamPower_GW: x !== undefined && x >= 0 ? x : undefined })}
              id="dFoam"
            />
            <NumberField
              label="Radiators, m²"
              value={d.radiators_m2}
              onCommit={pos((radiators_m2) => set({ radiators_m2 }))}
              id="dRadiators"
            />
          </div>
          <h3>Other</h3>
          <Extras extras={d.extras ?? []} onChange={(extras) => set({ extras: extras.length ? extras : undefined })} />
        </div>

        <div className="design-results" id="designResults">
          <h3>What it weighs</h3>
          <table className="data small parts">
            <tbody>
              {r.parts.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="num">{sig(p.mass_t, 3)} t</td>
                  <td className="bar-cell">
                    <span className="bar" style={{ width: `${(p.mass_t / maxPart) * 100}%` }} />
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Dry</td>
                <td className="num">{sig(r.dry_t, 4)} t</td>
                <td />
              </tr>
              <tr>
                <td>Full tanks and load</td>
                <td className="num">{sig(r.full_t, 4)} t</td>
                <td />
              </tr>
            </tbody>
          </table>
          <h3>How it flies</h3>
          <dl className="facts">
            <dt>Thrust</dt>
            <dd>
              {sig(r.thrust_N / 1e6, 3)} MN, jet power {sig(r.jetPower_W / 1e12, 3)} TW ({sig(exhaust, 3)} km/s exhaust)
            </dd>
            <dt>Acceleration</dt>
            <dd>
              {sig(r.accelFull / G0, 3)} g laden and full; {sig(r.accelEmpty / G0, 3)} g empty
            </dd>
            <dt>Δv</dt>
            <dd>{sig(r.dv / 1000, 4)} km/s on full tanks, laden</dd>
            <dt>Burn time</dt>
            <dd>{duration(r.burnTime)} at full thrust</dd>
            <dt>Waste heat</dt>
            <dd>
              {sig(r.heatBurning_W / 1e9, 3)} GW burning, {sig(r.heatCoasting_W / 1e9, 3)} GW coasting; the radiators shed{' '}
              {sig(r.radiators_W / 1e9, 3)} GW
            </dd>
            <dt>Power</dt>
            <dd>
              the plant makes {sig(d.plant_GW, 3)} GW; the foam field and hotel need {sig(r.plantDemand_W / 1e9, 3)} GW
            </dd>
          </dl>
          {r.problems.length > 0 ? (
            <ul className="problems" id="designProblems">
              {r.problems.map((p) => (
                <li key={p} className="error">
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ok small">Balanced: the radiators keep up and the plant powers the foam.</p>
          )}
          <p className="muted small">
            The trip planner flies this ship at {sig(ship.dryMass_t, 4)} t dry (load included), {sig(ship.propellant_t, 4)} t of propellant,{' '}
            {d.torches.count} × {sig(d.torches.thrust_MN, 3)} MN.
          </p>
        </div>
      </div>
    </section>
  )
}

function Extras({
  extras,
  onChange
}: {
  extras: { name: string; mass_t: number }[]
  onChange(x: { name: string; mass_t: number }[]): void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [mass, setMass] = useState('')
  return (
    <div className="extras">
      {extras.map((x, i) => (
        <div className="field-row tight" key={i}>
          <span>{x.name}</span>
          <span className="muted">{sig(x.mass_t, 3)} t</span>
          <button className="link danger" onClick={() => onChange(extras.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <form
        className="field-row tight"
        onSubmit={(e) => {
          e.preventDefault()
          const m = Number(mass)
          if (!name.trim() || !Number.isFinite(m) || m < 0) return
          onChange([...extras, { name: name.trim(), mass_t: m }])
          setName('')
          setMass('')
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Something else aboard…" aria-label="Part name" />
        <input value={mass} onChange={(e) => setMass(e.target.value)} placeholder="t" aria-label="Mass, tonnes" className="narrow" />
        <button type="submit">Add</button>
      </form>
    </div>
  )
}

function Assumptions({ physics }: { physics: PhysicsSettings | null }): React.JSX.Element | null {
  if (!physics) return <p className="muted small">The world has no physics settings, so the yard can’t work out torches and heat.</p>
  const a = designAssumptions(physics)
  const set = (k: keyof DesignAssumptions, v: number | undefined): void => {
    const design = { ...(physics.design ?? {}) } as Record<string, number | undefined>
    if (v === undefined) delete design[k]
    else design[k] = v
    const next = { ...physics, design: Object.keys(design).length ? design : undefined }
    void window.malevo.world.setEntity('physics', 'physics', clean(next))
  }
  return (
    <details className="assumptions">
      <summary>What parts weigh (the world’s assumptions)</summary>
      <p className="muted small">
        These apply to every ship in the world and are kept in the physics settings. Clear a field to go back to the default.
      </p>
      <div className="field-row">
        {(Object.keys(DESIGN_DEFAULTS) as (keyof DesignAssumptions)[]).map((k) => (
          <NumberField
            key={k}
            label={DESIGN_LABELS[k].label}
            hint={DESIGN_LABELS[k].unit}
            value={physics.design?.[k]}
            placeholder={String(DESIGN_DEFAULTS[k])}
            optional
            onCommit={(x) => set(k, x !== undefined && x >= 0 ? x : undefined)}
          />
        ))}
      </div>
      <p className="muted small">
        In use:{' '}
        {Object.entries(a)
          .map(([k, v]) => `${DESIGN_LABELS[k as keyof DesignAssumptions].label.toLowerCase()} ${v}`)
          .join(' · ')}
      </p>
    </details>
  )
}

export const shipyardTool: ToolDefinition = {
  id: 'shipyard',
  title: 'Shipyard',
  description: 'Build a ship from parts: what it weighs, how hard it burns, whether it can shed the heat',
  View: ShipyardView
}
