import { useEffect, useMemo, useRef, useState } from 'react'
import { ITINERARY_BY, positionAt, type Encounter, type ItineraryReport } from '@malevo/model'
import type { WorldSnapshot } from '../../../../shared/types'
import { DateInput } from '../../components/DateInput'
import { useFormatted, useFormattedOne, useWorldPref, slugId } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

type Spot = { point?: string; pos?: number[]; ship?: string; orbit?: string; label?: string; page?: string }
type Instant = { t_s: number; cal?: string; text?: string }
type Stop = {
  place: Spot
  by?: (typeof ITINERARY_BY)[number]
  landing?: string
  minutes?: number
  arrive?: Instant
  depart?: Instant
  stay_min?: number
  note?: string
}
type Itinerary = { name: string; color?: string; city: string; page?: string; stops: Stop[]; note?: string }
type PlanPoint = { id: string; name?: string; pos: number[] }
type Plan = {
  extent: number[]
  points?: PlanPoint[]
  lines?: { id: string; kind: string; pts: number[][]; name?: string }[]
  water?: { id: string; poly: number[][] }[]
}

const BY_LABEL: Record<string, string> = {
  auto: 'Best way',
  walk: 'Walk',
  city: 'Walk and ride the lines',
  lighter: 'Lighter from orbit',
  landing: 'Landing (from Landings)',
  fixed: 'Fixed time'
}
const MODE_COLOUR: Record<string, string> = {
  walk: '#7dd3a3',
  ride: '#6aa8ff',
  wait: '#59606e',
  lighter: '#c58bff',
  descent: '#ff9f5a',
  fixed: '#e0c35a'
}
const COLOURS = ['#e8a33d', '#4fb3d9', '#d9604f', '#8bc34a', '#b07fe0', '#e07fb0', '#4fd9b0']

