import { useEffect, useMemo, useState } from 'react'
import { nodeWaypoint, waypointNode, type RouteFile, type Waypoint } from '@malevo/model'
import type { BalanceSuggestionDto, EntityDto, RouteInfoDto, StarField, StarSearchHit, WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { StarMap, type MapSystem } from '../stars/StarMap'
import { NEBULA_COLOR, ROUTE_COLOR, mapNebulae, mapRoutes, mapStations } from './mapData'

type Tab = 'routes' | 'stations' | 'nebulae' | 'balance'
type Service = NonNullable<RouteFile['services']>[number]

const nodeName = (snapshot: WorldSnapshot, id: string | null): string => (id ? (snapshot.nodes[id]?.name ?? id) : '(nothing)')
const KIND_LABEL = { system: 'system', station: 'station', star: 'star' } as const

function RoutesView({ world, snapshot, focus, navigate }: ToolProps): React.JSX.Element {
  const [tab, setTab] = useWorldPref<Tab>(world.root, 'routesTab', 'routes')
  const [selected, setSelected] = useState<Record<string, string | null>>({})
  const [creating, setCreating] = useState(false)

  // Another tool can point here at a node: show its balance.
  useEffect(() => {
    if (focus) setTab('balance')
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const list: { id: string; name: string; sub: string; color?: string }[] =
    tab === 'routes'
      ? snapshot.routes.map((r) => ({
          id: r.id,
          name: r.name,
          sub: `${nodeName(snapshot, r.nodes[0])} – ${nodeName(snapshot, r.nodes.at(-1) ?? null)}`,
          color: r.color ?? ROUTE_COLOR
        }))
      : tab === 'stations'
        ? snapshot.stations.map((s) => ({ id: s.id, name: String(s.value?.name ?? s.id), sub: 'station' }))
        : tab === 'nebulae'
          ? snapshot.nebulae.map((n) => ({
              id: n.id,
              name: String(n.value?.name ?? n.id),
              sub: 'nebula',
              color: String(n.value?.color ?? NEBULA_COLOR)
            }))
          : []
  const currentId = list.find((x) => x.id === selected[tab])?.id ?? list[0]?.id ?? null
  const select = (id: string): void => setSelected((s) => ({ ...s, [tab]: id }))

  const addStation = async (): Promise<void> => {
    const id = slugId(
      'new station',
      snapshot.stations.map((s) => s.id)
    )
    await window.malevo.world.setEntity('station', id, { name: 'New station', pos_ly: [0, 0, 0] })
    select(id)
  }
  const addNebula = async (): Promise<void> => {
    const id = slugId(
      'new nebula',
      snapshot.nebulae.map((s) => s.id)
    )
    await window.malevo.world.setEntity('nebula', id, { name: 'New nebula', center_ly: [0, 0, 0], radii_ly: [5, 5, 5] })
    select(id)
  }

  if (!snapshot.physics) {
    return (
      <div className="tool-page">
        <h1>Routes</h1>
        <p>This world has no settings/physics.json, which sets the leg limit, top speed and balance tolerance.</p>
        <button className="primary" onClick={() => navigate('checks')}>
          Add it from the Checks tool
        </button>
      </div>
    )
  }

  return (
    <div className="split-tool">
      <nav className="split-list">
        <div className="seg tabs">
          {(['routes', 'stations', 'nebulae', 'balance'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-tab={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {tab !== 'balance' && (
          <>
            <ul>
              {list.map((x) => (
                <li key={x.id}>
                  <button
                    className={x.id === currentId && !creating ? 'list-item is-current' : 'list-item'}
                    onClick={() => {
                      setCreating(false)
                      select(x.id)
                    }}
                    data-entity={x.id}
                  >
                    <span>
                      {x.color && <span className="swatch" style={{ background: x.color }} />} {x.name}
                    </span>
                    <span className="muted small">{x.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p className="muted small">None yet.</p>}
            <button
              className="primary"
              id="addEntity"
              onClick={() => (tab === 'routes' ? setCreating(true) : tab === 'stations' ? void addStation() : void addNebula())}
            >
              New {tab === 'routes' ? 'route' : tab === 'stations' ? 'station' : 'nebula'}
            </button>
          </>
        )}
        {tab === 'balance' && (
          <p className="muted small">
            Ships arriving and leaving each place, per standard day, summed over every route. Each node should balance unless it is declared
            a sink or a source.
          </p>
        )}
      </nav>
      <div className="split-detail">
        {tab === 'routes' && creating && (
          <NewRoute
            snapshot={snapshot}
            onDone={(id) => {
              setCreating(false)
              if (id) select(id)
            }}
          />
        )}
        {tab === 'routes' &&
          !creating &&
          (() => {
            const r = snapshot.routes.find((x) => x.id === currentId)
            return r ? <RouteEditor key={r.id} route={r} snapshot={snapshot} /> : <p className="tool-page muted">Make a route to start.</p>
          })()}
        {tab === 'stations' &&
          (() => {
            const s = snapshot.stations.find((x) => x.id === currentId)
            return s ? <StationEditor key={s.id} entity={s} /> : <p className="tool-page muted">No stations yet.</p>
          })()}
        {tab === 'nebulae' &&
          (() => {
            const n = snapshot.nebulae.find((x) => x.id === currentId)
            return n ? <NebulaEditor key={n.id} entity={n} /> : <p className="tool-page muted">No nebulae yet.</p>
          })()}
        {tab === 'balance' && <Balance snapshot={snapshot} focus={focus} navigate={navigate} />}
      </div>
    </div>
  )
}

// ---- picking a node ----

/** A system or station from a list, or any star by search. */
function NodePicker({
  snapshot,
  onPick,
  label,
  id
}: {
  snapshot: WorldSnapshot
  onPick(w: Waypoint, name: string): void
  label: string
  id?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StarSearchHit[]>([])
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    const h = setTimeout(() => void window.malevo.stars.search(q).then(setHits), 150)
    return () => clearTimeout(h)
  }, [query])
  return (
    <div className="node-picker">
      <label className="field">
        {label}
        <select
          value=""
          id={id}
          onChange={(e) => {
            if (e.target.value) onPick(nodeWaypoint(e.target.value), e.target.selectedOptions[0]?.textContent ?? e.target.value)
          }}
        >
          <option value="">Choose a system or station…</option>
          {snapshot.systems.map((s) => (
            <option key={s.id} value={`system:${s.id}`}>
              {s.name}
            </option>
          ))}
          {snapshot.stations.map((s) => (
            <option key={s.id} value={`station:${s.id}`}>
              {String(s.value?.name ?? s.id)} (station)
            </option>
          ))}
        </select>
      </label>
      <input className="search" placeholder="…or find a star" value={query} onChange={(e) => setQuery(e.target.value)} />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id}>
              <button
                className="list-item"
                data-hit={h.id}
                onClick={() => {
                  onPick(h.system ? { system: h.system } : { star: h.id }, h.name)
                  setQuery('')
                }}
              >
                <span>{h.name}</span>
                <span className="muted small">{h.system ? 'system' : `${sig(h.distance, 3)} ly from Sol`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewRoute({ snapshot, onDone }: { snapshot: WorldSnapshot; onDone(id: string | null): void }): React.JSX.Element {
  const [from, setFromW] = useState<{ w: Waypoint; name: string } | null>(null)
  const [to, setToW] = useState<{ w: Waypoint; name: string } | null>(null)
  const setFrom = (w: Waypoint, name: string): void => setFromW({ w, name: name.replace(/ \(station\)$/, '') })
  const setTo = (w: Waypoint, name: string): void => setToW({ w, name: name.replace(/ \(station\)$/, '') })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const label = (p: { name: string } | null): string => p?.name ?? '—'

  const create = async (plan: boolean): Promise<void> => {
    if (!from || !to) return
    setBusy(true)
    setNote(null)
    let waypoints: Waypoint[] = [from.w, to.w]
    if (plan) {
      const p = await window.malevo.routes.plan(waypointNode(from.w)!, waypointNode(to.w)!)
      if (!p) {
        setBusy(false)
        setNote('No chain of legs within the leg limit joins these two (within the search radius, clear of nebulae).')
        return
      }
      waypoints = p.waypoints as Waypoint[]
    }
    const name = `${label(from)} – ${label(to)}`
    const id = slugId(
      name,
      snapshot.routes.map((r) => r.id)
    )
    await window.malevo.world.setEntity('route', id, { name, waypoints })
    setBusy(false)
    onDone(id)
  }

  return (
    <div className="tool-page" id="newRoute">
      <h2>New route</h2>
      <div className="field-row">
        <div>
          <NodePicker snapshot={snapshot} label="From" onPick={setFrom} id="routeFrom" />
          <p className="small">
            <strong>{label(from)}</strong>
          </p>
        </div>
        <div>
          <NodePicker snapshot={snapshot} label="To" onPick={setTo} id="routeTo" />
          <p className="small">
            <strong>{label(to)}</strong>
          </p>
        </div>
      </div>
      <div className="inspector-actions">
        <button className="primary" disabled={!from || !to || busy} onClick={() => void create(true)} id="planRoute">
          {busy ? 'Planning…' : 'Plan through the stars'}
        </button>
        <button disabled={!from || !to || busy} onClick={() => void create(false)}>
          Direct, one leg
        </button>
        <button onClick={() => onDone(null)}>Cancel</button>
      </div>
      {note && <p className="warning">{note}</p>}
      <p className="muted small">
        Planning finds the quickest chain of legs, each within the leg limit and clear of nebulae, stopping at stars or stations on the way.
        You can change the waypoints afterwards.
      </p>
    </div>
  )
}

// ---- a route ----

/** Waypoint indices after removing one: services that ended there are dropped. */
function servicesWithout(services: Service[], i: number): Service[] {
  return services
    .filter((s) => s.from !== i && s.to !== i)
    .map((s) => ({ ...s, from: s.from > i ? s.from - 1 : s.from, to: s.to > i ? s.to - 1 : s.to }))
}

function servicesSwapped(services: Service[], i: number, j: number): Service[] {
  const m = (k: number): number => (k === i ? j : k === j ? i : k)
  return services.map((s) => ({ ...s, from: m(s.from), to: m(s.to) })).filter((s) => s.from !== s.to)
}

function RouteEditor({ route, snapshot }: { route: RouteInfoDto; snapshot: WorldSnapshot }): React.JSX.Element {
  const v = route.value as unknown as RouteFile
  const services = v.services ?? []
  const [note, setNote] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const save = (patch: Partial<RouteFile>): void => void window.malevo.world.setEntity('route', route.id, { ...v, ...patch })
  const setServices = (s: Service[]): void => save({ services: s.length ? s : undefined })
  const last = v.waypoints.length - 1
  const nebulaName = (id: string): string => String(snapshot.nebulae.find((n) => n.id === id)?.value?.name ?? id)

  const replan = async (): Promise<void> => {
    const a = route.nodes[0]
    const b = route.nodes[last]
    if (!a || !b) return
    setPlanning(true)
    setNote(null)
    const p = await window.malevo.routes.plan(a, b)
    setPlanning(false)
    if (!p) {
      setNote('No chain of legs within the leg limit joins the ends (within the search radius, clear of nebulae).')
      return
    }
    const n = p.waypoints.length - 1
    const kept = services
      .filter((s) => (s.from === 0 && s.to === last) || (s.from === last && s.to === 0))
      .map((s) => ({ ...s, from: s.from === 0 ? 0 : n, to: s.to === 0 ? 0 : n }))
    if (kept.length < services.length) setNote(`${services.length - kept.length} service(s) that did not run end to end were removed.`)
    save({ waypoints: p.waypoints as Waypoint[], services: kept.length ? kept : undefined })
  }

  const remove = (): void => {
    if (window.confirm(`Delete the route "${v.name}"? (Unsaved; you can undo.)`)) void window.malevo.world.deleteEntity('route', route.id)
  }

  const fleet = route.services.reduce((s, x) => s + (x.fleet ?? 0), 0)
  const legFor = (i: number): RouteInfoDto['legs'][number] | undefined => route.legs.find((l) => l.index === i)
  const wpOptions = route.nodes.map((n, i) => (
    <option key={i} value={i}>
      {i + 1}. {nodeName(snapshot, n)}
    </option>
  ))

  return (
    <div className="tool-page wide" data-route={route.id}>
      <div className="field-row">
        <TextField label="Route name" value={v.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} id="routeName" />
        <label className="field">
          Colour
          <input type="color" value={v.color ?? ROUTE_COLOR} onChange={(e) => save({ color: e.target.value })} />
        </label>
        <div className="inspector-actions">
          <button className="danger" onClick={remove}>
            Delete…
          </button>
        </div>
      </div>
      <p className="muted">
        {route.length !== null ? `${sig(route.length, 4)} ly` : 'Length unknown'} in {route.legs.length} leg
        {route.legs.length === 1 ? '' : 's'}
        {fleet > 0 && <> · {sig(fleet, 3)} ships under way or docked on its services</>}
      </p>

      <h3>Waypoints</h3>
      <table className="units route-legs" id="waypoints">
        <thead>
          <tr>
            <th>#</th>
            <th>Place</th>
            <th>Next leg</th>
            <th>In the foam</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {v.waypoints.map((w, i) => {
            const node = route.nodes[i]
            const leg = legFor(i)
            const info = node ? snapshot.nodes[node] : null
            return (
              <tr key={i} data-waypoint={i}>
                <td className="muted">{i + 1}</td>
                <td>
                  {node ? nodeName(snapshot, node) : <span className="error">names no single place</span>}{' '}
                  <span className="muted small">{info ? KIND_LABEL[info.kind] : ''}</span>
                  {info && !info.pos && <span className="error small"> · not found</span>}
                </td>
                <td>
                  {i < last &&
                    (leg?.ly != null ? (
                      <span className={leg.tooLong ? 'error' : ''}>
                        {sig(leg.ly, 4)} ly{leg.tooLong && ' · too long'}
                      </span>
                    ) : (
                      '—'
                    ))}
                  {leg && leg.nebulae.length > 0 && (
                    <span className="error small"> · crosses {leg.nebulae.map(nebulaName).join(', ')}</span>
                  )}
                </td>
                <td>{i < last && duration(leg?.foam)}</td>
                <td className="row-actions">
                  <button
                    disabled={i === 0}
                    title="Move up"
                    onClick={() => {
                      const wps = [...v.waypoints]
                      ;[wps[i - 1], wps[i]] = [wps[i], wps[i - 1]]
                      save({ waypoints: wps, services: servicesSwapped(services, i - 1, i) })
                    }}
                  >
                    ↑
                  </button>
                  <button
                    disabled={i === last}
                    title="Move down"
                    onClick={() => {
                      const wps = [...v.waypoints]
                      ;[wps[i + 1], wps[i]] = [wps[i], wps[i + 1]]
                      save({ waypoints: wps, services: servicesSwapped(services, i, i + 1) })
                    }}
                  >
                    ↓
                  </button>
                  <button
                    disabled={v.waypoints.length <= 2}
                    title="Remove"
                    onClick={() => {
                      const s = servicesWithout(services, i)
                      save({ waypoints: v.waypoints.filter((_, k) => k !== i), services: s.length ? s : undefined })
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="field-row">
        <NodePicker
          snapshot={snapshot}
          label="Add a waypoint at the end"
          onPick={(w) => save({ waypoints: [...v.waypoints, w] })}
          id="addWaypoint"
        />
        <div className="inspector-actions">
          <button onClick={() => void replan()} disabled={planning} id="replan">
            {planning ? 'Planning…' : 'Re-plan between the ends'}
          </button>
        </div>
      </div>
      {note && <p className="warning">{note}</p>}

      <h3>Services</h3>
      <p className="muted small">
        Each service runs one way, stopping at every waypoint between its ends. The two directions are separate numbers, and either can be
        zero.
      </p>
      {services.length > 0 && (
        <table className="units services" id="services">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Ships/day</th>
              <th>Door to door</th>
              <th>Fleet</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {services.map((s, k) => {
              const info = route.services[k]
              const set = (patch: Partial<Service>): void => setServices(services.map((x, j) => (j === k ? { ...x, ...patch } : x)))
              return (
                <tr key={k} data-service={k}>
                  <td>
                    <select value={s.from} onChange={(e) => set({ from: Number(e.target.value) })} aria-label="From">
                      {wpOptions}
                    </select>
                  </td>
                  <td>
                    <select value={s.to} onChange={(e) => set({ to: Number(e.target.value) })} aria-label="To">
                      {wpOptions}
                    </select>
                  </td>
                  <td>
                    <NumberField label="" value={s.perDay} onCommit={(n) => n !== undefined && n >= 0 && set({ perDay: n })} />
                  </td>
                  <td>{info?.error ? <span className="error small">{info.error}</span> : duration(info?.duration)}</td>
                  <td>{sig(info?.fleet, 3)}</td>
                  <td>
                    <TextField label="" value={s.note ?? ''} onCommit={(t) => set({ note: t.trim() || undefined })} />
                  </td>
                  <td>
                    <button title="Remove" onClick={() => setServices(services.filter((_, j) => j !== k))}>
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="inspector-actions">
        <button onClick={() => setServices([...services, { from: 0, to: last, perDay: 1 }])} id="addServiceForward">
          Add {nodeName(snapshot, route.nodes[0])} → {nodeName(snapshot, route.nodes[last])}
        </button>
        <button onClick={() => setServices([...services, { from: last, to: 0, perDay: 1 }])} id="addServiceBack">
          Add {nodeName(snapshot, route.nodes[last])} → {nodeName(snapshot, route.nodes[0])}
        </button>
      </div>

      <RouteMap route={route} snapshot={snapshot} />
    </div>
  )
}

function RouteMap({ route, snapshot }: { route: RouteInfoDto; snapshot: WorldSnapshot }): React.JSX.Element {
  const points = route.nodes.map((n) => (n ? snapshot.nodes[n]?.pos : null)).filter((p): p is [number, number, number] => Boolean(p))
  const key = points.flat().join(',')
  const center = useMemo<[number, number, number]>(() => {
    if (!points.length) return [0, 0, 0]
    const c = [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k], 0) / points.length)
    return [c[0], c[1], c[2]]
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const radius = Math.min(80, Math.max(10, ...points.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) + 5)))
  const [field, setField] = useState<StarField | null>(null)
  useEffect(() => {
    let live = true
    void window.malevo.stars.near(center, radius, false).then((f) => live && setField(f))
    return () => {
      live = false
    }
  }, [center, radius])
  const systems: MapSystem[] = useMemo(
    () =>
      snapshot.systems
        .filter((s) => s.star)
        .map((s) => ({ id: s.id, name: s.name, pos: s.star!.pos }))
        .concat(mapStations(snapshot)),
    [snapshot]
  )
  const routes = useMemo(() => mapRoutes(snapshot, route.id), [snapshot, route.id])
  const nebulae = useMemo(() => mapNebulae(snapshot), [snapshot])
  return (
    <div className="map-pane route-map">
      <StarMap
        field={field}
        focus={center}
        systems={systems}
        selected={null}
        onPick={() => {}}
        reach={null}
        routes={routes}
        nebulae={nebulae}
      />
    </div>
  )
}

// ---- stations and nebulae ----

function PointFields({
  label,
  value,
  onCommit,
  positive
}: {
  label: string
  value: number[]
  onCommit(v: number[]): void
  positive?: boolean
}): React.JSX.Element {
  return (
    <div className="field-row">
      {(['x', 'y', 'z'] as const).map((axis, k) => (
        <NumberField
          key={axis}
          label={`${label} ${axis}, ly`}
          value={value[k]}
          onCommit={(n) => {
            if (n === undefined || (positive && n <= 0)) return
            const next = [...value]
            next[k] = n
            onCommit(next)
          }}
        />
      ))}
    </div>
  )
}

function StationEditor({ entity }: { entity: EntityDto }): React.JSX.Element {
  const v = entity.value as { name: string; pos_ly: number[]; declaredNet_perDay?: number } | null
  if (!v) return <p className="tool-page error">This station's file has errors. See Checks, or fix {entity.path} by hand.</p>
  const save = (patch: object): void => void window.malevo.world.setEntity('station', entity.id, { ...v, ...patch })
  return (
    <div className="tool-page" data-station={entity.id}>
      <div className="field-row">
        <TextField label="Station name" value={v.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} />
        <div className="inspector-actions">
          <button
            className="danger"
            onClick={() =>
              window.confirm(`Delete the station "${v.name}"? (Unsaved; you can undo.)`) &&
              void window.malevo.world.deleteEntity('station', entity.id)
            }
          >
            Delete…
          </button>
        </div>
      </div>
      <PointFields label="Position" value={v.pos_ly} onCommit={(pos_ly) => save({ pos_ly })} />
      <NumberField
        label="Declared net, ships/day"
        value={v.declaredNet_perDay}
        optional
        hint="Positive for a sink, negative for a source."
        onCommit={(n) => save({ declaredNet_perDay: n })}
      />
      <p className="muted small">
        A station sits in open space, away from any star's collapse zone, so ships drop out of the foam right beside it: there is no crawl.
        Positions are galactic light-years from Sol.
      </p>
    </div>
  )
}

function NebulaEditor({ entity }: { entity: EntityDto }): React.JSX.Element {
  const v = entity.value as { name: string; center_ly: number[]; radii_ly: number[]; color?: string } | null
  if (!v) return <p className="tool-page error">This nebula's file has errors. See Checks, or fix {entity.path} by hand.</p>
  const save = (patch: object): void => void window.malevo.world.setEntity('nebula', entity.id, { ...v, ...patch })
  return (
    <div className="tool-page" data-nebula={entity.id}>
      <div className="field-row">
        <TextField label="Nebula name" value={v.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} />
        <label className="field">
          Colour
          <input type="color" value={v.color ?? NEBULA_COLOR} onChange={(e) => save({ color: e.target.value })} />
        </label>
        <div className="inspector-actions">
          <button
            className="danger"
            onClick={() =>
              window.confirm(`Delete the nebula "${v.name}"? (Unsaved; you can undo.)`) &&
              void window.malevo.world.deleteEntity('nebula', entity.id)
            }
          >
            Delete…
          </button>
        </div>
      </div>
      <PointFields label="Centre" value={v.center_ly} onCommit={(center_ly) => save({ center_ly })} />
      <PointFields label="Radius" value={v.radii_ly} positive onCommit={(radii_ly) => save({ radii_ly })} />
      <p className="muted small">An ellipsoid the foam cannot cross. No leg may pass through it, and the route planner goes around.</p>
    </div>
  )
}

// ---- balance ----

function Balance({
  snapshot,
  focus,
  navigate
}: {
  snapshot: WorldSnapshot
  focus: string | null
  navigate: ToolProps['navigate']
}): React.JSX.Element {
  const t = snapshot.traffic
  const [proposal, setProposal] = useState<BalanceSuggestionDto | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setProposal(null), [snapshot.version])
  if (!t) return <p className="tool-page muted">Balance needs settings/physics.json.</p>

  const suggest = async (): Promise<void> => {
    setBusy(true)
    setProposal(await window.malevo.routes.balance())
    setBusy(false)
  }
  const accept = async (items: BalanceSuggestionDto['suggestions']): Promise<void> => {
    const byRoute = new Map<string, BalanceSuggestionDto['suggestions']>()
    for (const s of items) byRoute.set(s.route, [...(byRoute.get(s.route) ?? []), s])
    for (const [id, add] of byRoute) {
      const r = snapshot.routes.find((x) => x.id === id)
      if (!r) continue
      const v = r.value as unknown as RouteFile
      const services = [
        ...(v.services ?? []),
        ...add.map((s) => ({ from: s.from, to: s.to, perDay: Number(s.perDay.toPrecision(6)), note: 'balancing' }))
      ]
      await window.malevo.world.setEntity('route', id, { ...v, services })
    }
  }
  const setDeclared = (node: string, n: number | undefined): void => {
    const info = snapshot.nodes[node]
    if (!info) return
    if (info.kind === 'station') {
      const s = snapshot.stations.find((x) => `station:${x.id}` === node)
      if (s?.value) void window.malevo.world.setEntity('station', s.id, { ...s.value, declaredNet_perDay: n })
    } else if (info.system) {
      const s = snapshot.systems.find((x) => x.id === info.system)
      if (s) void window.malevo.world.setEntity('system', s.id, { ...s.value, declaredNet_perDay: n })
    }
  }
  const routeName = (id: string): string => snapshot.routes.find((r) => r.id === id)?.name ?? id
  const stopsOf = (s: BalanceSuggestionDto['suggestions'][number]): string => {
    const r = snapshot.routes.find((x) => x.id === s.route)
    if (!r) return ''
    const step = s.from < s.to ? 1 : -1
    const names: string[] = []
    for (let i = s.from; i !== s.to + step; i += step) names.push(nodeName(snapshot, r.nodes[i]))
    return names.join(' → ')
  }

  return (
    <div className="tool-page wide" id="balance">
      <h2>Traffic balance</h2>
      <p className="muted">
        {sig(t.fleet, 4)} ships tied up by all services (frequency × door-to-door time, Little's law)
        {t.unknownDurations > 0 && `, not counting ${t.unknownDurations} service(s) whose trip time is unknown`}.
      </p>
      {Math.abs(t.declaredTotal) > 1e-6 && (
        <p className="warning" id="declaredTotal">
          Declared imbalances add up to {sig(t.declaredTotal, 4)} ships/day, not 0. Every ship that arrives somewhere left somewhere else,
          so sinks must be matched by sources.
        </p>
      )}
      {t.nodes.length === 0 ? (
        <p className="muted">No traffic yet. Add services to routes.</p>
      ) : (
        <table className="units balance" id="balanceTable">
          <thead>
            <tr>
              <th>Place</th>
              <th>Arrive</th>
              <th>Leave</th>
              <th>Passing through</th>
              <th>Net</th>
              <th>Declared</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {t.nodes.map((b) => {
              const info = snapshot.nodes[b.node]
              const editable = info && (info.kind === 'station' || info.system)
              return (
                <tr key={b.node} data-node={b.node} className={b.node === focus ? 'is-current' : ''}>
                  <td>
                    {info?.system ? (
                      <button className="link" onClick={() => navigate('systems', info.system!)}>
                        {nodeName(snapshot, b.node)}
                      </button>
                    ) : (
                      nodeName(snapshot, b.node)
                    )}{' '}
                    <span className="muted small">{info ? KIND_LABEL[info.kind] : ''}</span>
                  </td>
                  <td>{sig(b.arrivals, 4)}</td>
                  <td>{sig(b.departures, 4)}</td>
                  <td>{sig(b.through, 4)}</td>
                  <td>
                    {b.net > 0 ? '+' : ''}
                    {sig(b.net, 4)}
                  </td>
                  <td>
                    {editable ? (
                      <NumberField
                        label=""
                        value={b.declared || undefined}
                        optional
                        placeholder="0"
                        onCommit={(n) => setDeclared(b.node, n)}
                      />
                    ) : (
                      sig(b.declared, 3)
                    )}
                  </td>
                  <td className={b.unbalanced ? 'warning' : 'ok'}>{b.unbalanced ? `off by ${sig(b.imbalance, 3)}` : 'balanced'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Net is arrivals minus departures: positive means ships pile up there. A node may be off by up to its tolerance (a share of its
        traffic, or a floor in ships/day, from the physics settings) without a warning.
      </p>

      <h3>Balancing helper</h3>
      <p className="muted small">
        Proposes the least extra traffic, in ship-days, that brings every place to its declared imbalance, using the legs of existing routes
        in either direction. Nothing changes until you add a suggestion.
      </p>
      <button onClick={() => void suggest()} disabled={busy} id="suggestBalance">
        {busy ? 'Working…' : 'Suggest return traffic'}
      </button>
      {proposal && (
        <div className="balance-proposal" id="balanceProposal">
          {proposal.suggestions.length === 0 && Object.keys(proposal.remaining).length === 0 && (
            <p className="ok">Nothing to add: it balances.</p>
          )}
          {proposal.suggestions.length > 0 && (
            <>
              <ul>
                {proposal.suggestions.map((s, k) => (
                  <li key={k} data-suggestion={k}>
                    <strong>{sig(s.perDay, 4)}/day</strong> {stopsOf(s)} <span className="muted small">on {routeName(s.route)}</span>{' '}
                    <button className="link" onClick={() => void accept([s])}>
                      Add
                    </button>
                  </li>
                ))}
              </ul>
              <button className="primary" onClick={() => void accept(proposal.suggestions)} id="acceptAll">
                Add all as services
              </button>
            </>
          )}
          {Object.keys(proposal.remaining).length > 0 && (
            <p className="warning">
              No route can carry the rest:{' '}
              {Object.entries(proposal.remaining)
                .map(([n, x]) => `${nodeName(snapshot, n)} ${x > 0 ? '+' : ''}${sig(x, 3)}`)
                .join(', ')}
              . Add a route, or declare those imbalances.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export const routesTool: ToolDefinition = {
  id: 'routes',
  title: 'Routes',
  description: 'Legs, routes and one-way services between systems; traffic balance and the fleet it needs',
  View: RoutesView
}
