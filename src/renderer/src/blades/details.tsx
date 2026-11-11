/**
 * Pages about one thing: a body (planet, moon, dwarf planet, belt, comet), a star, and the quickest way to
 * somewhere. Read-only summaries that open the tools that edit them.
 */
import { useEffect, useMemo, useState } from 'react'
import { historyAt } from '@malevo/model'
import type { BodyInfoDto, RoutePlanDto, StarInfoDto, SystemInfoDto } from '../../../shared/types'
import { duration, sig } from '../components/fields'
import type { ToolProps } from '../tools/registry'
import { bodyKindLabel, entityActions, findBody, refLabel, type Ref } from './entities'

const AU = 149_597_870_700

/** The actions for it, as a row of buttons (the first, the one this page is, left out). */
function ActionRow({ refd, props, skip }: { refd: Ref; props: ToolProps; skip: string }): React.JSX.Element {
  const actions = entityActions(refd, props.snapshot, props.setNow).filter((a) => a.label !== skip)
  return (
    <div className="detail-actions">
      {actions.map((a) => (
        <button key={a.label} className="small" onClick={() => (a.spec ? props.open(a.spec) : a.run?.())}>
          {a.label}
        </button>
      ))}
    </div>
  )
}

/** The first paragraphs of an article, as plain text, with a link to the whole of it. */
function ArticleTeaser({ path, props }: { path: string; props: ToolProps }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    void window.malevo.pages.read(path).then(setText)
  }, [path, props.snapshot.version])
  const lead = useMemo(() => {
    if (!text) return null
    const body = text
      .replace(/^---[\s\S]*?\n---\n/, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('!['))
    return body
      .slice(0, 2)
      .map((p) => p.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, ''))
      .join('\n\n')
  }, [text])
  return (
    <section className="detail-article">
      {lead ? <p className="article-lead">{lead}</p> : <p className="muted">No article yet.</p>}
      <button className="link" onClick={() => props.open({ type: 'wiki', params: { focus: path } })}>
        {lead ? 'Read the article →' : 'Write the article →'}
      </button>
    </section>
  )
}

function Chip({ refd, label, color }: { refd: Ref; label: string; color?: string }): React.JSX.Element {
  return (
    <span className="chip" data-ref={`${refd.kind}:${refd.id}`} title="Right-click for more">
      {color && <span className="swatch" style={{ background: color }} />}
      {label}
    </span>
  )
}

/** Who holds the system and who lives there, at the current date. */
function Holders({ system, props }: { system: SystemInfoDto; props: ToolProps }): React.JSX.Element | null {
  const h = historyAt(system.history, props.now)
  if (!h) return null
  const polity = h.polity ? props.snapshot.polities.find((p) => p.id === h.polity) : null
  return (
    <>
      <dt>Held by</dt>
      <dd>
        {polity ? (
          <Chip
            refd={{ kind: 'polity', id: polity.id }}
            label={String(polity.value?.name ?? polity.id)}
            color={String(polity.value?.color ?? '')}
          />
        ) : (
          'independent'
        )}
      </dd>
      {h.cultures.length > 0 && (
        <>
          <dt>People</dt>
          <dd className="chips">
            {[...h.cultures]
              .sort((a, b) => b.share - a.share)
              .map((c) => {
                const cv = props.snapshot.cultures.find((x) => x.id === c.culture)
                return (
                  <Chip
                    key={c.culture}
                    refd={{ kind: 'culture', id: c.culture }}
                    label={`${String(cv?.value?.name ?? c.culture)} ${Math.round(c.share * 100)}%`}
                    color={String(cv?.value?.color ?? '')}
                  />
                )
              })}
          </dd>
        </>
      )}
    </>
  )
}

// ---- a body ----