const hhmm = (h: number | null): string => {
  if (h === null) return ''
  const m = Math.round(h * 60) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const mins = (s: number): string => {
  const m = Math.round(Math.abs(s) / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

function ItinerariesView({ world, snapshot, now, setNow, displayCal, focus }: ToolProps): React.JSX.Element {
  const list = snapshot.itineraries
  const [sel, setSel] = useWorldPref<string | null>(world.root, 'itinerary', null)
  useEffect(() => {
    if (focus) setSel(focus)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = list.find((x) => x.id === sel) ?? list[0] ?? null
  const [data, setData] = useState<{ reports: ItineraryReport[]; encounters: Encounter[] } | null>(null)
  useEffect(() => {
    let live = true
    void window.malevo.itineraries.overview().then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [snapshot.version])

  // Playing: the current date runs on at a chosen rate.
  const [rate, setRate] = useState(0)
  const nowRef = useRef(now)
  nowRef.current = now
  useEffect(() => {
    if (!rate) return
    let last = performance.now()
    let frame = 0
    const tick = (ts: number): void => {
      const dt = (ts - last) / 1000
      last = ts
      setNow(nowRef.current + dt * rate)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [rate, setNow])

  const make = async (): Promise<void> => {
    const city = snapshot.cityPlans[0]?.id ?? snapshot.cities[0]?.id
    if (!city) return
    const name = 'New itinerary'
    const id = slugId(
      name,
      list.map((x) => x.id)
    )
    const plan = snapshot.cityPlans.find((p) => p.id === city)?.value as Plan | undefined
    const first = plan?.points?.[0]
    const value: Itinerary = {
      name,
      color: COLOURS[list.length % COLOURS.length],
      city,
      stops: [{ place: first ? { point: first.id } : { pos: [0, 0] }, depart: { t_s: Math.round(now), cal: displayCal ?? undefined } }]
    }
    await window.malevo.world.setEntity('itinerary', id, value)
    setSel(id)
  }

  if (!snapshot.cities.length)
    return (
      <div className="tool-page">
        <h1>Itineraries</h1>
        <p>An itinerary follows someone through a city by the minute. Make a city first (Population), and draw its plan (City planner).</p>
      </div>
    )

  const reports = data?.reports ?? []
  const report = reports.find((r) => r.id === current?.id) ?? null
  return (
    <div className="itineraries">
      <div className="toolbar itin-bar">
        {list.map((x) => (
          <button
            key={x.id}
            className={x.id === current?.id ? 'on' : ''}
            onClick={() => setSel(x.id)}
            data-ref={`itinerary:${x.id}`}
            data-itinerary={x.id}
          >
            <span className="swatch" style={{ background: String(x.value?.color ?? '#e8a33d') }} /> {String(x.value?.name ?? x.id)}
          </button>
        ))}
        <button onClick={() => void make()} id="newItinerary">
          New itinerary
        </button>
        <span className="spacer" />
        <span className="muted small">Play</span>
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))} id="itinPlay" aria-label="Play at">
          <option value={0}>stopped</option>
          <option value={60}>1 min/s</option>
          <option value={600}>10 min/s</option>
          <option value={3600}>1 h/s</option>
        </select>
      </div>
      <Lanes
        reports={reports}
        encounters={data?.encounters ?? []}
        now={now}
        setNow={setNow}
        selected={current?.id ?? null}
        onSelect={setSel}
      />
      <div className="itin-split">
        <div className="itin-editor">
          {current && current.value ? (
            <Editor
              key={current.id}
              id={current.id}
              value={current.value as unknown as Itinerary}
              report={report}
              snapshot={snapshot}
              displayCal={displayCal}
              setNow={setNow}
            />
          ) : (
            <p className="muted">No itinerary yet: “New itinerary” starts one at the current date.</p>
          )}
        </div>
        <CityMap
          snapshot={snapshot}
          cityId={(current?.value as unknown as Itinerary | null)?.city ?? null}
          reports={reports}
          now={now}
          displayCal={displayCal}
        />
      </div>
    </div>
  )
}

// ---- everyone's day, lane by lane ----

function Lanes({
  reports,
  encounters,
  now,
  setNow,
  selected,
  onSelect
}: {
  reports: ItineraryReport[]
  encounters: Encounter[]
  now: number
  setNow(t: number): void
  selected: string | null
  onSelect(id: string): void
}): React.JSX.Element | null {
  const spans = reports.filter((r) => r.start !== null && r.end !== null)
  if (!spans.length) return null
  const lo = Math.min(...spans.map((r) => r.start!))
  const hi = Math.max(...spans.map((r) => r.end!), lo + 3600)
  const W = 1000
  const lane = 26
  const x = (t: number): number => ((t - lo) / (hi - lo)) * W
  const H = spans.length * lane + 18
  const hours: number[] = []
  for (let t = Math.ceil(lo / 3600) * 3600; t <= hi; t += 3600 * Math.max(1, Math.round((hi - lo) / 3600 / 24))) hours.push(t)
  return (
    <svg
      className="itin-lanes"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        setNow(lo + ((e.clientX - r.left) / r.width) * (hi - lo))
      }}
      id="itinLanes"
    >
      {hours.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H - 14} className="lane-hour" />
      ))}
      {spans.map((r, k) => (
        <g
          key={r.id}
          transform={`translate(0 ${k * lane + 4})`}
          className={r.id === selected ? 'lane on' : 'lane'}
          onClick={() => onSelect(r.id)}
        >
          {r.parts.map((p, n) => (
            <rect
              key={n}
              x={x(p.t0)}
              width={Math.max(0.5, x(p.t1) - x(p.t0))}
              y={p.mode === 'wait' && p.from ? 2 : 7}
              height={p.mode === 'wait' && p.from ? 16 : 6}
              fill={p.mode === 'wait' && p.from ? r.color : MODE_COLOUR[p.mode]}
              opacity={p.mode === 'wait' && p.from ? 0.8 : 1}
            >
              <title>
                {p.mode === 'wait' && p.from
                  ? `${r.name}: ${r.stops.find((s) => s.arrive !== null && s.arrive <= p.t0 && (s.depart ?? Infinity) >= p.t1)?.label ?? 'waiting'}`
                  : `${r.name}: ${p.mode}${p.line ? ` (${p.line})` : ''}, ${mins(p.t1 - p.t0)}`}
              </title>
            </rect>
          ))}
          {r.stops
            .filter((s) => s.problems.length)
            .map((s) => (
              <circle key={s.index} cx={x(s.arrive ?? s.depart ?? lo)} cy={10} r={4} className="lane-problem">
                <title>{s.problems.join(' ')}</title>
              </circle>
            ))}
          <text x={4} y={14} className="lane-name">
            {r.name}
          </text>
        </g>
      ))}
      {encounters.map((e, k) => (
        <rect key={k} x={x(e.t0)} width={Math.max(2, x(e.t1) - x(e.t0))} y={0} height={H - 14} className="lane-meet">
          <title>
            {reports.find((r) => r.id === e.a)?.name} and {reports.find((r) => r.id === e.b)?.name} together
            {e.label ? ` at ${e.label}` : ''}, {mins(e.t1 - e.t0)}
          </title>
        </rect>
      ))}
      {now >= lo && now <= hi && <line x1={x(now)} x2={x(now)} y1={0} y2={H - 14} className="lane-now" />}
    </svg>
  )
}

