import { useEffect, useState } from 'react'
import {
  newDrifter,
  newTraveller,
  type DriftReport,
  type DrifterFile,
  type PlaceFile,
  type TravellerFile,
  type TravellerReport
} from '@malevo/model'
import type { CalendarInfo, WorldSnapshot } from '../../../../shared/types'
import { DateInput } from '../../components/DateInput'
import { NumberField, TextField, duration, sig } from '../../components/fields'
import { slugId, useFormatted, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * Whereabouts: where someone or something is, and whether they could have got
 * there. Travellers are lists of stops with dates; every gap is checked
 * against the quickest trip the physics allows. Drifters coast in a straight
 * line from a place and a time; the tool says where they are at the current
 * date and which stars they pass. Files: travellers/<id>.json, drifters/<id>.json.
 */
function WhereaboutsView({ world, snapshot, now, displayCal, focus }: ToolProps): React.JSX.Element {
  const [sel, setSel] = useWorldPref<string | null>(world.root, 'whereabouts', null)
  // Opened on one: select it.
  useEffect(() => {
    if (focus) setSel(focus)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = [
    ...snapshot.travellers.map((e) => ({ key: `traveller:${e.id}`, kind: 'traveller' as const, e })),
    ...snapshot.drifters.map((e) => ({ key: `drifter:${e.id}`, kind: 'drifter' as const, e }))
  ]
  const current = all.find((x) => x.key === sel) ?? all[0] ?? null
  const cal = displayCal ?? snapshot.calendars[0]?.id ?? 'gregorian'
  return (
    <div className="split-tool whereabouts">
      <nav className="split-list">
        <h2>Whereabouts</h2>
        <h3 className="label">Travellers</h3>
        <ul>
          {snapshot.travellers.map((e) => (
            <li key={e.id}>
              <button
                className={current?.key === `traveller:${e.id}` ? 'list-item is-current' : 'list-item'}
                onClick={() => setSel(`traveller:${e.id}`)}
                data-traveller={e.id}
              >
                <span>{String(e.value?.name ?? e.id)}</span>
                <span className="muted small">{e.value ? `${(e.value.stops as unknown[]).length} stops` : 'has errors'}</span>
              </button>
            </li>
          ))}
        </ul>
        <NewEntry
          placeholder="New traveller…"
          id="newTraveller"
          taken={snapshot.travellers.map((e) => e.id)}
          onMake={(id, name) =>
            void window.malevo.world.setEntity('traveller', id, newTraveller(name)).then(() => setSel(`traveller:${id}`))
          }
        />
        <h3 className="label">Drifters</h3>
        <ul>
          {snapshot.drifters.map((e) => (
            <li key={e.id}>
              <button
                className={current?.key === `drifter:${e.id}` ? 'list-item is-current' : 'list-item'}
                onClick={() => setSel(`drifter:${e.id}`)}
                data-drifter={e.id}
              >
                <span>{String(e.value?.name ?? e.id)}</span>
                <span className="muted small">{e.value ? `${sig(Number(e.value.speed_kms), 3)} km/s` : 'has errors'}</span>
              </button>
            </li>
          ))}
        </ul>
        <NewEntry
          placeholder="New drifter…"
          id="newDrifter"
          taken={snapshot.drifters.map((e) => e.id)}
          onMake={(id, name) => {
            const sys = snapshot.systems[0]?.id
            void window.malevo.world
              .setEntity('drifter', id, newDrifter(name, sys ? { system: sys } : {}, { t_s: now }))
              .then(() => setSel(`drifter:${id}`))
          }}
        />
      </nav>
      <div className="tool-page wide">
        {!current ? (
          <>
            <h1>Whereabouts</h1>
            <p className="muted">
              Keep track of where people and things are. A traveller is a list of stops with dates, and every gap between stops is checked
              against the quickest trip the physics allows, so nobody is somewhere they couldn’t have reached. A drifter coasts from a place
              at a time and a speed; see where it is at any date and which stars it passes.
            </p>
          </>
        ) : !current.e.value ? (
          <p className="error">This file has errors; see the Checks tool.</p>
        ) : current.kind === 'traveller' ? (
          <TravellerEditor
            key={current.key}
            id={current.e.id}
            file={current.e.value as unknown as TravellerFile}
            snapshot={snapshot}
            now={now}
            cal={cal}
          />
        ) : (
          <DrifterEditor
            key={current.key}
            id={current.e.id}
            file={current.e.value as unknown as DrifterFile}
            snapshot={snapshot}
            now={now}
            cal={cal}
          />
        )}
      </div>
    </div>
  )
}

function NewEntry({
  placeholder,
  id,
  taken,
  onMake
}: {
  placeholder: string
  id: string
  taken: string[]
  onMake(id: string, name: string): void
}): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onMake(slugId(name, taken), name.trim())
        setName('')
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} id={`${id}Name`} />
      <button type="submit" disabled={!name.trim()} id={id}>
        Add
      </button>
    </form>
  )
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** A place: a system or station, then optionally a body in the system, then optionally a city on the body. */
function PlacePicker({
  value,
  onChange,
  snapshot,
  id,
  stars
}: {
  value: PlaceFile
  onChange(p: PlaceFile): void
  snapshot: WorldSnapshot
  id?: string
  stars?: boolean
}): React.JSX.Element {
  const bodySystem = value.body ? snapshot.systems.find((s) => s.bodies.some((b) => b.id === value.body))?.id : undefined
  const city = value.city ? snapshot.cities.find((c) => c.id === value.city) : undefined
  const cityBody = city ? String(city.value?.body ?? '') : undefined
  const cityBodySystem = cityBody ? snapshot.systems.find((s) => s.bodies.some((b) => b.id === cityBody))?.id : undefined
  const system = value.system ?? bodySystem ?? cityBodySystem
  const top = system ? `system:${system}` : value.station ? `station:${value.station}` : value.star ? `star:${value.star}` : ''
  const body = value.body ?? cityBody ?? ''
  const sys = snapshot.systems.find((s) => s.id === system)
  const cities = snapshot.cities.filter((c) => c.value?.body === body)
  return (
    <span className="place-picker">
      <select
        value={top}
        id={id}
        onChange={(e) => {
          const [k, v] = e.target.value.split(':')
          onChange(
            k === 'system' ? { system: v } : k === 'station' ? { station: v } : k === 'star' ? { star: e.target.value.slice(5) } : {}
          )
        }}
        aria-label="System or station"
      >
        <option value="">—</option>
        <optgroup label="Systems">
          {snapshot.systems.map((s) => (
            <option key={s.id} value={`system:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
        {snapshot.stations.length > 0 && (
          <optgroup label="Stations">
            {snapshot.stations.map((s) => (
              <option key={s.id} value={`station:${s.id}`}>
                {String(s.value?.name ?? s.id)}
              </option>
            ))}
          </optgroup>
        )}
        {stars && value.star && <option value={`star:${value.star}`}>{value.star}</option>}
      </select>
      {sys && sys.bodies.length > 0 && (
        <select value={body} onChange={(e) => onChange(e.target.value ? { body: e.target.value } : { system: sys.id })} aria-label="Body">
          <option value="">anywhere in {sys.name}</option>
          {sys.bodies
            .filter((b) => b.cls !== 'belt')
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
      )}
      {body && cities.length > 0 && (
        <select value={value.city ?? ''} onChange={(e) => onChange(e.target.value ? { city: e.target.value } : { body })} aria-label="City">
          <option value="">anywhere on it</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {String(c.value?.name ?? c.id)}
            </option>
          ))}
        </select>
      )}
    </span>
  )
}

type Stop = TravellerFile['stops'][number]

function TravellerEditor({
  id,
  file,
  snapshot,
  now,
  cal
}: {
  id: string
  file: TravellerFile
  snapshot: WorldSnapshot
  now: number
  cal: string
}): React.JSX.Element {
  const save = (next: TravellerFile): void => void window.malevo.world.setEntity('traveller', id, clean(next))
  const setStop = (i: number, patch: Partial<Stop>): void =>
    save({ ...file, stops: file.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const [report, setReport] = useState<TravellerReport | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    void window.malevo.where.traveller(id, now).then((r) => live && setReport(r))
    return () => {
      live = false
    }
  }, [id, now, snapshot.version])
  const r = report && !('error' in report) ? report : null
  const times = file.stops.flatMap((s) => [s.arrive?.t_s, s.depart?.t_s]).map((t) => ({ t: t ?? 0, precision: 'minute' }))
  const formatted = useFormatted(cal, times, snapshot.version)
  return (
    <section className="traveller" id="traveller">
      <div className="field-row">
        <TextField label="Traveller" value={file.name} onCommit={(v) => v.trim() && save({ ...file, name: v.trim() })} id="travellerName" />
      </div>
      <p className="where-now" id="travellerNow">
        {r ? r.now : report && 'error' in report ? <span className="error">{report.error}</span> : '…'}
      </p>
      <ol className="stops">
        {file.stops.map((s, i) => {
          const gap = r?.gaps[i]
          return (
            <li key={i} className="stop" data-stop={i}>
              <div className="stop-row">
                <PlacePicker value={s.place} onChange={(place) => setStop(i, { place })} snapshot={snapshot} id={`stopPlace${i}`} />
                <label className="field">
                  Arrives
                  <span className="row">
                    <DateInput
                      calendars={snapshot.calendars as CalendarInfo[]}
                      cal={s.arrive?.cal ?? cal}
                      text={s.arrive?.text ?? (s.arrive ? (formatted[i * 2] ?? '') : '')}
                      onCommit={(d) => setStop(i, { arrive: { t_s: d.t, cal: d.cal, text: d.text } })}
                      id={`stopArrive${i}`}
                      placeholder="—"
                    />
                    {s.arrive && (
                      <button className="link small" onClick={() => setStop(i, { arrive: undefined })} title="No arrival date">
                        ×
                      </button>
                    )}
                  </span>
                </label>
                <label className="field">
                  Leaves
                  <span className="row">
                    <DateInput
                      calendars={snapshot.calendars as CalendarInfo[]}
                      cal={s.depart?.cal ?? cal}
                      text={s.depart?.text ?? (s.depart ? (formatted[i * 2 + 1] ?? '') : '')}
                      onCommit={(d) => setStop(i, { depart: { t_s: d.t, cal: d.cal, text: d.text } })}
                      id={`stopDepart${i}`}
                      placeholder="—"
                    />
                    {s.depart && (
                      <button className="link small" onClick={() => setStop(i, { depart: undefined })} title="No departure date">
                        ×
                      </button>
                    )}
                  </span>
                </label>
                <span className="stop-actions">
                  <button
                    className="link"
                    disabled={i === 0}
                    onClick={() => save({ ...file, stops: move(file.stops, i, i - 1) })}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="link"
                    disabled={i === file.stops.length - 1}
                    onClick={() => save({ ...file, stops: move(file.stops, i, i + 1) })}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className="link danger"
                    onClick={() => save({ ...file, stops: file.stops.filter((_, j) => j !== i) })}
                    title="Remove this stop"
                  >
                    Remove
                  </button>
                </span>
              </div>
              <NoteInput value={s.note} onCommit={(note) => setStop(i, { note })} />
              {r?.stops[i]?.error && <p className="error small">{r.stops[i].error}</p>}
              {gap && i < file.stops.length - 1 && <GapLine gap={gap} />}
            </li>
          )
        })}
      </ol>
      <button
        onClick={() => {
          const last = file.stops[file.stops.length - 1]
          save({
            ...file,
            stops: [...file.stops, { place: last ? last.place : snapshot.systems[0] ? { system: snapshot.systems[0].id } : {} }]
          })
        }}
        id="addStop"
      >
        Add a stop
      </button>
      <p className="muted small">
        Each gap is checked against the quickest trip: between systems, door to door through the stars (crawl out, foam legs within the leg
        limit, a stopover at each star on the way, crawl in); inside one system, a flip-and-burn between the bodies at the cruise
        acceleration. Impossible gaps also show in the Checks tool.
      </p>
    </section>
  )
}

function move<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice()
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

function NoteInput({ value, onCommit }: { value: string | undefined; onCommit(v: string | undefined): void }): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <input
      className="stop-note"
      value={draft}
      placeholder="note…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== (value ?? '') && onCommit(draft.trim() || undefined)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function GapLine({ gap }: { gap: TravellerReport['gaps'][number] }): React.JSX.Element {
  const via = gap.via.length ? ` via ${gap.via.join(', ')}` : ''
  const how = gap.how === 'in-system' ? ' (in-system burn)' : gap.how === 'none' ? ' (same place)' : ''
  return (
    <p className={`gap ${gap.verdict}`} data-gap={gap.verdict}>
      {gap.error ? (
        <span className="error">{gap.error}</span>
      ) : (
        <>
          <span className="gap-mark">{{ ok: '✓', tight: '!', impossible: '✕', unknown: '·' }[gap.verdict]}</span> Quickest trip{' '}
          {duration(gap.needed)}
          {via}
          {how}
          {gap.available !== null ? `; ${duration(gap.available)} between stops` : '; add dates to check it'}
          {gap.verdict === 'impossible' &&
            gap.available !== null &&
            gap.needed !== null &&
            ` — ${duration(gap.needed - gap.available)} short`}
          {gap.verdict === 'tight' && ' — less than a tenth to spare'}
        </>
      )}
    </p>
  )
}

type HeadingMode = 'toward' | 'galactic' | 'sky'

function DrifterEditor({
  id,
  file,
  snapshot,
  now,
  cal
}: {
  id: string
  file: DrifterFile
  snapshot: WorldSnapshot
  now: number
  cal: string
}): React.JSX.Element {
  const save = (next: DrifterFile): void => void window.malevo.world.setEntity('drifter', id, clean(next))
  const [horizon, setHorizon] = useState(5000)
  const [within, setWithin] = useState(1)
  const [report, setReport] = useState<DriftReport | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    void window.malevo.where.drift(id, now, horizon, within).then((r) => live && setReport(r))
    return () => {
      live = false
    }
  }, [id, now, horizon, within, snapshot.version])
  const h = file.heading
  const mode: HeadingMode = h.toward ? 'toward' : h.ra_deg !== undefined ? 'sky' : 'galactic'
  const setMode = (m: HeadingMode): void =>
    save({
      ...file,
      heading:
        m === 'toward'
          ? { toward: snapshot.systems[0] ? { system: snapshot.systems[0].id } : {} }
          : m === 'galactic'
            ? { l_deg: 0, b_deg: 0 }
            : { ra_deg: 0, dec_deg: 0 }
    })
  const r = report && !('error' in report) ? report : null
  const passTimes = useFormatted(
    cal,
    (r?.passes ?? []).map((p) => ({ t: p.t, precision: 'year' })),
    snapshot.version
  )
  const atText = useFormatted(cal, [{ t: file.at.t_s, precision: 'minute' }], snapshot.version)[0]
  return (
    <section className="drifter" id="drifter">
      <div className="field-row">
        <TextField label="Drifter" value={file.name} onCommit={(v) => v.trim() && save({ ...file, name: v.trim() })} id="drifterName" />
        <NumberField
          label="Speed, km/s"
          value={file.speed_kms}
          onCommit={(x) => x !== undefined && x > 0 && save({ ...file, speed_kms: x })}
          id="drifterSpeed"
        />
        <NumberField
          label="Give or take, degrees"
          value={file.cone_deg}
          optional
          onCommit={(x) => save({ ...file, cone_deg: x !== undefined && x > 0 ? x : undefined })}
          id="drifterCone"
          hint="half-angle of the cone it went in"
        />
      </div>
      <div className="field-row">
        <label className="field">
          From
          <PlacePicker value={file.from} onChange={(from) => save({ ...file, from })} snapshot={snapshot} id="drifterFrom" />
        </label>
        <label className="field">
          Leaving
          <DateInput
            calendars={snapshot.calendars as CalendarInfo[]}
            cal={file.at.cal ?? cal}
            text={file.at.text ?? atText ?? ''}
            onCommit={(d) => save({ ...file, at: { t_s: d.t, cal: d.cal, text: d.text } })}
            id="drifterAt"
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Heading
          <select value={mode} onChange={(e) => setMode(e.target.value as HeadingMode)} id="drifterHeadingMode">
            <option value="toward">toward a place</option>
            <option value="galactic">galactic longitude and latitude</option>
            <option value="sky">right ascension and declination</option>
          </select>
        </label>
        {mode === 'toward' && (
          <label className="field">
            Toward
            <PlacePicker
              value={h.toward ?? {}}
              onChange={(toward) => save({ ...file, heading: { toward } })}
              snapshot={snapshot}
              id="drifterToward"
            />
          </label>
        )}
        {mode === 'galactic' && (
          <>
            <NumberField
              label="l, °"
              value={h.l_deg}
              onCommit={(x) => x !== undefined && save({ ...file, heading: { l_deg: x, b_deg: h.b_deg ?? 0 } })}
            />
            <NumberField
              label="b, °"
              value={h.b_deg}
              onCommit={(x) => x !== undefined && save({ ...file, heading: { l_deg: h.l_deg ?? 0, b_deg: x } })}
            />
          </>
        )}
        {mode === 'sky' && (
          <>
            <NumberField
              label="RA, °"
              value={h.ra_deg}
              onCommit={(x) => x !== undefined && save({ ...file, heading: { ra_deg: x, dec_deg: h.dec_deg ?? 0 } })}
            />
            <NumberField
              label="Dec, °"
              value={h.dec_deg}
              onCommit={(x) => x !== undefined && save({ ...file, heading: { ra_deg: h.ra_deg ?? 0, dec_deg: x } })}
            />
          </>
        )}
      </div>
      {report && 'error' in report && <p className="error">{report.error}</p>}
      {r && (
        <>
          <p className="where-now" id="drifterNow">
            {r.pos
              ? `At the current date: ${sig(r.travelled_ly, 3)} ly from ${r.from}${r.spread_ly > 0 ? `, give or take ${sig(r.spread_ly, 2)} ly sideways` : ''}${r.nearest ? `; the nearest star is ${r.nearest.name}, ${sig(r.nearest.ly, 3)} ly away` : ''}.`
              : `It hasn’t left ${r.from} yet at the current date.`}
          </p>
          <p className="muted small">
            {sig(r.speed_c * 100, 3)}% of light speed: a light-year every {duration((1 / r.lyPerYear) * 365.25 * 86400)}.
          </p>
          <h3>Stars it passes</h3>
          <div className="field-row">
            <NumberField
              label="Within, ly"
              value={within}
              onCommit={(x) => x !== undefined && x > 0 && setWithin(x)}
              id="drifterWithin"
              hint="plus the cone’s spread there"
            />
            <NumberField
              label="Over the first, years"
              value={horizon}
              onCommit={(x) => x !== undefined && x >= 1 && setHorizon(Math.round(x))}
              id="drifterHorizon"
            />
          </div>
          {!r.passes.length ? (
            <p className="muted">No star within that distance of its path.</p>
          ) : (
            <table className="data small" id="drifterPasses">
              <thead>
                <tr>
                  <th>Star</th>
                  <th>Closest</th>
                  <th>When</th>
                  <th>After</th>
                  <th>Miss</th>
                </tr>
              </thead>
              <tbody>
                {r.passes.map((p, i) => (
                  <tr key={p.star} className={p.inCone ? 'in-cone' : undefined}>
                    <td>
                      {p.name}
                      {p.system ? ' (system)' : ''}
                    </td>
                    <td>{sig(p.along_ly, 3)} ly out</td>
                    <td>{passTimes[i] ?? '…'}</td>
                    <td>{duration(p.t - file.at.t_s)}</td>
                    <td>
                      {p.miss_ly < 1e-6 ? 'dead on' : p.miss_ly < 0.01 ? `${sig(p.miss_ly * 63241, 3)} AU` : `${sig(p.miss_ly, 3)} ly`}
                      {p.inCone ? ' · inside the cone' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Straight lines: the stars don’t move, and passing stars don’t bend the path. “Inside the cone” means the star sits within the
            give-or-take angle, so it might be hit, or passed very close.
          </p>
        </>
      )}
    </section>
  )
}

export const whereaboutsTool: ToolDefinition = {
  id: 'whereabouts',
  title: 'Whereabouts',
  description: 'Where people and drifting things are, and whether they could have got there',
  View: WhereaboutsView
}
