import { useEffect, useMemo, useRef, useState } from 'react'
import { cityServices, vehiclesAt, type PlanInput } from '@malevo/gen'
import { newCityPlan } from '@malevo/model'
import type { EntityDto, PlanGeometryDto, PortCapacityDto, TravelDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { CityPlan3D } from './CityPlan3D'

type XY = [number, number]

type ListKey = 'ground' | 'water' | 'lines' | 'regions' | 'buildings' | 'points'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any> & { id: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = Record<string, any> & { city: string; extent: number[] }

type Mode =
  | { kind: 'select' }
  | { kind: 'draw'; list: 'ground' | 'water' | 'regions' | 'lines'; sub: string; points: XY[] }
  | { kind: 'place'; list: 'buildings' | 'points'; sub: string }
  | { kind: 'travel'; from: XY | null }

const SURFACE_FILL: Record<string, string> = { grass: '#5d7d4a', mud: '#7a6a52', paved: '#6c6c70', sand: '#c8b080', rock: '#8a8278' }
const LINE_COLOUR: Record<string, string> = {
  street: '#2a2a2e',
  avenue: '#202024',
  highway: '#1c1c20',
  stairs: '#a09a90',
  lightrail: '#8a3f3f',
  heavyrail: '#5a4030',
  fieldline: '#3f5f8a',
  funicular: '#b04a2a',
  siding: '#5a4030',
  seawall: '#9a948a',
  barrage: '#6a5040',
  breakwater: '#8a8680',
  pier: '#7a6650'
}
const LINE_KINDS = Object.keys(LINE_COLOUR)
const PRESETS = ['buildings', 'cliff', 'yards', 'scatter', 'empty']
const PRESET_DEFAULTS: Record<string, unknown> = {
  buildings: { block: [90, 90], street: 14, lot: [26, 62], perBlock: [1, 2], height: { kind: 'random', min: 10, max: 40, skew: 1.5 } },
  cliff: { minStep: 20, stripWidth: [14, 44], terrace: [12, 21] },
  yards: { angle: 0, pitch: 75, row: 300 },
  scatter: { density: 40, houseShare: 0.5 },
  empty: {}
}

function CityPlanView({ world, snapshot, now, focus }: ToolProps): React.JSX.Element {
  const [pref, setPref] = useWorldPref<string | null>(world.root, 'planCity', null)
  const cities = snapshot.cities
  const city = cities.find((c) => c.id === (focus ?? pref)) ?? cities[0] ?? null
  const planEntity = city ? (snapshot.cityPlans.find((p) => p.value?.city === city.id) ?? null) : null

  if (!cities.length)
    return (
      <div className="tool-page">
        <h1>City planner</h1>
        <p>A plan belongs to a city. Make one in the Population tool first.</p>
      </div>
    )
  return (
    <div className="split-tool">
      <nav className="split-list">
        <h2>City planner</h2>
        <ul>
          {cities.map((c) => (
            <li key={c.id}>
              <button
                className={c.id === city?.id ? 'list-item is-current' : 'list-item'}
                onClick={() => setPref(c.id)}
                data-plan-city={c.id}
              >
                <span>{String(c.value.name)}</span>
                <span className="muted small">{snapshot.cityPlans.some((p) => p.value?.city === c.id) ? 'planned' : 'no plan'}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="split-detail">
        {city && !planEntity && (
          <div className="tool-page">
            <h1>{String(city.value.name)}</h1>
            <p>
              No plan yet. A plan lays out the city in metres around its own origin: ground and cliffs, water, roads and rail with their
              services, generated districts and landmarks.
            </p>
            <button
              className="primary"
              id="startPlan"
              onClick={() =>
                void window.malevo.world.setEntity(
                  'cityPlan',
                  slugId(
                    city.id,
                    snapshot.cityPlans.map((p) => p.id)
                  ),
                  newCityPlan(city.id)
                )
              }
            >
              Start a plan
            </button>
          </div>
        )}
        {city && planEntity && planEntity.value && (
          <PlanEditor
            key={planEntity.id}
            entity={planEntity}
            snapshot={snapshot}
            now={now}
            cityName={String(city.value.name)}
            cityId={city.id}
            rootKey={world.root}
          />
        )}
      </div>
    </div>
  )
}

function PlanEditor({
  entity,
  snapshot,
  now,
  cityName,
  cityId,
  rootKey
}: {
  entity: EntityDto
  snapshot: WorldSnapshot
  now: number
  cityName: string
  cityId: string
  rootKey: string
}): React.JSX.Element {
  const plan = entity.value as unknown as Plan
  const save = (next: Plan): void => void window.malevo.world.setEntity('cityPlan', entity.id, next)
  const [geo, setGeo] = useState<PlanGeometryDto | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'select' })
  const [sel, setSel] = useState<{ list: ListKey; id: string } | null>(null)
  const [view, setView] = useWorldPref<'plan' | '3d'>(rootKey, 'planView', 'plan')
  const [hour, setHour] = useState(8)
  const [playing, setPlaying] = useState(false)
  const [travel, setTravel] = useState<TravelDto | null>(null)
  const [travelErr, setTravelErr] = useState<string | null>(null)
  const [port, setPort] = useState<PortCapacityDto | null>(null)
  const [hourLen, setHourLen] = useState(3600)
  const [sun, setSun] = useState<{ alt: number; az: number } | null>(null)

  useEffect(() => {
    let live = true
    void window.malevo.plans.geometry(entity.id).then((g) => live && setGeo(g))
    void window.malevo.plans.port(entity.id).then((p) => live && setPort(p))
    return () => {
      live = false
    }
  }, [entity.id, snapshot.version])
  useEffect(() => {
    void window.malevo.cities.conditions(cityId, now).then((c) => {
      if ('error' in c) return
      if (c.localHours !== null) setHour(Math.round(c.localHours * 100) / 100)
      if (c.localHour_s) setHourLen(c.localHour_s)
      setSun(c.sun)
    })
  }, [cityId, now])
  useEffect(() => {
    if (!playing) return
    const h = setInterval(() => setHour((x) => (x + 1 / 120) % 24), 100)
    return () => clearInterval(h)
  }, [playing])

  const services = useMemo(() => cityServices(plan as unknown as PlanInput), [plan])
  const cars = useMemo(() => vehiclesAt(services, hour * hourLen), [services, hour, hourLen])

  const list = (k: ListKey): Obj[] => (plan[k] ?? []) as Obj[]
  const setList = (k: ListKey, items: Obj[]): void => {
    const next = { ...plan, [k]: items.length ? items : undefined }
    if (!items.length) delete next[k]
    save(next)
  }
  const allIds = (): string[] =>
    (['ground', 'water', 'lines', 'regions', 'buildings', 'points'] as ListKey[]).flatMap((k) => list(k).map((o) => o.id))
  const selected = sel ? (list(sel.list).find((o) => o.id === sel.id) ?? null) : null
  const updateSel = (patch: Record<string, unknown>): void => {
    if (!sel) return
    setList(
      sel.list,
      list(sel.list).map((o) => {
        if (o.id !== sel.id) return o
        const n: Obj = { ...o, ...patch }
        for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k]
        return n
      })
    )
  }

  const addObject = (k: ListKey, o: Omit<Obj, 'id'>, base: string): void => {
    const id = slugId(base, allIds())
    setList(k, [...list(k), { id, ...o } as Obj])
    setSel({ list: k, id })
  }
  const finishDraw = (): void => {
    if (mode.kind !== 'draw') return
    const pts = mode.points.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 2)
    const min = mode.list === 'lines' ? 2 : 3
    if (pts.length >= min) {
      if (mode.list === 'ground')
        addObject('ground', { name: 'Ground', poly: pts, z: plan.defaults?.groundZ ?? 0, surface: mode.sub }, 'ground')
      else if (mode.list === 'water') addObject('water', { name: 'Water', poly: pts, z: 0, kind: mode.sub }, mode.sub)
      else if (mode.list === 'regions')
        addObject('regions', { name: mode.sub, preset: mode.sub, poly: pts, params: PRESET_DEFAULTS[mode.sub] }, mode.sub)
      else addObject('lines', { name: mode.sub, kind: mode.sub, pts }, mode.sub)
    }
    setMode({ kind: 'select' })
  }
  const clickPlan = (p: XY): void => {
    if (mode.kind === 'draw') setMode({ ...mode, points: [...mode.points, p] })
    else if (mode.kind === 'place') {
      if (mode.list === 'buildings') addObject('buildings', { name: 'Landmark', center: p, size: [40, 40], h: 60 }, 'landmark')
      else addObject('points', { name: mode.sub === 'field' ? 'Lighter field' : 'Label', kind: mode.sub, pos: p }, mode.sub)
      setMode({ kind: 'select' })
    } else if (mode.kind === 'travel') {
      if (!mode.from) setMode({ kind: 'travel', from: p })
      else void runTravel(mode.from, p)
    }
  }
  const runTravel = async (from: XY, to: XY | 'orbit'): Promise<void> => {
    const r = await window.malevo.plans.travel(entity.id, from, to, hour * hourLen, hourLen)
    if ('error' in r) {
      setTravelErr(r.error)
      setTravel(null)
    } else {
      setTravelErr(null)
      setTravel(r)
    }
    setMode({ kind: 'travel', from })
  }

  return (
    <div className="tool-page wide cityplan" data-plan={entity.id}>
      <div className="field-row">
        <h1>{cityName}</h1>
        <div className="seg">
          <button className={view === 'plan' ? 'on' : ''} onClick={() => setView('plan')}>
            Plan
          </button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')} id="plan3d">
            3D
          </button>
        </div>
        <label className="field">
          Time of day, local h
          <input type="range" min={0} max={24} step={0.05} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
        </label>
        <span className="muted small">
          {String(Math.floor(hour)).padStart(2, '0')}:{String(Math.floor((hour % 1) * 60)).padStart(2, '0')}
        </span>
        <button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
      </div>

      <div className="plan-toolbar">
        <button className={mode.kind === 'select' ? 'on' : ''} onClick={() => setMode({ kind: 'select' })}>
          Select
        </button>
        <select
          value=""
          onChange={(e) => e.target.value && setMode({ kind: 'draw', list: 'ground', sub: e.target.value, points: [] })}
          aria-label="Draw ground"
        >
          <option value="">Ground…</option>
          {Object.keys(SURFACE_FILL).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => e.target.value && setMode({ kind: 'draw', list: 'water', sub: e.target.value, points: [] })}
          aria-label="Draw water"
        >
          <option value="">Water…</option>
          {['sea', 'river', 'basin'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => e.target.value && setMode({ kind: 'draw', list: 'lines', sub: e.target.value, points: [] })}
          aria-label="Draw a line"
          id="drawLine"
        >
          <option value="">Line…</option>
          {LINE_KINDS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => e.target.value && setMode({ kind: 'draw', list: 'regions', sub: e.target.value, points: [] })}
          aria-label="Draw a district"
          id="drawRegion"
        >
          <option value="">District…</option>
          {PRESETS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          className={mode.kind === 'place' && mode.list === 'buildings' ? 'on' : ''}
          onClick={() => setMode({ kind: 'place', list: 'buildings', sub: 'landmark' })}
        >
          Landmark
        </button>
        <select
          value=""
          onChange={(e) => e.target.value && setMode({ kind: 'place', list: 'points', sub: e.target.value })}
          aria-label="Place a point"
        >
          <option value="">Point…</option>
          {['label', 'station', 'viewpoint', 'field'].map((s) => (
            <option key={s} value={s}>
              {s === 'field' ? 'lighter field' : s}
            </option>
          ))}
        </select>
        <button className={mode.kind === 'travel' ? 'on' : ''} onClick={() => setMode({ kind: 'travel', from: null })} id="planTravel">
          Travel
        </button>
        <span className="muted small">
          {mode.kind === 'draw'
            ? 'Click the corners (or along the line); double-click to finish. Esc cancels.'
            : mode.kind === 'place'
              ? 'Click where it goes.'
              : mode.kind === 'travel'
                ? mode.from
                  ? 'Click where to go.'
                  : 'Click where to start.'
                : 'Click something to edit it; drag to pan, wheel to zoom.'}
        </span>
      </div>

      <div className="plan-layout">
        <div className="plan-canvas">
          {view === 'plan' ? (
            <PlanSvg
              plan={plan}
              geo={geo}
              cars={cars}
              mode={mode}
              sel={sel}
              travel={travel}
              onClick={clickPlan}
              onSelect={(list, id) => mode.kind === 'select' && setSel({ list, id })}
              onFinish={finishDraw}
              onCancel={() => setMode({ kind: 'select' })}
            />
          ) : (
            <CityPlan3D plan={plan} geo={geo} cars={cars} sun={sun} />
          )}
          <p className="muted small">
            {geo ? `${geo.stats.boxes.toLocaleString()} boxes from cityplan@1 · ` : 'Generating… · '}
            {cars.length} cars running at this time of day · metres, x east, y north
          </p>
        </div>

        <div className="plan-side">
          {mode.kind === 'travel' && (
            <div className="plan-panel" id="travelPanel">
              <h3>Travel</h3>
              {mode.from && (
                <button onClick={() => void runTravel(mode.from!, 'orbit')} disabled={!plan.orbit}>
                  From there to orbit
                </button>
              )}
              {travelErr && <p className="error">{travelErr}</p>}
              {travel && (
                <>
                  <p>
                    <strong>{duration(travel.total)}</strong>, leaving at {fmtHour(hour)}, arriving{' '}
                    {fmtHour((travel.arrive / hourLen) % 24)}
                  </p>
                  <ol className="small">
                    {travel.legs.map((l, k) => (
                      <li key={k}>
                        {l.mode === 'walk'
                          ? `walk ${sig(Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]) / 1000, 2)} km`
                          : l.mode === 'wait'
                            ? `wait for the ${l.line}`
                            : l.mode === 'ride'
                              ? `ride the ${l.line}`
                              : 'wait for a window, then the lighter up'}{' '}
                        · {duration(l.duration)}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
          {selected && sel ? (
            <ObjectPanel
              list={sel.list}
              obj={selected}
              update={updateSel}
              remove={() => (
                setList(
                  sel.list,
                  list(sel.list).filter((o) => o.id !== sel.id)
                ),
                setSel(null)
              )}
            />
          ) : (
            <PlanPanel plan={plan} save={save} port={port} />
          )}
        </div>
      </div>
    </div>
  )
}

const fmtHour = (h: number): string => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`

function PlanSvg({
  plan,
  geo,
  cars,
  mode,
  sel,
  travel,
  onClick,
  onSelect,
  onFinish,
  onCancel
}: {
  plan: Plan
  geo: PlanGeometryDto | null
  cars: ReturnType<typeof vehiclesAt>
  mode: Mode
  sel: { list: ListKey; id: string } | null
  travel: TravelDto | null
  onClick(p: XY): void
  onSelect(list: ListKey, id: string): void
  onFinish(): void
  onCancel(): void
}): React.JSX.Element {
  const [x0, y0, x1, y1] = plan.extent
  const [vb, setVb] = useState({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ cx: number; cy: number; vb: typeof vb; moved: boolean } | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onFinish()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onCancel, onFinish])
  const toWorld = (e: React.MouseEvent): XY => {
    const r = svg.current!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    // y north: the SVG's y runs down, so flip.
    return [Math.round(vb.x + fx * vb.w), Math.round(vb.y + vb.h - fy * vb.h)]
  }
  const P = (p: number[]): string => `${p[0]},${-p[1]}`
  const poly = (pts: number[][]): string => pts.map(P).join(' ')
  const isSel = (list: ListKey, id: string): boolean => sel?.list === list && sel.id === id
  const maxH = geo ? Math.max(30, ...geo.boxes.map((b) => b.z1 - b.z0)) : 100
  const shade = (b: PlanGeometryDto['boxes'][number]): string => {
    const f = Math.min(1, (b.z1 - b.z0) / maxH)
    const c = b.alb.map((v) => Math.round(Math.min(255, (v * 0.7 + 0.25 * f) * 255)))
    return `rgb(${c.join(',')})`
  }
  const corners = (b: { cx: number; cy: number; hw: number; hd: number; ang: number }): string => {
    const c = Math.cos(b.ang)
    const s = Math.sin(b.ang)
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ]
      .map(([u, v]) => P([b.cx + u * b.hw * c - v * b.hd * s, b.cy + u * b.hw * s + v * b.hd * c]))
      .join(' ')
  }
  return (
    <svg
      ref={svg}
      className={`plan-svg ${mode.kind !== 'select' ? 'drawing' : ''}`}
      viewBox={`${vb.x} ${-(vb.y + vb.h)} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={(e) => {
        drag.current = { cx: e.clientX, cy: e.clientY, vb, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || mode.kind !== 'select') return
        const r = svg.current!.getBoundingClientRect()
        const dx = ((e.clientX - d.cx) / r.width) * d.vb.w
        const dy = ((e.clientY - d.cy) / r.height) * d.vb.h
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 3) d.moved = true
        if (d.moved) setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y + dy })
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (d?.moved) return
        if (mode.kind !== 'select') onClick(toWorld(e))
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        onFinish()
      }}
      onWheel={(e) => {
        const [mx, my] = toWorld(e)
        const k = Math.exp(e.deltaY * 0.0015)
        setVb({ x: mx - (mx - vb.x) * k, y: my - (my - vb.y) * k, w: vb.w * k, h: vb.h * k })
      }}
      id="planSvg"
    >
      <rect x={x0} y={-y1} width={x1 - x0} height={y1 - y0} fill={SURFACE_FILL[plan.defaults?.surface ?? 'grass']} />
      {((plan.ground ?? []) as Obj[]).map((g) => (
        <polygon
          key={g.id}
          points={poly(g.poly)}
          fill={SURFACE_FILL[g.surface ?? 'grass']}
          stroke={isSel('ground', g.id) ? '#ffcc33' : 'rgba(0,0,0,0.25)'}
          strokeWidth={isSel('ground', g.id) ? 4 : 1}
          vectorEffect="non-scaling-stroke"
          onClick={() => onSelect('ground', g.id)}
        />
      ))}
      {((plan.water ?? []) as Obj[]).map((w) => (
        <polygon
          key={w.id}
          points={poly(w.poly)}
          fill="#2d5a8a"
          stroke={isSel('water', w.id) ? '#ffcc33' : 'none'}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          onClick={() => onSelect('water', w.id)}
        />
      ))}
      {geo?.faces.map((f, k) => (
        <line
          key={`f${k}`}
          x1={f.a[0]}
          y1={-f.a[1]}
          x2={f.b[0]}
          y2={-f.b[1]}
          stroke="#2a2018"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {geo?.boxes.map((b, k) => (
        <polygon key={k} points={corners(b)} fill={b.emit ? 'rgb(255,200,120)' : shade(b)} stroke="none" />
      ))}
      {((plan.regions ?? []) as Obj[]).map((r) => (
        <polygon
          key={r.id}
          points={poly(r.poly)}
          fill="rgba(255,255,255,0.02)"
          stroke={isSel('regions', r.id) ? '#ffcc33' : 'rgba(255,255,255,0.6)'}
          strokeDasharray="6 4"
          strokeWidth={isSel('regions', r.id) ? 3 : 1.2}
          vectorEffect="non-scaling-stroke"
          onClick={() => onSelect('regions', r.id)}
        />
      ))}
      {((plan.lines ?? []) as Obj[]).map((l) => (
        <polyline
          key={l.id}
          points={l.pts.map(P).join(' ')}
          fill="none"
          stroke={isSel('lines', l.id) ? '#ffcc33' : 'transparent'}
          strokeWidth={Math.max(8, l.width ?? 12)}
          onClick={() => onSelect('lines', l.id)}
          style={{ cursor: 'pointer' }}
        >
          <title>{l.name ?? l.id}</title>
        </polyline>
      ))}
      {((plan.buildings ?? []) as Obj[]).map((b) => (
        <polygon
          key={b.id}
          points={corners({
            cx: b.center[0],
            cy: b.center[1],
            hw: b.size[0] / 2,
            hd: b.size[1] / 2,
            ang: ((b.angle ?? 0) * Math.PI) / 180
          })}
          fill="transparent"
          stroke={isSel('buildings', b.id) ? '#ffcc33' : 'rgba(255,255,255,0.8)'}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          onClick={() => onSelect('buildings', b.id)}
        />
      ))}
      {cars.map((c, k) => {
        const b = { cx: c.x, cy: c.y, hw: c.length / 2, hd: c.width / 2, ang: c.head }
        return <polygon key={`v${k}`} points={corners(b)} fill={`rgb(${c.colour.map((v) => Math.round(v * 255)).join(',')})`} />
      })}
      {((plan.points ?? []) as Obj[]).map((p) => (
        <g key={p.id} onClick={() => onSelect('points', p.id)} style={{ cursor: 'pointer' }}>
          <circle
            cx={p.pos[0]}
            cy={-p.pos[1]}
            r={vb.w / 160}
            fill={p.kind === 'field' ? '#e0a43c' : '#ffffff'}
            stroke={isSel('points', p.id) ? '#ffcc33' : '#000'}
            vectorEffect="non-scaling-stroke"
          />
          <text x={p.pos[0] + vb.w / 120} y={-p.pos[1]} fontSize={vb.w / 70} className="plan-label">
            {p.name ?? p.id}
          </text>
        </g>
      ))}
      {travel && (
        <polyline
          points={[travel.legs[0]?.from, ...travel.legs.map((l) => l.to)]
            .filter(Boolean)
            .map((p) => P(p as number[]))
            .join(' ')}
          fill="none"
          stroke="#ffcc33"
          strokeWidth={3}
          strokeDasharray="8 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {mode.kind === 'draw' && mode.points.length > 0 && (
        <polyline points={mode.points.map(P).join(' ')} fill="none" stroke="#ffcc33" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      )}
      {mode.kind === 'travel' && mode.from && <circle cx={mode.from[0]} cy={-mode.from[1]} r={vb.w / 120} fill="#ffcc33" />}
    </svg>
  )
}

function ObjectPanel({
  list,
  obj,
  update,
  remove
}: {
  list: ListKey
  obj: Obj
  update(p: Record<string, unknown>): void
  remove(): void
}): React.JSX.Element {
  const [paramText, setParamText] = useState(JSON.stringify(obj.params ?? {}, null, 1))
  const [paramErr, setParamErr] = useState<string | null>(null)
  useEffect(() => setParamText(JSON.stringify(obj.params ?? {}, null, 1)), [obj.params])
  const sv = obj.service as Record<string, unknown> | undefined
  const setSv = (patch: Record<string, unknown>): void => {
    const n = { ...(sv ?? {}), ...patch }
    for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k]
    update({ service: n })
  }
  return (
    <div className="plan-panel" id="objectPanel">
      <h3>
        {list === 'lines'
          ? obj.kind
          : list === 'regions'
            ? `${obj.preset} district`
            : list === 'buildings'
              ? 'landmark'
              : list === 'points'
                ? obj.kind
                : list}{' '}
        <span className="muted small">{obj.id}</span>
      </h3>
      <TextField label="Name" value={obj.name ?? ''} onCommit={(t) => update({ name: t.trim() || undefined })} />
      {(list === 'ground' || list === 'water') && <NumberField label="Height, m" value={obj.z} optional onCommit={(z) => update({ z })} />}
      {list === 'ground' && (
        <label className="field">
          Surface
          <select value={obj.surface ?? 'grass'} onChange={(e) => update({ surface: e.target.value })}>
            {Object.keys(SURFACE_FILL).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {list === 'lines' && (
        <>
          <div className="field-row tight">
            <NumberField label="Width, m" value={obj.width} optional onCommit={(w) => update({ width: w })} />
            <NumberField label="Deck height, m" value={obj.z} optional onCommit={(z) => update({ z })} />
          </div>
          <label className="field">
            Mount
            <select
              value={obj.mount ?? 'grade'}
              onChange={(e) => update({ mount: e.target.value === 'grade' ? undefined : e.target.value })}
            >
              <option value="grade">on the ground</option>
              <option value="elevated">elevated, on pillars</option>
              <option value="face">fixed to a cliff face</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(sv)}
              onChange={(e) =>
                update({
                  service: e.target.checked ? { headway_s: 600, speed_ms: 15, accel_ms2: 1, dwell_s: 30, stopEvery_m: 500 } : undefined
                })
              }
              id="lineService"
            />
            Runs a service
          </label>
          {sv && (
            <div className="field-row tight">
              <NumberField label="Every, s" value={sv.headway_s as number} optional onCommit={(x) => setSv({ headway_s: x })} />
              <NumberField label="Speed, m/s" value={sv.speed_ms as number} optional onCommit={(x) => setSv({ speed_ms: x })} />
              <NumberField label="Accel, m/s²" value={sv.accel_ms2 as number} optional onCommit={(x) => setSv({ accel_ms2: x })} />
              <NumberField label="Dwell, s" value={sv.dwell_s as number} optional onCommit={(x) => setSv({ dwell_s: x })} />
              <NumberField label="Stop every, m" value={sv.stopEvery_m as number} optional onCommit={(x) => setSv({ stopEvery_m: x })} />
              <NumberField
                label="Cars"
                value={sv.cars as number}
                optional
                onCommit={(x) => setSv({ cars: x === undefined ? undefined : Math.max(1, Math.round(x)) })}
              />
              <NumberField
                label="Runs from, h"
                value={(sv.hours as number[] | undefined)?.[0]}
                optional
                onCommit={(x) => setSv({ hours: x === undefined ? undefined : [x, (sv.hours as number[] | undefined)?.[1] ?? 24] })}
              />
              <NumberField
                label="Until, h"
                value={(sv.hours as number[] | undefined)?.[1]}
                optional
                onCommit={(x) => setSv({ hours: x === undefined ? undefined : [(sv.hours as number[] | undefined)?.[0] ?? 0, x] })}
              />
            </div>
          )}
        </>
      )}
      {list === 'regions' && (
        <>
          <label className="field">
            Preset
            <select value={obj.preset} onChange={(e) => update({ preset: e.target.value, params: PRESET_DEFAULTS[e.target.value] })}>
              {PRESETS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Settings (JSON; see the docs for each preset)
            <textarea
              className="code"
              rows={8}
              value={paramText}
              onChange={(e) => setParamText(e.target.value)}
              onBlur={() => {
                try {
                  update({ params: JSON.parse(paramText) })
                  setParamErr(null)
                } catch (err) {
                  setParamErr((err as Error).message)
                }
              }}
            />
          </label>
          {paramErr && <p className="error small">{paramErr}</p>}
        </>
      )}
      {list === 'buildings' && (
        <div className="field-row tight">
          <NumberField label="Width, m" value={obj.size[0]} onCommit={(x) => x && update({ size: [x, obj.size[1]] })} />
          <NumberField label="Depth, m" value={obj.size[1]} onCommit={(x) => x && update({ size: [obj.size[0], x] })} />
          <NumberField label="Height, m" value={obj.h} optional onCommit={(x) => update({ h: x })} />
          <NumberField label="Angle, °" value={obj.angle} optional onCommit={(x) => update({ angle: x })} />
        </div>
      )}
      <div className="inspector-actions">
        <button className="danger" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  )
}

function PlanPanel({ plan, save, port }: { plan: Plan; save(p: Plan): void; port: PortCapacityDto | null }): React.JSX.Element {
  const set = (patch: Record<string, unknown>): void => save({ ...plan, ...patch })
  const p = plan.port as Record<string, number> | undefined
  const setPort = (k: string, x: number | undefined): void => {
    if (x !== undefined) set({ port: { ...p, [k]: x } })
  }
  return (
    <div className="plan-panel" id="planPanel">
      <h3>The plan</h3>
      <div className="field-row tight">
        <NumberField
          label="Ground outside, m"
          value={plan.defaults?.groundZ}
          onCommit={(z) => z !== undefined && set({ defaults: { ...plan.defaults, groundZ: z } })}
        />
        <NumberField
          label="Walking, m/s"
          value={plan.walking?.speed_ms}
          onCommit={(x) => x && set({ walking: { ...plan.walking, speed_ms: x } })}
        />
        <NumberField
          label="Walking detour"
          value={plan.walking?.detour}
          onCommit={(x) => x && set({ walking: { ...plan.walking, detour: Math.max(1, x) } })}
        />
      </div>
      <h4>To orbit</h4>
      {plan.orbit ? (
        <div className="field-row tight">
          <label className="field">
            Lighter field
            <select value={plan.orbit.field} onChange={(e) => set({ orbit: { ...plan.orbit, field: e.target.value } })}>
              {((plan.points ?? []) as Obj[]).map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.name ?? pt.id}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Flight, min"
            value={plan.orbit.flight_min}
            onCommit={(x) => x && set({ orbit: { ...plan.orbit, flight_min: x } })}
          />
          <NumberField
            label="Between windows, min"
            value={plan.orbit.windowGap_min}
            onCommit={(x) => x !== undefined && set({ orbit: { ...plan.orbit, windowGap_min: x } })}
          />
        </div>
      ) : (
        <button
          disabled={!((plan.points ?? []) as Obj[]).length}
          onClick={() =>
            set({
              orbit: {
                field: ((plan.points ?? []) as Obj[]).find((x) => x.kind === 'field')?.id ?? (plan.points as Obj[])[0].id,
                flight_min: 40,
                windowGap_min: 90
              }
            })
          }
        >
          Lighters fly from a point here
        </button>
      )}
      <h4>The port</h4>
      {p ? (
        <>
          <div className="field-row tight">
            <NumberField label="Approach spacing, min" value={p.spacing_min} onCommit={(x) => setPort('spacing_min', x)} />
            <NumberField label="Berths in the stack" value={p.berths} onCommit={(x) => setPort('berths', x)} />
            <NumberField label="Days in the stack" value={p.daysInStack} onCommit={(x) => setPort('daysInStack', x)} />
            <NumberField label="Lighters" value={p.lighters} onCommit={(x) => setPort('lighters', x)} />
            <NumberField label="Flights per lighter a day" value={p.flightsPerLighter} onCommit={(x) => setPort('flightsPerLighter', x)} />
            <NumberField
              label="Containers per freighter"
              value={p.containersPerFreighter}
              onCommit={(x) => setPort('containersPerFreighter', x)}
            />
            <NumberField label="Containers per lighter" value={p.lighterCapacity} onCommit={(x) => setPort('lighterCapacity', x)} />
            <NumberField label="Field movements a day" value={p.fieldMovements} onCommit={(x) => setPort('fieldMovements', x)} />
          </div>
          {port && (
            <dl className="facts compact" id="portFacts">
              <dt>Approach corridor</dt>
              <dd>{sig(port.limits.corridor, 3)} a day</dd>
              <dt>Room in the stack</dt>
              <dd>{sig(port.limits.stack, 3)} a day</dd>
              <dt>Lighter fleet</dt>
              <dd>{sig(port.limits.fleet, 3)} a day</dd>
              <dt>Lighter field</dt>
              <dd>{sig(port.limits.field, 3)} a day</dd>
              <dt>Capacity</dt>
              <dd>
                <strong>{sig(port.capacity, 3)} freighters a day</strong> ({port.binding} binds; {port.tripsPerFreighter} lighter trips
                each)
              </dd>
              <dt>The routes bring</dt>
              <dd className={port.demand !== null && port.demand > port.capacity ? 'warning' : ''}>
                {port.demand === null
                  ? 'not counted: the city is not its system’s main port'
                  : `${sig(port.demand, 3)} a day (${sig((port.demand / port.capacity) * 100, 3)}% of capacity)`}
              </dd>
            </dl>
          )}
        </>
      ) : (
        <button
          onClick={() =>
            set({
              port: {
                spacing_min: 20,
                berths: 40,
                daysInStack: 2,
                lighters: 30,
                flightsPerLighter: 4,
                containersPerFreighter: 3000,
                lighterCapacity: 200,
                fieldMovements: 400
              }
            })
          }
          id="addPort"
        >
          Model the port’s capacity
        </button>
      )}
    </div>
  )
}

export const cityPlanTool: ToolDefinition = {
  id: 'cityplan',
  title: 'City planner',
  description: 'Lay out a city: ground, cliffs, water, roads and rail with their services, generated districts; travel times; the port',
  View: CityPlanView
}