export function BodyBlade(props: ToolProps): React.JSX.Element {
  const id = props.params.id ?? ''
  const found = findBody(props.snapshot, id)
  if (!found) return <div className="tool-page">There is no body “{id}” any more (deleted, or renamed and closed).</div>
  const { body: b, system } = found
  const v = b.value as {
    orbit?: { a_au?: number; a_km?: number; e?: number; i_deg?: number }
    mass_mearth?: number
    radius_km?: number
    rotation?: { period_h?: number; locked?: boolean; tilt_deg?: number }
    atmosphere?: { pressure_bar?: number; composition?: string }
    extent?: unknown
  }
  const a_m = v.orbit?.a_au !== undefined ? v.orbit.a_au * AU : v.orbit?.a_km !== undefined ? v.orbit.a_km * 1000 : null
  const e = v.orbit?.e ?? 0
  const moons = system.bodies.filter((x) => x.parent === b.id)
  const host = b.parent ? system.bodies.find((x) => x.id === b.parent) : null
  const cities = props.snapshot.cities.filter((c) => c.value.body === b.id)
  const events = props.snapshot.events.filter((ev) => ev.value?.where === system.id).length
  const dist = (m: number): string => (m > 0.05 * AU ? `${sig(m / AU, 4)} AU` : `${sig(m / 1000, 4)} km`)
  const day = b.solarDay
  return (
    <div className="detail-page" data-detail={`body:${b.id}`}>
      <header className="detail-head">
        <span className={`detail-dot ov-${b.cls}`} />
        <div>
          <h1>{b.name}</h1>
          <p className="muted">
            {bodyKindLabel(b, system)}
            {' · '}
            <span
              className="link-like"
              data-ref={`system:${system.id}`}
              onClick={() => props.open({ type: 'systems', params: { focus: system.id, body: b.id } })}
            >
              {system.name}
            </span>
            {b.generatedBy && <span> · generated ({b.generatedBy})</span>}
          </p>
        </div>
      </header>
      <ActionRow refd={{ kind: 'body', id: b.id }} props={props} skip="Details" />
      <div className="detail-columns">
        <div>
          <ArticleTeaser path={`bodies/${b.id}.md`} props={props} />
          {moons.length > 0 && (
            <section>
              <h3>{b.cls === 'belt' ? 'Within it' : moons.length === 1 ? 'Moon' : `Moons (${moons.length})`}</h3>
              <ul className="detail-list">
                {moons.map((m) => (
                  <li key={m.id}>
                    <button className="link" data-ref={`body:${m.id}`} onClick={() => props.open({ type: 'body', params: { id: m.id } })}>
                      {m.name}
                    </button>{' '}
                    <span className="muted small">
                      {bodyKindLabel(m, system).replace(/^moon of .*/, m.cls)}, {sig(m.radius / 1000, 3)} km
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {cities.length > 0 && (
            <section>
              <h3>Cities</h3>
              <ul className="detail-list">
                {cities.map((c) => {
                  const pop = [...c.population].reverse().find((p) => p.t <= props.now)
                  return (
                    <li key={c.id}>
                      <button
                        className="link"
                        data-ref={`city:${c.id}`}
                        onClick={() => props.open({ type: 'population', params: { focus: c.id } })}
                      >
                        {String(c.value.name ?? c.id)}
                      </button>{' '}
                      {pop && <span className="muted small">{pop.people.toLocaleString()} people now</span>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {events > 0 && (
            <p>
              <button className="link" onClick={() => props.open({ type: 'timeline', params: { where: system.id } })}>
                {events === 1 ? '1 event' : `${events} events`} in {system.name} →
              </button>
            </p>
          )}
        </div>
        <dl className="facts compact detail-facts">
          <Holders system={system} props={props} />
          <dt className="facts-group">Physical</dt>
          <dd />
          {v.mass_mearth !== undefined && (
            <>
              <dt>Mass</dt>
              <dd>
                {sig(v.mass_mearth, 4)} Earth masses <span className="muted">({sig(b.mass, 3)} kg)</span>
              </dd>
            </>
          )}
          <dt>Radius</dt>
          <dd>{sig(b.radius / 1000, 4)} km</dd>
          {b.cls !== 'belt' && (
            <>
              <dt>Density</dt>
              <dd>{sig(b.density, 3)} g/cm³</dd>
              <dt>Surface gravity</dt>
              <dd>{sig(b.surfaceGravity, 3)} g</dd>
              <dt>Escape velocity</dt>
              <dd>{sig(b.escapeVelocity / 1000, 3)} km/s</dd>
            </>
          )}
          <dt className="facts-group">Orbit</dt>
          <dd>{host ? `around ${host.name}` : `around ${system.star?.name ?? system.name}`}</dd>
          {a_m !== null && (
            <>
              <dt>Semi-major axis</dt>
              <dd>{dist(a_m)}</dd>
              <dt>Nearest, farthest</dt>
              <dd>
                {dist(a_m * (1 - e))}, {dist(a_m * (1 + e))}
              </dd>
            </>
          )}
          <dt>Eccentricity</dt>
          <dd>{sig(e, 3)}</dd>
          {v.orbit?.i_deg !== undefined && (
            <>
              <dt>Inclination</dt>
              <dd>{sig(v.orbit.i_deg, 3)}°</dd>
            </>
          )}
          <dt>Period</dt>
          <dd>{duration(b.period)}</dd>
          {host && (
            <>
              <dt>Year</dt>
              <dd>{duration(b.year)}</dd>
            </>
          )}
          <dt>Hill sphere</dt>
          <dd>{b.hill === null ? '—' : dist(b.hill)}</dd>
          <dt>Foam collapse</dt>
          <dd>{b.collapse === null ? '—' : dist(b.collapse)}</dd>
          {b.cls !== 'belt' && (
            <>
              <dt className="facts-group">Day</dt>
              <dd />
              <dt>Rotation</dt>
              <dd>{v.rotation?.locked ? 'tidally locked' : duration(b.rotation === null ? null : Math.abs(b.rotation))}</dd>
              <dt>Solar day</dt>
              <dd>{day !== null && !Number.isFinite(day) ? 'none: one face to the star' : duration(day)}</dd>
              <dt>Axial tilt</dt>
              <dd>{sig((b.tilt * 180) / Math.PI, 3)}°</dd>
            </>
          )}
          <dt className="facts-group">Light</dt>
          <dd />
          <dt>Sunlight</dt>
          <dd>{b.insolation === null ? '—' : `${sig(b.insolation / 1361, 3)} × Earth`}</dd>
          <dt>Equilibrium temperature</dt>
          <dd>{b.equilibriumTemp === null ? '—' : `${sig(b.equilibriumTemp, 3)} K (${sig(b.equilibriumTemp - 273.15, 3)} °C)`}</dd>
          {v.atmosphere?.pressure_bar !== undefined && (
            <>
              <dt>Surface pressure</dt>
              <dd>{sig(v.atmosphere.pressure_bar, 3)} bar</dd>
            </>
          )}
        </dl>
      </div>
      <p className="muted small detail-foot">
        From <code>{b.path}</code>
        {props.snapshot.origins[`body/${b.id}`] === 'builtin' && ' (built in: real astronomy)'}. To change it, open it in{' '}
        <button className="link" onClick={() => props.open({ type: 'systems', params: { focus: system.id, body: b.id } })}>
          {system.name}
        </button>
        .
      </p>
    </div>
  )
}

// ---- a star ----

export function StarBlade(props: ToolProps): React.JSX.Element {
  const id = props.params.id ?? ''
  const [star, setStar] = useState<StarInfoDto | null | undefined>(undefined)
  useEffect(() => {
    void window.malevo.stars.get(id).then(setStar)
  }, [id, props.snapshot.version])
  if (star === undefined) return <div className="tool-page muted">Finding the star…</div>
  if (star === null) return <div className="tool-page">There is no star “{id}”.</div>
  const systems = props.snapshot.systems.filter((s) => s.starId === id)
  const legLimit = props.snapshot.physics?.legLimit_ly ?? null
  const fromSol = Math.hypot(...star.pos)
  return (
    <div className="detail-page" data-detail={`star:${id}`}>
      <header className="detail-head">
        <span className="detail-dot star" />
        <div>
          <h1>{star.name ?? 'Unnamed star'}</h1>
          <p className="muted">
            star{star.spect ? `, ${star.spect}` : ''} · <code>{star.id}</code>
            {star.generated && ' · generated'}
          </p>
        </div>
      </header>
      <ActionRow refd={{ kind: 'star', id }} props={props} skip="Details" />
      <div className="detail-columns">
        <div>
          {systems.length ? (
            systems.map((s) => (
              <section key={s.id}>
                <h3>
                  <button
                    className="link"
                    data-ref={`system:${s.id}`}
                    onClick={() => props.open({ type: 'systems', params: { focus: s.id } })}
                  >
                    {s.name}
                  </button>
                </h3>
                <ArticleTeaser path={`systems/${s.id}.md`} props={props} />
                <ul className="detail-list">
                  {s.bodies
                    .filter((b) => !b.parent)
                    .map((b) => (
                      <li key={b.id}>
                        <button
                          className="link"
                          data-ref={`body:${b.id}`}
                          onClick={() => props.open({ type: 'body', params: { id: b.id } })}
                        >
                          {b.name}
                        </button>{' '}
                        <span className="muted small">{bodyKindLabel(b, s)}</span>
                      </li>
                    ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="muted">No system on this star yet; make one from the star map.</p>
          )}
        </div>
        <dl className="facts compact detail-facts">
          {systems[0] && <Holders system={systems[0]} props={props} />}
          <dt className="facts-group">The star</dt>
          <dd />
          <dt>Type</dt>
          <dd>{star.spect || '—'}</dd>
          <dt>Temperature</dt>
          <dd>{sig(star.teff, 4)} K</dd>
          <dt>Luminosity</dt>
          <dd>{sig(star.luminosity, 3)} L☉</dd>
          <dt>Mass</dt>
          <dd>{star.mass === null ? 'unknown (not main sequence)' : `${sig(star.mass, 3)} M☉`}</dd>
          <dt>Radius</dt>
          <dd>{sig(star.radius, 3)} R☉</dd>
          <dt>Apparent magnitude</dt>
          <dd>{sig(star.mag, 3)} from Sol</dd>
          <dt className="facts-group">Where</dt>
          <dd />
          <dt>From Sol</dt>
          <dd>
            {sig(fromSol, 4)} ly
            {legLimit !== null && fromSol > 0 && <span className="muted"> · {Math.ceil(fromSol / legLimit)} legs at least</span>}
          </dd>
          {systems[0]?.habitableZone && (
            <>
              <dt>Habitable zone</dt>
              <dd>
                {sig(systems[0].habitableZone[0] / AU, 3)}–{sig(systems[0].habitableZone[1] / AU, 3)} AU
              </dd>
            </>
          )}
          {systems[0]?.collapse && (
            <>
              <dt>Foam collapse</dt>
              <dd>{sig(systems[0].collapse / AU, 3)} AU</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  )
}

// ---- the quickest way somewhere ----

/** The quickest chain of foam legs from one place to another, worked out on the spot (nothing is written until kept as a route). */
export function RouteToBlade(props: ToolProps): React.JSX.Element {
  const to = props.params.to ?? ''
  const systems = props.snapshot.systems
  const toSystem = to.startsWith('system:') ? to.slice(7) : null
  const [from, setFrom] = useState<string>(props.params.from ?? `system:${systems.find((s) => s.id !== toSystem)?.id ?? ''}`)
  const [plan, setPlan] = useState<RoutePlanDto | null | undefined>(undefined)
  const [kept, setKept] = useState<string | null>(null)
  useEffect(() => {
    if (!from || !to || from === to) return setPlan(null)
    let live = true
    setPlan(undefined)
    void window.malevo.routes.plan(from, to).then((p) => live && setPlan(p))
    return () => {
      live = false
    }
  }, [from, to, props.snapshot.version])
  const nodeName = (n: string): string => {
    const [kind, id] = [n.slice(0, n.indexOf(':')), n.slice(n.indexOf(':') + 1)]
    if (kind === 'system') return systems.find((s) => s.id === id)?.name ?? id
    if (kind === 'station') return String(props.snapshot.stations.find((s) => s.id === id)?.value?.name ?? id)
    return refLabel({ kind, id }, props.snapshot)
  }
  const wpName = (w: Record<string, string>): string =>
    w.system ? nodeName(`system:${w.system}`) : w.station ? nodeName(`station:${w.station}`) : `star ${w.star}`
  const keep = async (): Promise<void> => {
    if (!plan) return
    const name = `${nodeName(from)} – ${nodeName(to)}`
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'route'
    let id = base
    for (let n = 2; props.snapshot.routes.some((r) => r.id === id); n++) id = `${base}-${n}`
    await window.malevo.world.setEntity('route', id, { name, waypoints: plan.waypoints })
    setKept(id)
  }
  return (
    <div className="detail-page" data-detail={`route-to:${to}`}>
      <header className="detail-head">
        <div>
          <h1>To {nodeName(to)}</h1>
          <p className="muted">the quickest chain of legs through the stars</p>
        </div>
      </header>
      <label className="field">
        From
        <select value={from} onChange={(e) => setFrom(e.target.value)} id="routeToFrom">
          {systems.map((s) => (
            <option key={s.id} value={`system:${s.id}`}>
              {s.name}
            </option>
          ))}
          {props.snapshot.stations.map((s) => (
            <option key={s.id} value={`station:${s.id}`}>
              {String(s.value?.name ?? s.id)} (station)
            </option>
          ))}
        </select>
      </label>
      {plan === undefined ? (
        <p className="muted">Working it out…</p>
      ) : plan === null ? (
        <p className="warning">No chain of legs within the leg limit joins these (within the search radius, clear of nebulae).</p>
      ) : (
        <>
          <p id="routeToSummary">
            <strong>{duration(plan.duration)}</strong> in the foam, over {sig(plan.ly, 4)} ly in {plan.waypoints.length - 1}{' '}
            {plan.waypoints.length === 2 ? 'leg' : 'legs'}, stopovers included.
          </p>
          <ol className="detail-list">
            {plan.waypoints.map((w, k) => (
              <li key={k} data-ref={w.system ? `system:${w.system}` : w.station ? `station:${w.station}` : `star:${w.star}`}>
                {wpName(w)}
              </li>
            ))}
          </ol>
          {kept ? (
            <p>
              Kept as a route.{' '}
              <button className="link" onClick={() => props.open({ type: 'routes', params: { route: kept } })}>
                Open it in Routes
              </button>
            </p>
          ) : (
            <button onClick={() => void keep()} id="keepRoute">
              Keep it as a route
            </button>
          )}
        </>
      )}
    </div>
  )
}

export type { BodyInfoDto }
