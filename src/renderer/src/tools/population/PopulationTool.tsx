import { useEffect, useMemo, useRef, useState } from 'react'
import { DEG } from '@malevo/core'
import { populationAt } from '@malevo/model'
import type { SkyCamera } from '@malevo/viz'
import type { CityInfoDto, ConditionsDto, TerrainRasterDto, WhenValue, WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useFormatted, useFormattedOne, useWorldPref } from '../../state'
import { FileName } from '../../components/FileName'
import type { ToolDefinition, ToolProps } from '../registry'
import { SkyCanvas, twilight, useSky } from '../sky/SkyTool'
import { WhenEditor } from '../timeline/WhenEditor'

interface CityValue {
  name: string
  body: string
  lat_deg: number
  lon_deg: number
  elevation_m?: number
  founded?: WhenValue
  population?: { from: WhenValue; people: number }[]
  port?: 'main' | 'minor'
  polity?: string
  region?: string
  calendar?: string
  note?: string
  tags?: string[]
}

const MAP_W = 512
const MAP_H = 256
const people = (n: number): string =>
  n >= 1e9 ? `${sig(n / 1e9, 3)} billion` : n >= 1e6 ? `${sig(n / 1e6, 3)} million` : Math.round(n).toLocaleString('en-US')

function PopulationView({ world, snapshot, now, setNow, displayCal, focus }: ToolProps): React.JSX.Element {
  const bodies = snapshot.systems.flatMap((s) => s.bodies.filter((b) => b.cls !== 'belt').map((b) => ({ ...b, system: s })))
  const [pref, setPref] = useWorldPref<string | null>(world.root, 'city', null)
  const city = snapshot.cities.find((c) => c.id === (focus ?? pref)) ?? snapshot.cities[0] ?? null
  const bodyName = (id: string): string => bodies.find((b) => b.id === id)?.name ?? id

  const add = async (): Promise<void> => {
    const body = city
      ? String(city.value.body)
      : (bodies.find((b) => b.id === 'earth') ?? bodies.find((b) => ['rocky', 'ocean'].includes(b.cls)) ?? bodies[0])?.id
    if (!body) return
    const id = slugId(
      'new city',
      snapshot.cities.map((c) => c.id)
    )
    await window.malevo.world.setEntity('city', id, {
      name: 'New city',
      body,
      lat_deg: 0,
      lon_deg: 0,
      population: [{ from: { at: { t_s: now, cal: displayCal ?? undefined } }, people: 1000 }]
    })
    setPref(id)
  }

  const byBody = new Map<string, CityInfoDto[]>()
  for (const c of snapshot.cities) byBody.set(String(c.value.body), [...(byBody.get(String(c.value.body)) ?? []), c])

  return (
    <div className="split-tool">
      <nav className="split-list">
        <h2>Population</h2>
        {[...byBody.entries()].map(([body, list]) => {
          const total = list.reduce((s, c) => s + populationAt(c.population, now), 0)
          return (
            <div key={body}>
              <h3>
                {bodyName(body)} <span className="muted small">{people(total)}</span>
              </h3>
              <ul>
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      className={c.id === city?.id ? 'list-item is-current' : 'list-item'}
                      onClick={() => setPref(c.id)}
                      data-city={c.id}
                    >
                      <span>
                        {String(c.value.name)}
                        {c.value.port === 'main' ? ' ⚓' : ''}
                      </span>
                      <span className="muted small">{people(populationAt(c.population, now))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {snapshot.cities.length === 0 && <p className="muted small">No cities yet.</p>}
        <button className="primary" onClick={() => void add()} id="addCity" disabled={!bodies.length}>
          New city
        </button>
      </nav>
      <div className="split-detail">
        {city ? (
          <CityDetail
            key={city.id}
            city={city}
            snapshot={snapshot}
            now={now}
            setNow={setNow}
            displayCal={displayCal}
            rootKey={world.root}
            onRenamed={setPref}
          />
        ) : (
          <p className="tool-page muted">Make a city to start: a place on a body, with its people over time.</p>
        )}
      </div>
    </div>
  )
}

function CityDetail({
  city,
  snapshot,
  now,
  setNow,
  displayCal,
  rootKey,
  onRenamed
}: {
  onRenamed(id: string): void
  city: CityInfoDto
  snapshot: WorldSnapshot
  now: number
  setNow(t: number): void
  displayCal: string | null
  rootKey: string
}): React.JSX.Element {
  const v = city.value as unknown as CityValue
  const save = (patch: Partial<CityValue>): void => {
    const next = { ...v, ...patch } as Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    void window.malevo.world.setEntity('city', city.id, next)
  }
  const bodies = snapshot.systems.flatMap((s) => s.bodies.filter((b) => b.cls !== 'belt').map((b) => ({ ...b, systemName: s.name })))
  const [cond, setCond] = useState<ConditionsDto | null>(null)
  const [condError, setCondError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.malevo.cities.conditions(city.id, now).then((c) => {
      if (!live) return
      if ('error' in c) {
        setCondError(c.error)
        setCond(null)
      } else {
        setCondError(null)
        setCond(c)
      }
    })
    return () => {
      live = false
    }
  }, [city.id, now, snapshot.version])

  const cal = v.calendar ?? displayCal
  const localDate = useFormattedOne(cal, now, 'minute', snapshot.version)
  const pop = v.population ?? []
  const setPop = (next: { from: WhenValue; people: number }[]): void => save({ population: next.length ? next : undefined })
  const polityName = (id: string | null): string => (id ? String(snapshot.polities.find((p) => p.id === id)?.value?.name ?? id) : 'nobody')
  const routeName = (id: string): string => snapshot.routes.find((r) => r.id === id)?.name ?? id
  const nodeName = (id: string): string => snapshot.nodes[id]?.name ?? id
  const hhmm = (h: number | null): string => {
    if (h === null) return '—'
    const m = Math.round(h * 60)
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  return (
    <div className="tool-page wide city" data-city-detail={city.id}>
      <FileName kind="city" folder="cities" id={city.id} name={v.name} taken={snapshot.cities.map((c) => c.id)} onRenamed={onRenamed} />
      <div className="field-row">
        <TextField label="City name" value={v.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} id="cityName" />
        <label className="field">
          On
          <select value={v.body} onChange={(e) => save({ body: e.target.value })} id="cityBody">
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.systemName})
              </option>
            ))}
          </select>
        </label>
        <div className="inspector-actions">
          <button
            className="danger"
            onClick={() =>
              window.confirm(`Delete ${v.name}? (Unsaved; you can undo.)`) && void window.malevo.world.deleteEntity('city', city.id)
            }
          >
            Delete…
          </button>
        </div>
      </div>
      <div className="field-row">
        <NumberField
          label="Latitude, °"
          value={v.lat_deg}
          onCommit={(x) => x !== undefined && save({ lat_deg: Math.max(-90, Math.min(90, x)) })}
          id="cityLat"
        />
        <NumberField label="Longitude, ° E" value={v.lon_deg} onCommit={(x) => x !== undefined && save({ lon_deg: x })} id="cityLon" />
        <NumberField label="Elevation, m" value={v.elevation_m} optional onCommit={(x) => save({ elevation_m: x })} />
        <label className="field">
          Port
          <select value={v.port ?? ''} onChange={(e) => save({ port: (e.target.value || undefined) as CityValue['port'] })} id="cityPort">
            <option value="">None</option>
            <option value="main">The system’s main port</option>
            <option value="minor">A minor port</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Held by
          <select value={v.polity ?? ''} onChange={(e) => save({ polity: e.target.value || undefined })}>
            <option value="">Whoever holds its system</option>
            {snapshot.polities.map((p) => (
              <option key={p.id} value={p.id}>
                {String(p.value?.name ?? p.id)}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Region" value={v.region ?? ''} onCommit={(t) => save({ region: t.trim() || undefined })} />
        <label className="field">
          Its calendar
          <select value={v.calendar ?? ''} onChange={(e) => save({ calendar: e.target.value || undefined })}>
            <option value="">The display calendar</option>
            {snapshot.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="city-layout">
        <div>
          <h3>Where</h3>
          <PlaceMap body={v.body} snapshot={snapshot} city={city} onPlace={(lat, lon) => save({ lat_deg: lat, lon_deg: lon })} />

          <h3>People</h3>
          <PopulationChart city={city} now={now} setNow={setNow} displayCal={displayCal} version={snapshot.version} />
          {pop.map((p, k) => {
            const resolved = city.population.find((x) => x.index === k)
            return (
              <div className="population-row" key={k} data-population={k}>
                <WhenEditor
                  label="From"
                  when={p.from}
                  onChange={(from) => setPop(pop.map((x, j) => (j === k ? { ...x, from } : x)))}
                  calendars={snapshot.calendars}
                  anchors={snapshot.events}
                  resolved={resolved ? { t: resolved.t, cal: null, precision: null, circa: false, range: [resolved.t, resolved.t] } : null}
                  displayCal={displayCal ?? 'gregorian'}
                  now={now}
                  version={snapshot.version}
                />
                <NumberField
                  label="People"
                  value={p.people}
                  onCommit={(x) => x !== undefined && x >= 0 && setPop(pop.map((y, j) => (j === k ? { ...y, people: x } : y)))}
                />
                <button onClick={() => setPop(pop.filter((_, j) => j !== k))}>✕</button>
              </div>
            )
          })}
          <button
            onClick={() =>
              setPop([
                ...pop,
                { from: { at: { t_s: now, cal: displayCal ?? undefined } }, people: Math.round(populationAt(city.population, now)) || 1000 }
              ])
            }
            id="addPopulation"
          >
            Add a count at the current date
          </button>
          <p className="muted small">Between two counts it grows (or shrinks) by the same factor each year; after the last it holds.</p>
        </div>

        <div className="conditions" id="conditions">
          <h3>At the current date</h3>
          {condError && <p className="error">{condError}</p>}
          {cond && (
            <dl className="facts compact">
              <dt>Local time</dt>
              <dd>
                {cond.localHours === null ? 'the star never moves here' : `${hhmm(cond.localHours)} local solar time`}
                {cond.localHour_s !== null && Math.abs(cond.localHour_s - 3600) > 60 && (
                  <span className="muted small"> (a local hour is {duration(cond.localHour_s)})</span>
                )}
              </dd>
              <dt>Date</dt>
              <dd>{localDate ?? '…'}</dd>
              <dt>Sun</dt>
              <dd>
                {sig(cond.sun.alt / DEG, 3)}° up, az {sig(cond.sun.az / DEG, 3)}° · {twilight(cond.sun.alt / DEG)}
              </dd>
              <dt>Season</dt>
              <dd>{cond.season.seasons ? `${cond.season.name} (${cond.season.hemisphere}ern hemisphere)` : cond.season.name}</dd>
              <dt>Daylight</dt>
              <dd>
                {cond.daylight.polar === 'day'
                  ? 'the sun does not set today'
                  : cond.daylight.polar === 'night'
                    ? 'the sun does not rise today'
                    : cond.daylight.day === null
                      ? '—'
                      : `${sig(cond.daylight.day, 3)} h, sunrise ${hhmm(cond.daylight.sunrise)}, sunset ${hhmm(cond.daylight.sunset)}`}
              </dd>
              {cond.daylight.civil !== null && cond.daylight.polar === null && (
                <>
                  <dt>Twilight</dt>
                  <dd>
                    {sig(cond.daylight.civil / 2, 2)} h civil, {sig(cond.daylight.nautical! / 2, 2)} h nautical,{' '}
                    {sig(cond.daylight.astronomical! / 2, 2)} h astronomical, each side
                  </dd>
                </>
              )}
              {cond.tide && (
                <>
                  <dt title="The pull of the moons and the star alone: coasts and basins shape real tides a great deal">
                    Tide (equilibrium)
                  </dt>
                  <dd>
                    {cond.tide.trend}, {Math.round(cond.tide.level * 100)}% of the way from low to high
                    {cond.tide.nextHigh_s !== null && `, high water in ${duration(cond.tide.nextHigh_s)}`}
                    {cond.tide.spring !== null &&
                      ` · ${cond.tide.spring > 0.7 ? 'springs' : cond.tide.spring < 0.3 ? 'neaps' : 'between springs and neaps'}`}
                    <span className="muted small">
                      {' '}
                      (mostly{' '}
                      {cond.tide.main === 'star' ? 'the star' : (bodies.find((b) => b.id === cond.tide!.main)?.name ?? cond.tide.main)})
                    </span>
                  </dd>
                </>
              )}
              <dt>Held by</dt>
              <dd>{polityName(cond.polity)}</dd>
              <dt>People</dt>
              <dd>{people(cond.population)}</dd>
              {cond.port && (
                <>
                  <dt>In port</dt>
                  <dd>about {sig(cond.port.inPort, 3)} ships alongside</dd>
                  <dt>Coming in</dt>
                  <dd>
                    {cond.port.arriving.length
                      ? cond.port.arriving
                          .map((r) => `${r.underway} from ${nodeName(r.neighbour)} (${routeName(r.route)}, ${sig(r.perDay, 3)}/day)`)
                          .join('; ')
                      : 'none'}
                  </dd>
                  <dt>Going out</dt>
                  <dd>
                    {cond.port.leaving.length
                      ? cond.port.leaving
                          .map((r) => `${r.underway} for ${nodeName(r.neighbour)} (${routeName(r.route)}, ${sig(r.perDay, 3)}/day)`)
                          .join('; ')
                      : 'none'}
                  </dd>
                </>
              )}
            </dl>
          )}
          <CitySky city={v} now={now} snapshot={snapshot} rootKey={rootKey} />
        </div>
      </div>
    </div>
  )
}

function CitySky({
  city,
  now,
  snapshot,
  rootKey
}: {
  city: CityValue
  now: number
  snapshot: WorldSnapshot
  rootKey: string
}): React.JSX.Element {
  const vp = useMemo(
    () => ({ body: city.body, lat_deg: city.lat_deg, lon_deg: city.lon_deg, elevation_m: city.elevation_m }),
    [city.body, city.lat_deg, city.lon_deg, city.elevation_m]
  )
  const { picture, model, error } = useSky(vp, now, snapshot)
  const [cam, setCam] = useWorldPref<SkyCamera>(rootKey, 'citySkyCamera', { az: Math.PI, alt: 30 * DEG, fov: 110 * DEG })
  return (
    <div className="city-sky">
      {picture && model ? (
        <SkyCanvas picture={picture} model={model} cam={cam} setCam={setCam} onPick={() => {}} />
      ) : (
        <p className="muted small">{error ?? 'Working out the sky…'}</p>
      )}
    </div>
  )
}

function PlaceMap({
  body,
  snapshot,
  city,
  onPlace
}: {
  body: string
  snapshot: WorldSnapshot
  city: CityInfoDto
  onPlace(lat: number, lon: number): void
}): React.JSX.Element {
  const hasTerrain = snapshot.terrains.some((t) => t.value?.body === body)
  const [raster, setRaster] = useState<TerrainRasterDto | null>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!hasTerrain) {
      setRaster(null)
      return
    }
    let live = true
    void window.malevo.terrain.raster(body, MAP_W, MAP_H).then((r) => live && setRaster('error' in r ? null : r))
    return () => {
      live = false
    }
  }, [body, hasTerrain, snapshot.version])
  useEffect(() => {
    const c = ref.current!
    c.width = MAP_W
    c.height = MAP_H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#2a2f38'
    ctx.fillRect(0, 0, MAP_W, MAP_H)
    if (raster) ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba), raster.width, raster.height), 0, 0)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * MAP_H
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(MAP_W, y)
      ctx.stroke()
    }
    for (let lon = -120; lon <= 120; lon += 60) {
      const x = ((lon + 180) / 360) * MAP_W
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, MAP_H)
      ctx.stroke()
    }
  }, [raster])
  const here = snapshot.cities.filter((c) => c.value.body === body)
  const xy = (lat: number, lon: number): [number, number] => [
    (((((lon + 180) % 360) + 360) % 360) / 360) * MAP_W,
    ((90 - lat) / 180) * MAP_H
  ]
  return (
    <div className="terrain-map place-map" style={{ width: MAP_W, height: MAP_H }}>
      <canvas ref={ref} style={{ width: MAP_W, height: MAP_H }} />
      <svg
        width={MAP_W}
        height={MAP_H}
        className="drawing"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const lat = Math.round((90 - ((e.clientY - r.top) / r.height) * 180) * 100) / 100
          const lon = Math.round((((e.clientX - r.left) / r.width) * 360 - 180) * 100) / 100
          onPlace(lat, lon)
        }}
        id="placeMap"
      >
        {here.map((c) => {
          const [x, y] = xy(Number(c.value.lat_deg), Number(c.value.lon_deg))
          return (
            <g key={c.id} className={c.id === city.id ? 'city-mark current' : 'city-mark'}>
              <circle cx={x} cy={y} r={c.id === city.id ? 5 : 3.5} />
              <text x={x + 7} y={y + 4}>
                {String(c.value.name)}
              </text>
            </g>
          )
        })}
      </svg>
      {!hasTerrain && <span className="terrain-busy muted small">No terrain for this body yet (Terrain tool). Click to place.</span>}
    </div>
  )
}