// ---- one itinerary's stops ----

function Editor({
  id,
  value,
  report,
  snapshot,
  displayCal,
  setNow
}: {
  id: string
  value: Itinerary
  report: ItineraryReport | null
  snapshot: WorldSnapshot
  displayCal: string | null
  setNow(t: number): void
}): React.JSX.Element {
  const save = (next: Itinerary): void => void window.malevo.world.setEntity('itinerary', id, next)
  const setStop = (k: number, patch: Partial<Stop>): void => {
    const stops = value.stops.map((s, j) => {
      if (j !== k) return s
      const n: Stop = { ...s, ...patch }
      for (const key of Object.keys(n) as (keyof Stop)[]) if (n[key] === undefined) delete n[key]
      return n
    })
    save({ ...value, stops })
  }
  const plan = snapshot.cityPlans.find((p) => p.id === value.city)?.value as Plan | undefined
  const cal = displayCal ?? 'gregorian'
  const times = useMemo(
    () => (report?.stops ?? []).flatMap((s) => [{ t: s.arrive ?? 0 }, { t: s.depart ?? 0 }]).map((x) => ({ ...x, precision: 'minute' })),
    [report]
  )
  const shown = useFormatted(displayCal, times, snapshot.version)
  const systemOfCity = (() => {
    const body = String(snapshot.cities.find((c) => c.id === value.city)?.value.body ?? '')
    return snapshot.systems.find((s) => s.bodies.some((b) => b.id === body)) ?? null
  })()
  const placeKey = (p: Spot): string => (p.point ? `point:${p.point}` : p.orbit ? `orbit:${p.orbit}` : p.ship ? `ship:${p.ship}` : 'pos')
  const fromKey = (k: string): Spot => {
    const [kind, ref] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
    return kind === 'point' ? { point: ref } : kind === 'orbit' ? { orbit: ref } : { ship: ref }
  }
  const placeOptions = (
    <>
      {(plan?.points ?? []).map((p) => (
        <option key={p.id} value={`point:${p.id}`}>
          {p.name ?? p.id}
        </option>
      ))}
      {(systemOfCity?.bodies ?? [])
        .filter((b) => !b.parent)
        .map((b) => (
          <option key={b.id} value={`orbit:${b.id}`}>
            In orbit of {b.name}
          </option>
        ))}
      {snapshot.ships.map((s) => (
        <option key={s.id} value={`ship:${s.id}`}>
          Aboard {String(s.value?.name ?? s.id)}
        </option>
      ))}
    </>
  )
  const pin = (k: number, key: 'arrive' | 'depart', label: string, at: Instant | undefined, fallback: number | null): React.JSX.Element => (
    <span className="itin-pin">
      <span className="muted small">{label}</span>
      {at ? (
        <>
          <PinInput
            calendars={snapshot.calendars}
            cal={at.cal ?? cal}
            at={at}
            version={snapshot.version}
            onCommit={(d) => setStop(k, { [key]: d })}
          />
          <button className="link small" onClick={() => setStop(k, { [key]: undefined })} title="Unpin">
            ×
          </button>
        </>
      ) : (
        <button className="link small" onClick={() => setStop(k, { [key]: { t_s: Math.round(fallback ?? 0), cal } })}>
          pin
        </button>
      )}
    </span>
  )
  const move = (k: number, d: number): void => {
    const stops = [...value.stops]
    const [s] = stops.splice(k, 1)
    stops.splice(k + d, 0, s)
    save({ ...value, stops })
  }
  return (
    <div className="itin-stops" id="itinEditor">
      <div className="field-row">
        <label className="field">
          Name
          <input
            defaultValue={value.name}
            onBlur={(e) => e.target.value.trim() && e.target.value !== value.name && save({ ...value, name: e.target.value.trim() })}
            id="itinName"
          />
        </label>
        <label className="field">
          Colour
          <input type="color" value={value.color ?? '#e8a33d'} onChange={(e) => save({ ...value, color: e.target.value })} />
        </label>
        <label className="field">
          City
          <select value={value.city} onChange={(e) => save({ ...value, city: e.target.value })}>
            {snapshot.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {String(c.value.name ?? c.id)}
                {snapshot.cityPlans.some((p) => p.id === c.id) ? '' : ' (no plan)'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {report?.problems.map((p) => (
        <p key={p} className="warning">
          {p}
        </p>
      ))}
      <ol className="itin-list">
        {value.stops.map((s, k) => {
          const r = report?.stops[k]
          return (
            <li key={k} className={r?.problems.length ? 'has-problem' : undefined} data-stop={k}>
              {k > 0 && (
                <div className="itin-leg small">
                  <select
                    value={s.by ?? 'auto'}
                    onChange={(e) => setStop(k, { by: e.target.value === 'auto' ? undefined : (e.target.value as Stop['by']) })}
                    aria-label="How"
                    id={`itinBy-${k}`}
                  >
                    {ITINERARY_BY.map((b) => (
                      <option key={b} value={b}>
                        {BY_LABEL[b]}
                      </option>
                    ))}
                  </select>
                  {s.by === 'fixed' && (
                    <label>
                      <input
                        type="number"
                        min={0}
                        defaultValue={s.minutes ?? ''}
                        onBlur={(e) => setStop(k, { minutes: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                        className="tiny"
                        id={`itinMinutes-${k}`}
                      />{' '}
                      min
                    </label>
                  )}
                  {s.by === 'landing' && (
                    <select value={s.landing ?? ''} onChange={(e) => setStop(k, { landing: e.target.value || undefined })}>
                      <option value="">Which landing?</option>
                      {snapshot.landings.map((l) => (
                        <option key={l.id} value={l.id}>
                          {String(l.value?.name ?? l.id)}
                        </option>
                      ))}
                    </select>
                  )}
                  {r?.leg && (
                    <span className="muted">
                      {mins(r.leg.duration)}: {r.leg.summary}
                    </span>
                  )}
                </div>
              )}
              <div className="itin-stop">
                <span className="itin-num">{k + 1}</span>
                <select
                  value={placeKey(s.place)}
                  onChange={(e) => setStop(k, { place: { ...fromKey(e.target.value), label: s.place.label, page: s.place.page } })}
                  aria-label="Where"
                  id={`itinPlace-${k}`}
                >
                  {placeKey(s.place) === 'pos' && <option value="pos">A spot on the plan</option>}
                  {placeOptions}
                </select>
                <input
                  className="itin-label"
                  placeholder="Call it…"
                  defaultValue={s.place.label ?? ''}
                  onBlur={(e) => setStop(k, { place: { ...s.place, label: e.target.value.trim() || undefined } })}
                />
                <span className="spacer" />
                <button className="link small" disabled={k === 0} onClick={() => move(k, -1)} title="Earlier">
                  ↑
                </button>
                <button className="link small" disabled={k === value.stops.length - 1} onClick={() => move(k, 1)} title="Later">
                  ↓
                </button>
                <button
                  className="link small"
                  onClick={() =>
                    save({
                      ...value,
                      stops: [...value.stops.slice(0, k + 1), { place: s.place, stay_min: 0 }, ...value.stops.slice(k + 1)]
                    })
                  }
                  title="Add a stop after this one"
                  id={`itinAdd-${k}`}
                >
                  + stop
                </button>
                {value.stops.length > 1 && (
                  <button
                    className="link small"
                    onClick={() => save({ ...value, stops: value.stops.filter((_, j) => j !== k) })}
                    title="Remove"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="itin-times small">
                {r?.arrive !== null && r?.arrive !== undefined && (
                  <button className="link" onClick={() => setNow(r.arrive!)} title="Go to this time">
                    there {shown[k * 2] ?? ''} <span className="muted">({hhmm(r.arriveLocal)} local)</span>
                  </button>
                )}
                {r?.depart !== null && r?.depart !== undefined && k < value.stops.length - 1 && (
                  <button className="link" onClick={() => setNow(r.depart!)}>
                    leaves {hhmm(r.departLocal)} local
                  </button>
                )}
                {r?.slack !== null && r?.slack !== undefined && (
                  <span className={r.slack < 0 ? 'error' : 'ok'} data-slack={Math.round(r.slack)}>
                    {r.slack < 0 ? `${mins(r.slack)} late` : `${mins(r.slack)} to spare`}
                  </span>
                )}
              </div>
              <div className="itin-times small">
                {k > 0 && pin(k, 'arrive', 'be there by', s.arrive, r?.arrive ?? null)}
                {pin(k, 'depart', 'leave at', s.depart, r?.depart ?? null)}
                <label>
                  <span className="muted">stay at least</span>{' '}
                  <input
                    type="number"
                    min={0}
                    className="tiny"
                    defaultValue={s.stay_min ?? ''}
                    onBlur={(e) => setStop(k, { stay_min: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    id={`itinStay-${k}`}
                  />{' '}
                  min
                </label>
              </div>
              {r?.problems.map((p) => (
                <p key={p} className="error small">
                  {p}
                </p>
              ))}
            </li>
          )
        })}
      </ol>
      <p className="muted small">
        Places are the named points of the city’s plan (add them in the City planner), or in orbit, or aboard a ship. On foot she walks a
        straight line, made longer by the plan’s detour factor; the city’s lines run to their timetables.
      </p>
    </div>
  )
}

/** A pinned time, shown in its calendar's own words (typed text kept as typed). */
function PinInput({
  calendars,
  cal,
  at,
  version,
  onCommit
}: {
  calendars: WorldSnapshot['calendars']
  cal: string
  at: Instant
  version: number
  onCommit(i: Instant): void
}): React.JSX.Element {
  const formatted = useFormattedOne(cal, at.text ? null : at.t_s, 'minute', version)
  return (
    <DateInput
      calendars={calendars}
      cal={cal}
      text={at.text ?? formatted ?? ''}
      onCommit={(d) => onCommit({ t_s: d.t, cal: d.cal, text: d.text })}
    />
  )
}

// ---- where everyone is now ----

function CityMap({
  snapshot,
  cityId,
  reports,
  now,
  displayCal
}: {
  snapshot: WorldSnapshot
  cityId: string | null
  reports: ItineraryReport[]
  now: number
  displayCal: string | null
}): React.JSX.Element {
  const plan = snapshot.cityPlans.find((p) => p.id === cityId)?.value as Plan | undefined
  const label = useFormattedOne(displayCal, now, 'minute', snapshot.version)
  if (!plan) return <div className="itin-map muted">This city has no plan to draw.</div>
  const [x0, y0, x1, y1] = plan.extent
  const w = x1 - x0
  const h = y1 - y0
  const px = Math.max(w, h) / 600
  const people = reports.map((r) => ({ r, at: positionAt(r, now) }))
  const off = people.filter((p) => !p.at.pos && r0(p.r, now))
  return (
    <div className="itin-map">
      <svg viewBox={`${x0} ${-y1} ${w} ${h}`} id="itinMap">
        {(plan.water ?? []).map((wa) => (
          <polygon key={wa.id} points={wa.poly.map((p) => `${p[0]},${-p[1]}`).join(' ')} className="map-water" />
        ))}
        {(plan.lines ?? []).map((l) => (
          <polyline
            key={l.id}
            points={l.pts.map((p) => `${p[0]},${-p[1]}`).join(' ')}
            className={`map-line ${l.kind}`}
            strokeWidth={l.kind === 'lightrail' || l.kind === 'funicular' || l.kind === 'heavyrail' ? 3 * px : 1.5 * px}
          />
        ))}
        {(plan.points ?? []).map((p) => (
          <g key={p.id} transform={`translate(${p.pos[0]} ${-p.pos[1]})`} className="map-point">
            <circle r={3 * px} />
            <text x={5 * px} y={4 * px} fontSize={11 * px}>
              {p.name ?? p.id}
            </text>
          </g>
        ))}
        {people
          .filter((p) => p.at.pos)
          .map(({ r, at }, n) => (
            <g key={r.id} transform={`translate(${at.pos![0]} ${-at.pos![1]})`} className="map-person" data-person={r.id}>
              <circle r={7 * px} fill={r.color} />
              <text x={9 * px} y={(-6 - 14 * n) * px} fontSize={12 * px} fill={r.color}>
                {r.name}
                {at.mode && at.mode !== 'wait' ? ` (${at.mode})` : ''}
              </text>
            </g>
          ))}
      </svg>
      <p className="small muted">
        {label}
        {off.map(
          ({ r, at }) => ` · ${r.name}: ${at.mode === 'lighter' ? 'on the lighter' : at.mode === 'descent' ? 'coming down' : 'off the map'}`
        )}
      </p>
    </div>
  )
}

function r0(r: ItineraryReport, t: number): boolean {
  return r.start !== null && r.end !== null && t >= r.start && t <= r.end
}

export const itinerariesTool: ToolDefinition = {
  id: 'itineraries',
  title: 'Itineraries',
  description: 'Someone’s day by the minute: down from orbit, through the port, across the city, against a timetable',
  View: ItinerariesView
}
