import { useState } from 'react'
import type { BodyInfoDto, CalendarInfo, SystemInfoDto } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId } from '../../state'
import { BodyEditor } from './BodyEditor'

const AU_KM = 149_597_870.7

const MOON_CLASSES = [
  ['rocky', 'Rocky'],
  ['ocean', 'Ocean world'],
  ['dwarf', 'Icy / dwarf'],
  ['ice-giant', 'Ice giant'],
  ['gas-giant', 'Gas giant'],
  ['belt', 'Ring'],
  ['comet', 'Captured comet']
] as const

interface Props {
  body: BodyInfoDto
  system: SystemInfoDto
  calendars: CalendarInfo[]
  displayCal: string
  version: number
  bodyIds: readonly string[]
  origins: Record<string, 'builtin' | 'override'>
  /** Open a moon on its own (its own tab in VS Code, or selected in the system). */
  onOpenBody?(id: string): void
}

type MoonValue = Record<string, unknown> & {
  name: string
  class: string
  orbit: Record<string, unknown> & { a_au?: number; a_km?: number; e: number }
  mass_mearth: number
  radius_km: number
  rotation: { period_h?: number; locked?: boolean; tilt_deg: number }
  lock?: unknown
}

/** A body's moons, edited where the body is: the essentials in place, and everything else a click away. */
export function MoonsEditor({ body, system, calendars, displayCal, version, bodyIds, origins, onOpenBody }: Props): React.JSX.Element {
  const moons = system.bodies.filter((b) => b.parent === body.id).sort((a, b) => (a.elements?.a ?? 0) - (b.elements?.a ?? 0))
  const [expanded, setExpanded] = useState<string | null>(null)

  const add = (): void => {
    const name = `${body.name} ${roman(moons.length + 1)}`
    const id = slugId(name, bodyIds)
    // Outside the last moon, or a little way out from the planet, and well inside its Hill sphere.
    const lastKm = moons.length ? Math.max(...moons.map((m) => (m.elements?.a ?? 0) / 1000)) : 0
    const r = body.radius / 1000
    let a = lastKm ? lastKm * 1.6 : Math.max(r * 20, 50_000)
    if (body.hill) a = Math.min(a, (body.hill / 1000) * 0.4)
    void window.malevo.world.setEntity('body', id, {
      name,
      system: system.id,
      parent: body.id,
      class: 'rocky',
      orbit: { a_km: Math.round(a), e: 0, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 0, epoch: { t_s: 0 } },
      mass_mearth: 0.01,
      radius_km: 1500,
      rotation: { locked: true, tilt_deg: 0 }
    })
    setExpanded(null)
  }

  return (
    <section className="moons-editor" id="moonsEditor">
      <h3>
        Moons <span className="muted small">{moons.length ? `(${moons.length})` : ''}</span>
      </h3>
      {!moons.length && <p className="muted small">None yet.</p>}
      {moons.map((m) => (
        <MoonRow
          key={m.id}
          moon={m}
          planet={body}
          expanded={expanded === m.id}
          toggle={() => setExpanded((x) => (x === m.id ? null : m.id))}
          onOpenBody={onOpenBody}
        >
          {expanded === m.id && (
            <div className="moon-more">
              <BodyEditor
                key={m.id}
                body={m}
                system={system}
                calendars={calendars}
                displayCal={displayCal}
                version={version}
                bodyIds={bodyIds}
                origin={origins[`body/${m.id}`]}
                onDeleted={() => setExpanded(null)}
                onRenamed={(id) => setExpanded(id)}
                onOpenBody={onOpenBody}
                nested
              />
            </div>
          )}
        </MoonRow>
      ))}
      <button onClick={add} id="addMoon">
        Add a moon
      </button>
    </section>
  )
}