function PopulationChart({
  city,
  now,
  setNow,
  displayCal,
  version
}: {
  city: CityInfoDto
  now: number
  setNow(t: number): void
  displayCal: string | null
  version: number
}): React.JSX.Element | null {
  const pts = city.population
  const W = 512
  const H = 150
  const pad = { l: 56, r: 8, t: 8, b: 22 }
  const t0 = pts.length ? Math.min(pts[0].t, now) : now
  const t1 = pts.length ? Math.max(pts[pts.length - 1].t, now) : now
  const span = t1 - t0 || 1
  const lo = t0 - span * 0.05
  const hi = t1 + span * 0.15
  const ends = useMemo(
    () => [
      { t: lo, precision: 'year' },
      { t: hi, precision: 'year' }
    ],
    [lo, hi]
  )
  const labels = useFormatted(displayCal, ends, version)
  if (!pts.length) return null
  const maxP = Math.max(10, ...pts.map((p) => p.people))
  const minP = Math.max(1, Math.min(...pts.map((p) => p.people).filter((x) => x > 0), maxP) / 10)
  const X = (t: number): number => pad.l + ((t - lo) / (hi - lo)) * (W - pad.l - pad.r)
  const Y = (p: number): number =>
    pad.t + (1 - (Math.log10(Math.max(p, minP)) - Math.log10(minP)) / (Math.log10(maxP * 1.2) - Math.log10(minP))) * (H - pad.t - pad.b)
  const line: string[] = []
  for (let k = 0; k <= 120; k++) {
    const t = lo + ((hi - lo) * k) / 120
    const p = populationAt(pts, t)
    if (p > 0) line.push(`${X(t).toFixed(1)},${Y(p).toFixed(1)}`)
  }
  return (
    <svg
      width={W}
      height={H}
      className="approach-chart population-chart"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const f = (e.clientX - r.left - pad.l) / (r.width - pad.l - pad.r)
        if (f >= 0 && f <= 1) setNow(lo + f * (hi - lo))
      }}
    >
      <polyline points={line.join(' ')} className="series-crawl" />
      {pts.map((p) => (
        <circle key={p.index} cx={X(p.t)} cy={Y(p.people)} r={3} className="pop-point" />
      ))}
      {now >= lo && now <= hi && <line x1={X(now)} x2={X(now)} y1={pad.t} y2={H - pad.b} className="series-now" />}
      <text x={pad.l - 6} y={Y(maxP) + 4} textAnchor="end" className="axis">
        {people(maxP)}
      </text>
      <text x={pad.l} y={H - 6} className="axis">
        {labels[0] ?? ''}
      </text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" className="axis">
        {labels[1] ?? ''}
      </text>
    </svg>
  )
}

export const populationTool: ToolDefinition = {
  id: 'population',
  title: 'Population',
  description: 'Cities on planets with their people over time, and the conditions there at any date: time, season, tide, sky, port',
  View: PopulationView
}
