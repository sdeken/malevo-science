import { useEffect, useState } from 'react'
import { AU, DEG, G, KM, M_EARTH, M_SUN } from '@malevo/core'
import type { ElementsInfo, PlanetProposal, SystemInfoDto } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { BodyEditor } from './BodyEditor'
import { HistoryEditor } from './HistoryEditor'
import { OrbitView, type Drawn } from './OrbitView'

function SystemsView({ world, snapshot, now, displayCal, navigate, focus }: ToolProps): React.JSX.Element {
  const systems = snapshot.systems
  const [selectedId, setSelectedId] = useWorldPref<string | null>(world.root, 'system', systems[0]?.id ?? null)
  useEffect(() => {
    if (focus && systems.some((s) => s.id === focus)) setSelectedId(focus)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const system = systems.find((s) => s.id === selectedId) ?? systems[0] ?? null
  const hasSol = systems.some((s) => s.starId === 'hyg.0' && s.bodies.some((b) => b.name === 'Earth'))
  const addSol = async (): Promise<void> => {
    const id = await window.malevo.world.addSolarSystem()
    if (id) setSelectedId(id)
  }
  const solButton = !hasSol && (
    <button
      onClick={() => void addSol()}
      id="addSolarSystem"
      title="Sol, its planets, dwarf planets, major moons and belts, from published data"
    >
      Add the Solar System
    </button>
  )

  if (!system) {
    return (
      <div className="tool-page">
        <h1>Systems</h1>
        <p>There are no systems yet. A system is built on a star: pick one in the Stars tool and choose “New system here”.</p>
        <div className="inspector-actions">
          <button className="primary" onClick={() => navigate('stars')}>
            Go to Stars
          </button>
          {solButton}
        </div>
      </div>
    )
  }
  return (
    <div className="split-tool">
      <nav className="split-list">
        <h2>Systems</h2>
        <ul>
          {systems.map((s) => (
            <li key={s.id}>
              <button
                className={s.id === system.id ? 'list-item is-current' : 'list-item'}
                onClick={() => setSelectedId(s.id)}
                data-system={s.id}
              >
                <span>{s.name}</span>
                <span className={s.starError ? 'error small' : 'muted small'}>
                  {s.starError
                    ? 'star missing'
                    : `${s.star?.spect || 'star'} · ${s.bodies.length} ${s.bodies.length === 1 ? 'body' : 'bodies'}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => navigate('stars')}>New system on a star…</button>
        {solButton}
      </nav>
      <div className="split-detail">
        <SystemDetail
          key={system.id}
          system={system}
          snapshotVersion={snapshot.version}
          now={now}
          displayCal={displayCal}
          calendars={snapshot.calendars}
          navigate={navigate}
          snapshot={snapshot}
        />
      </div>
    </div>
  )
}

function SystemDetail({
  system,
  snapshotVersion,
  now,
  displayCal,
  calendars,
  navigate,
  snapshot
}: {
  snapshot: ToolProps['snapshot']
  system: SystemInfoDto
  snapshotVersion: number
  now: number
  displayCal: string | null
  calendars: ToolProps['snapshot']['calendars']
  navigate: ToolProps['navigate']
}): React.JSX.Element {
  const [selectedBody, setSelectedBody] = useState<string | null>(null)
  const [center, setCenter] = useState<string | null>(null)
  const [scale, setScale] = useState<'log' | 'linear'>('log')
  const [proposal, setProposal] = useState<PlanetProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const star = system.star
  const body = system.bodies.find((b) => b.id === selectedBody) ?? null
  const overrides = (system.value.starOverrides ?? {}) as Record<string, number | undefined>
  const save = (patch: Record<string, unknown>): void =>
    void window.malevo.world.setEntity('system', system.id, { ...system.value, ...patch })
  const setOverride = (key: string, v: number | undefined): void => {
    const o = { ...overrides, [key]: v }
    if (v === undefined) delete o[key]
    save({ starOverrides: Object.keys(o).length ? o : undefined })
  }

  const roll = async (n: number): Promise<void> => {
    setError(null)
    try {
      setProposal(await window.malevo.systems.roll(system.id, n))
      setCenter(null)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const keep = async (): Promise<void> => {
    if (!proposal) return
    await window.malevo.systems.keep(system.id, proposal.roll)
    setProposal(null)
  }

  const addBody = async (): Promise<void> => {
    const ids = system.bodies.map((b) => b.id)
    const parent = center
    const name = parent ? `${system.bodies.find((b) => b.id === parent)?.name ?? ''} moon`.trim() : `${system.name} planet`
    const id = slugId(name, ids)
    await window.malevo.world.setEntity('body', id, {
      name,
      system: system.id,
      ...(parent ? { parent } : {}),
      class: 'rocky',
      orbit: {
        ...(parent ? { a_km: 400000 } : { a_au: 1 }),
        e: 0,
        i_deg: 0,
        node_deg: 0,
        peri_deg: 0,
        meanAnomaly_deg: 0,
        epoch: { t_s: 0 }
      },
      mass_mearth: parent ? 0.01 : 1,
      radius_km: parent ? 1500 : 6371,
      rotation: parent ? { locked: true, tilt_deg: 0 } : { period_h: 24, tilt_deg: 20 }
    })
    setSelectedBody(id)
  }

  const removeSystem = (): void => {
    const msg = `Delete the system “${system.name}”${system.bodies.length ? ` and its ${system.bodies.length} ${system.bodies.length === 1 ? 'body' : 'bodies'}` : ''}?`
    if (!window.confirm(msg)) return
    void window.malevo.world.deleteEntities([
      { kind: 'system', id: system.id },
      ...system.bodies.map((b) => ({ kind: 'body' as const, id: b.id }))
    ])
  }

  const drawn: Drawn[] = proposal
    ? proposal.bodies.map((b) => ({
        id: b.id,
        name: String(b.value.name),
        cls: String(b.value.class),
        radius: Number(b.value.radius_km) * KM,
        parent: null,
        elements: elementsOf(b.value, star?.mass ?? 1),
        ghost: true
      }))
    : system.bodies
        .filter((b) => b.elements)
        .map((b) => {
          const ext = (b.value as { extent?: { inner_au: number; outer_au: number } }).extent
          return {
            id: b.id,
            name: b.name,
            cls: b.cls,
            radius: b.radius,
            parent: b.parent,
            elements: b.elements!,
            extent: ext ? ([ext.inner_au * AU, ext.outer_au * AU] as [number, number]) : undefined
          }
        })
  const moons = center ? system.bodies.filter((b) => b.parent === center) : []

  return (
    <div className="tool-page wide system-detail" data-system-detail={system.id}>
      <div className="field-row">
        <TextField
          label="System name"
          value={system.name}
          onCommit={(name) => name.trim() && save({ name: name.trim() })}
          id="systemName"
        />
        <div className="inspector-actions">
          <button onClick={() => navigate('stars', system.id)}>Show in Stars</button>
          <button className="danger" onClick={removeSystem}>
            Delete…
          </button>
        </div>
      </div>

      {system.starError ? (
        <p className="error">{system.starError}</p>
      ) : (
        star && (
          <>
            <p className="star-line">
              <strong>{star.name ?? 'Unnamed star'}</strong> <code className="muted small">{star.id}</code> · {star.spect || 'unknown type'}{' '}
              · {sig(Math.hypot(...star.pos), 4)} ly from Sol · {sig(star.teff, 4)} K · {sig(star.luminosity, 3)} L☉ ·{' '}
              {star.mass === null ? 'mass unknown' : `${sig(star.mass, 3)} M☉`} · {sig(star.radius, 3)} R☉
              {star.overridden.length > 0 && (
                <span className="muted"> (overridden: {star.overridden.map((k) => k.split('_')[0]).join(', ')})</span>
              )}
            </p>
            <details className="overrides">
              <summary>Star overrides</summary>
              <p className="muted small">Leave a field empty to use the estimate from the catalogue.</p>
              <div className="field-row">
                <NumberField label="Mass, M☉" value={overrides.mass_msun} optional onCommit={(v) => setOverride('mass_msun', v)} />
                <NumberField
                  label="Luminosity, L☉"
                  value={overrides.luminosity_lsun}
                  optional
                  onCommit={(v) => setOverride('luminosity_lsun', v)}
                />
                <NumberField label="Temperature, K" value={overrides.teff_k} optional onCommit={(v) => setOverride('teff_k', v)} />
                <NumberField label="Radius, R☉" value={overrides.radius_rsun} optional onCommit={(v) => setOverride('radius_rsun', v)} />
              </div>
            </details>
          </>
        )
      )}

      <details className="overrides" id="systemTraffic">
        <summary>Port and traffic</summary>
        <div className="field-row">
          <label className="field">
            Ships dock at
            <select
              value={String(system.value.port ?? '')}
              onChange={(e) => save({ port: e.target.value || undefined })}
              aria-label="Port body"
              id="systemPort"
            >
              <option value="">A habitable distance (1 AU × √L)</option>
              {system.bodies.map((b) => (
                <option key={b.id} value={b.id}>
                  {'  '.repeat(b.depth)}
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Declared net, ships/day"
            value={system.value.declaredNet_perDay as number | undefined}
            optional
            hint="Positive for a sink (a graveyard), negative for a source (a shipyard)."
            onCommit={(v) => save({ declaredNet_perDay: v })}
          />
        </div>
        {snapshot.nodes[`system:${system.id}`] && (
          <p className="muted small">
            Crawl between the dock and the collapse edge ({sig((snapshot.nodes[`system:${system.id}`].crawlDistance ?? NaN) / AU, 3)} AU):{' '}
            {duration(snapshot.nodes[`system:${system.id}`].crawlOut)} out, {duration(snapshot.nodes[`system:${system.id}`].crawlIn)} in.{' '}
            <button className="link" onClick={() => navigate('routes', `system:${system.id}`)}>
              Routes and traffic
            </button>
          </p>
        )}
      </details>

      {displayCal && <HistoryEditor system={system} snapshot={snapshot} now={now} displayCal={displayCal} />}

      <div className="orbit-layout">
        <div className="orbit-col">
          <div className="toolbar tight">
            {center ? (
              <button onClick={() => setCenter(null)}>← Whole system</button>
            ) : (
              <span className="muted small">
                {proposal ? `Roll ${proposal.roll}: ${proposal.bodies.length} planets (not kept)` : 'At the current date'}
              </span>
            )}
            <span className="spacer" />
            <label className="check small">
              <input type="checkbox" checked={scale === 'log'} onChange={(e) => setScale(e.target.checked ? 'log' : 'linear')} />
              Log scale
            </label>
          </div>
          <OrbitView
            system={system}
            now={now}
            selected={selectedBody}
            onSelect={setSelectedBody}
            center={center}
            bodies={drawn}
            scale={scale}
          />
          {center && moons.length === 0 && <p className="muted small">No moons yet.</p>}
        </div>
        <div className="bodies-col">
          {proposal ? (
            <div className="roll-panel">
              <h3>Roll {proposal.roll}</h3>
              <table className="units bodies">
                <thead>
                  <tr>
                    <th>Body</th>
                    <th>Kind</th>
                    <th>Orbit</th>
                    <th>Mass</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.bodies.map((b) => {
                    const o = b.value.orbit as { a_au: number }
                    return (
                      <tr key={b.id}>
                        <td>{String(b.value.name)}</td>
                        <td>{String(b.value.class)}</td>
                        <td>{sig(o.a_au, 3)} AU</td>
                        <td>{sig(Number(b.value.mass_mearth), 3)} M⊕</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {proposal.bodies.length === 0 && <p className="muted">This roll has no planets.</p>}
              <div className="inspector-actions">
                <button onClick={() => void roll(proposal.roll + 1)} id="rollAgain">
                  Roll again
                </button>
                <button className="primary" onClick={() => void keep()} id="keepRoll">
                  Keep these
                </button>
                <button className="link" onClick={() => setProposal(null)}>
                  Cancel
                </button>
              </div>
              {system.bodies.some((b) => b.generatedBy?.startsWith('planets@')) && (
                <p className="muted small">Keeping replaces the planets kept from an earlier roll. Bodies you made or edited stay.</p>
              )}
            </div>
          ) : (
            <>
              <div className="toolbar tight">
                <button onClick={() => void roll(0)} disabled={!star} id="rollPlanets">
                  Roll planets…
                </button>
                <button onClick={() => void addBody()} id="addBody">
                  {center ? 'Add a moon' : 'Add a body'}
                </button>
              </div>
              {error && <p className="error">{error}</p>}
              <table className="units bodies">
                <thead>
                  <tr>
                    <th>Body</th>
                    <th>Orbit</th>
                    <th>Year</th>
                    <th>Day</th>
                    <th>Gravity</th>
                    <th>Temp.</th>
                  </tr>
                </thead>
                <tbody>
                  {system.bodies.map((b) => (
                    <tr
                      key={b.id}
                      className={b.id === selectedBody ? 'is-current' : undefined}
                      onClick={() => setSelectedBody(b.id)}
                      data-body-row={b.id}
                    >
                      <td style={{ paddingLeft: `${b.depth * 14}px` }}>
                        <button className="link" onClick={() => setSelectedBody(b.id)}>
                          {b.name}
                        </button>
                        {b.error && <span className="error small"> ⚠</span>}
                      </td>
                      <td>{b.elements ? (b.parent ? `${sig(b.elements.a / 1000, 3)} km` : `${sig(b.elements.a / AU, 3)} AU`) : '—'}</td>
                      <td>{duration(b.parent ? b.period : b.year)}</td>
                      <td>
                        {b.cls === 'belt' ? '—' : b.solarDay !== null && !Number.isFinite(b.solarDay) ? 'locked' : duration(b.solarDay)}
                      </td>
                      <td>{b.cls === 'belt' ? '—' : `${sig(b.surfaceGravity, 2)} g`}</td>
                      <td>{b.equilibriumTemp === null ? '—' : `${sig(b.equilibriumTemp, 3)} K`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {system.bodies.length === 0 && <p className="muted">No bodies yet: roll some planets, or add one by hand.</p>}
              {body && system.bodies.some((b) => b.parent === body.id) && !center && (
                <button className="link" onClick={() => setCenter(body.id)}>
                  Show {body.name}’s moons
                </button>
              )}
              {body && !center && !system.bodies.some((b) => b.parent === body.id) && (
                <button className="link" onClick={() => setCenter(body.id)}>
                  Centre on {body.name} (to add moons)
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {body && !proposal && displayCal && (
        <BodyEditor
          key={body.id}
          body={body}
          system={system}
          calendars={calendars}
          displayCal={displayCal}
          version={snapshotVersion}
          onDeleted={() => setSelectedBody(null)}
        />
      )}
    </div>
  )
}

/** Orbital elements, SI, for a proposed body around the star. */
function elementsOf(v: Record<string, unknown>, starMassSun: number): ElementsInfo {
  const o = v.orbit as {
    a_au?: number
    a_km?: number
    e: number
    i_deg: number
    node_deg: number
    peri_deg: number
    meanAnomaly_deg: number
    epoch: { t_s: number }
  }
  const a = o.a_au !== undefined ? o.a_au * AU : (o.a_km ?? 0) * KM
  return {
    a,
    e: o.e,
    i: o.i_deg * DEG,
    node: o.node_deg * DEG,
    peri: o.peri_deg * DEG,
    meanAnomaly: o.meanAnomaly_deg * DEG,
    epoch: o.epoch.t_s,
    mu: G * (starMassSun * M_SUN + Number(v.mass_mearth) * M_EARTH)
  }
}

export const systemsTool: ToolDefinition = {
  id: 'systems',
  title: 'Systems',
  description: 'Star systems: their stars, planets and moons, and what follows from them',
  View: SystemsView
}