function MoonRow({
  moon,
  planet,
  expanded,
  toggle,
  onOpenBody,
  children
}: {
  moon: BodyInfoDto
  planet: BodyInfoDto
  expanded: boolean
  toggle(): void
  onOpenBody?(id: string): void
  children: React.ReactNode
}): React.JSX.Element {
  const v = moon.value as MoonValue
  const save = (patch: Partial<MoonValue>): void => {
    const next: MoonValue = { ...v, ...patch }
    delete next.lock
    void window.malevo.world.setEntity('body', moon.id, next)
  }
  const aKm = v.orbit.a_km ?? (v.orbit.a_au !== undefined ? v.orbit.a_au * AU_KM : undefined)
  const setA = (km: number): void => {
    const orbit = { ...v.orbit }
    delete orbit.a_au
    orbit.a_km = km
    save({ orbit })
  }
  const remove = (): void => {
    if (window.confirm(`Delete the moon “${v.name}”?`)) void window.malevo.world.deleteEntity('body', moon.id)
  }
  const outside = planet.hill !== null && moon.elements ? moon.elements.a / planet.hill : null

  return (
    <div className="moon-row" data-ref={`body:${moon.id}`} data-moon-row={moon.id}>
      <div className="field-row">
        <TextField label="Name" value={v.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} />
        <label className="field">
          Kind
          <select value={v.class} onChange={(e) => save({ class: e.target.value })}>
            {MOON_CLASSES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Distance, km"
          value={aKm !== undefined ? Number(aKm.toPrecision(7)) : undefined}
          onCommit={(a) => a && a > 0 && setA(a)}
        />
        <NumberField
          label="Eccentricity"
          value={v.orbit.e}
          onCommit={(e) => e !== undefined && e >= 0 && e < 1 && save({ orbit: { ...v.orbit, e } })}
        />
      </div>
      <div className="field-row">
        <NumberField label="Mass, Earth masses" value={v.mass_mearth} onCommit={(x) => x && x > 0 && save({ mass_mearth: x })} />
        <NumberField label="Radius, km" value={v.radius_km} onCommit={(x) => x && x > 0 && save({ radius_km: x })} />
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(v.rotation.locked)}
            onChange={(e) =>
              save({
                rotation: e.target.checked
                  ? { tilt_deg: v.rotation.tilt_deg, locked: true }
                  : { tilt_deg: v.rotation.tilt_deg, period_h: 24 }
              })
            }
          />
          Tidally locked
        </label>
        {!v.rotation.locked && (
          <NumberField
            label="Rotation, hours"
            value={v.rotation.period_h}
            onCommit={(p) => p && save({ rotation: { tilt_deg: v.rotation.tilt_deg, period_h: p } })}
          />
        )}
      </div>
      <p className="moon-facts small">
        <span className="muted">Orbits in</span> {duration(moon.period)}
        {moon.cls !== 'belt' && (
          <>
            {' · '}
            <span className="muted">gravity</span> {sig(moon.surfaceGravity, 3)} g{' · '}
            <span className="muted">density</span> {sig(moon.density, 3)} g/cm³
          </>
        )}
        {outside !== null && outside > 0.5 && (
          <span className="warn">
            {' '}
            · {sig(outside, 2)} of {planet.name}’s Hill sphere: {outside >= 1 ? 'not held by it at all' : 'too far out to stay for long'}
          </span>
        )}
        {moon.error && <span className="error"> · {moon.error}</span>}
      </p>
      <div className="moon-actions">
        <button className="link" onClick={toggle} aria-expanded={expanded} data-moon-more={moon.id}>
          {expanded ? 'Fewer settings' : 'All its settings…'}
        </button>
        {onOpenBody && (
          <button className="link" onClick={() => onOpenBody(moon.id)} data-open-moon={moon.id}>
            Open on its own
          </button>
        )}
        <button className="link danger" onClick={remove}>
          Delete
        </button>
      </div>
      {children}
    </div>
  )
}

function roman(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ]
  let out = ''
  for (const [v, s] of table)
    while (n >= v) {
      out += s
      n -= v
    }
  return out
}
