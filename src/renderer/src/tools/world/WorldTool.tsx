import { NumberField, duration, sig } from '../../components/fields'
import type { ToolDefinition, ToolProps } from '../registry'

function WorldView({ world, snapshot }: ToolProps): React.JSX.Element {
  const hex = world.seed.toString(16).toUpperCase().padStart(8, '0')
  return (
    <div className="tool-page">
      <h1>{world.name}</h1>
      <dl className="facts">
        <dt>Folder</dt>
        <dd>
          <code className="world-root">{world.root}</code>{' '}
          <button className="link" onClick={() => void window.malevo.world.reveal()}>
            Show in Explorer
          </button>
        </dd>
        <dt>Seed</dt>
        <dd>
          <code className="world-seed">{world.seed}</code> <span className="muted">(0x{hex})</span>
        </dd>
        <dt>Format</dt>
        <dd>
          <code>world.json</code> format {world.format}
        </dd>
      </dl>
      <p className="muted">
        The seed is the root of every procedural choice in this world and never changes. Its calendars live in <code>calendars/</code>.
      </p>
      <PhysicsEditor value={snapshot.physicsSettings as Physics | null} />
    </div>
  )
}

interface Physics {
  foam: { topSpeed_c: number; collapseRadius_au: number; loadRule: 'max-eigen' | 'rss'; legLimit_ly: number; gravityLimit_g: number }
  torch: {
    exhaustSpeed_c: number
    propellantFraction: number
    cruiseAccel_g: number
    governorCutoff_km: number
    shipMass_t?: number
    visibleFraction?: number
    frontFactor?: number
  }
  travel: { stopover_d: number }
  traffic: { balanceTolerance: number; balanceFloor_perDay: number }
}

/** settings/physics.json, edited in place: every tool that depends on it follows at once (unsaved and undoable, like any edit). */
function PhysicsEditor({ value }: { value: Physics | null }): React.JSX.Element {
  if (!value)
    return (
      <p className="warning">
        This world has no <code>settings/physics.json</code>; the Checks tool can add it.
      </p>
    )
  const save = (next: Physics): void => void window.malevo.world.setEntity('physics', 'physics', next)
  const foam = (patch: Partial<Physics['foam']>): void => save({ ...value, foam: { ...value.foam, ...patch } })
  const torch = (patch: Partial<Physics['torch']>): void => save({ ...value, torch: { ...value.torch, ...patch } })
  const pos = (f: (x: number) => void) => (x: number | undefined) => x !== undefined && x > 0 && f(x)
  const dv = value.torch.exhaustSpeed_c * 299_792.458 * Math.log(1 / (1 - value.torch.propellantFraction))
  return (
    <section className="physics-editor" id="physicsEditor">
      <h2>Physics</h2>
      <p className="muted small">
        Saved in <code>settings/physics.json</code>. Every tool follows a change at once: trip times, collapse edges, approaches, torches in
        the sky.
      </p>

      <h3>The foam</h3>
      <div className="field-row">
        <NumberField
          label="Top speed, c"
          value={value.foam.topSpeed_c}
          onCommit={pos((x) => foam({ topSpeed_c: x }))}
          hint={`A light-year in ${duration(31_557_600 / value.foam.topSpeed_c)}`}
          id="physTopSpeed"
        />
        <NumberField
          label="Leg limit, ly"
          value={value.foam.legLimit_ly}
          onCommit={pos((x) => foam({ legLimit_ly: x }))}
          hint="The longest single jump"
        />
        <NumberField
          label="Gravity limit, g"
          value={value.foam.gravityLimit_g}
          onCommit={pos((x) => foam({ gravityLimit_g: x }))}
          hint="The push and artificial gravity share it"
        />
        <NumberField
          label="Collapse radius around one solar mass, AU"
          value={value.foam.collapseRadius_au}
          onCommit={pos((x) => foam({ collapseRadius_au: x }))}
          hint="Grows as the cube root of the mass"
          id="physCollapse"
        />
      </div>
      <fieldset className="plain load-rule">
        <legend>How tides combine where several bodies pull (the load rule)</legend>
        <label className="check">
          <input
            type="radio"
            name="loadRule"
            checked={value.foam.loadRule === 'max-eigen'}
            onChange={() => foam({ loadRule: 'max-eigen' })}
          />
          <span>
            <strong>Strongest stretch</strong> (<code>max-eigen</code>): the foam fails when the tide pulls hardest in any one direction.
          </span>
        </label>
        <label className="check">
          <input type="radio" name="loadRule" checked={value.foam.loadRule === 'rss'} onChange={() => foam({ loadRule: 'rss' })} />
          <span>
            <strong>Overall strain</strong> (<code>rss</code>): the foam fails on the tide’s total size, every direction counted together.
          </span>
        </label>
        <p className="muted small">
          Around one body, and along the line through a star and a giant, the two agree exactly. They part where two tides pull across each
          other, on a giant’s flanks: there the overall strain is a little larger, so its collapse region reaches a few percent further
          (about 6% of a giant’s bubble at most). Approaches straight past a giant are the same either way.
        </p>
      </fieldset>

      <h3>Torches</h3>
      <div className="field-row">
        <NumberField
          label="Cruise acceleration, g"
          value={value.torch.cruiseAccel_g}
          onCommit={pos((x) => torch({ cruiseAccel_g: x }))}
          hint="Every burn: departures, crawls, torch times"
          id="physAccel"
        />
        <NumberField
          label="Exhaust speed, c"
          value={value.torch.exhaustSpeed_c}
          onCommit={(x) => x !== undefined && x > 0 && x <= 1 && torch({ exhaustSpeed_c: x })}
        />
        <NumberField
          label="Propellant, share of starting mass"
          value={value.torch.propellantFraction}
          onCommit={(x) => x !== undefined && x > 0 && x < 1 && torch({ propellantFraction: x })}
          hint={`Δv ${sig(dv, 3)} km/s`}
        />
        <NumberField
          label="Governor cutoff, km"
          value={value.torch.governorCutoff_km}
          onCommit={(x) => x !== undefined && x >= 0 && torch({ governorCutoff_km: x })}
          hint="Torches throttled this close to a port"
        />
      </div>

      <h3>Travel and traffic</h3>
      <div className="field-row">
        <NumberField
          label="Stopover, days"
          value={value.travel.stopover_d}
          onCommit={(x) => x !== undefined && x >= 0 && save({ ...value, travel: { stopover_d: x } })}
        />
        <NumberField
          label="Balance tolerance, share"
          value={value.traffic.balanceTolerance}
          onCommit={(x) => x !== undefined && x >= 0 && x <= 1 && save({ ...value, traffic: { ...value.traffic, balanceTolerance: x } })}
        />
        <NumberField
          label="Balance floor, ships/day"
          value={value.traffic.balanceFloor_perDay}
          onCommit={(x) => x !== undefined && x >= 0 && save({ ...value, traffic: { ...value.traffic, balanceFloor_perDay: x } })}
        />
      </div>
    </section>
  )
}

export const worldTool: ToolDefinition = {
  id: 'world',
  title: 'World',
  description: 'The open world: its name, folder, seed and physics',
  View: WorldView
}
