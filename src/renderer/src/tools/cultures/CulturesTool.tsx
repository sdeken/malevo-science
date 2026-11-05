import { useMemo, useState } from 'react'
import { placeholderNames, runGenerator } from '@malevo/gen'
import {
  affinityAt,
  cultureCalendarAt,
  historyAt,
  relationId,
  type CultureFile,
  type CultureSettings,
  type RelationFile
} from '@malevo/model'
import type { EntityDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField, sig } from '../../components/fields'
import { slugId, useFormattedOne, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

type Tab = 'cultures' | 'polities' | 'relations'

/** Event start and end times from the snapshot, for affinity and calendar changes. */
function eventTimes(snapshot: WorldSnapshot): (id: string, from?: 'start' | 'end') => number | null {
  const byId = new Map(snapshot.events.map((e) => [e.id, e]))
  return (id, from = 'start') => (from === 'end' ? byId.get(id)?.end?.t : byId.get(id)?.start?.t) ?? null
}

const COLORS = ['#4f8fe0', '#e0a43c', '#4fc1a6', '#d9604f', '#b07fe0', '#8bc34a', '#e07fb0', '#7f8cff']

function CulturesView({ world, snapshot, now, navigate }: ToolProps): React.JSX.Element {
  const [tab, setTab] = useWorldPref<Tab>(world.root, 'culturesTab', 'cultures')
  const [selected, setSelected] = useState<string | null>(null)

  const add = async (kind: 'culture' | 'polity'): Promise<void> => {
    const list = kind === 'culture' ? snapshot.cultures : snapshot.polities
    const id = slugId(
      kind === 'culture' ? 'new culture' : 'new polity',
      list.map((x) => x.id)
    )
    const color = COLORS[list.length % COLORS.length]
    if (kind === 'culture') {
      const traits = Object.fromEntries((snapshot.cultureSettings?.traits ?? []).map((t) => [t.id, 0.5]))
      await window.malevo.world.setEntity('culture', id, { name: 'New culture', color, traits })
    } else await window.malevo.world.setEntity('polity', id, { name: 'New polity', color })
    setSelected(id)
  }

  if (!snapshot.cultureSettings) {
    return (
      <div className="tool-page">
        <h1>Cultures</h1>
        <p>This world has no settings/cultures.json yet, which lists the traits cultures are described by.</p>
        <button className="primary" onClick={() => navigate('checks')}>
          Add it from the Checks tool
        </button>
      </div>
    )
  }

  const list = tab === 'cultures' ? snapshot.cultures : tab === 'polities' ? snapshot.polities : []
  const current = list.find((x) => x.id === selected) ?? list[0] ?? null

  return (
    <div className="split-tool">
      <nav className="split-list">
        <div className="seg tabs">
          {(['cultures', 'polities', 'relations'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-tab={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {tab !== 'relations' && (
          <>
            <ul>
              {list.map((x) => (
                <li key={x.id}>
                  <button
                    className={x.id === current?.id ? 'list-item is-current' : 'list-item'}
                    onClick={() => setSelected(x.id)}
                    data-entity={x.id}
                  >
                    <span>
                      <span className="swatch" style={{ background: String(x.value?.color ?? '#888') }} /> {String(x.value?.name ?? x.id)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p className="muted small">None yet.</p>}
            <button className="primary" onClick={() => void add(tab === 'cultures' ? 'culture' : 'polity')} id="addEntity">
              New {tab === 'cultures' ? 'culture' : 'polity'}
            </button>
          </>
        )}
        {tab === 'relations' && (
          <p className="muted small">How each pair of cultures feels about the other at the current date. Click a cell to change it.</p>
        )}
      </nav>
      <div className="split-detail">
        {tab === 'cultures' && current && (
          <CultureEditor key={current.id} entity={current} snapshot={snapshot} now={now} seed={world.seed} />
        )}
        {tab === 'polities' && current && (
          <PolityEditor key={current.id} entity={current} snapshot={snapshot} now={now} navigate={navigate} />
        )}
        {tab === 'relations' && <Relations snapshot={snapshot} now={now} />}
        {tab !== 'relations' && !current && <p className="tool-page muted">Make one to start.</p>}
      </div>
    </div>
  )
}

// ---- cultures ----

function CultureEditor({
  entity,
  snapshot,
  now,
  seed
}: {
  entity: EntityDto
  snapshot: WorldSnapshot
  now: number
  seed: number
}): React.JSX.Element {
  const v = entity.value as unknown as CultureFile | null
  const settings = snapshot.cultureSettings as CultureSettings
  const save = (patch: Partial<CultureFile>): void => void window.malevo.world.setEntity('culture', entity.id, { ...v, ...patch })
  const times = eventTimes(snapshot)
  const calNow = v ? cultureCalendarAt(v, now, (id) => times(id)) : null
  const formatted = useFormattedOne(calNow, now, 'day', snapshot.version)
  const samples = useMemo(() => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `${entity.id}.${x}`)
    return Object.values(runGenerator(placeholderNames, { ids, palette: v?.palette ?? 0 }, seed))
  }, [entity.id, v?.palette, seed])

  if (!v) return <p className="tool-page error">This culture's file has errors. See Checks, or fix {entity.path} by hand.</p>
  const unknown = Object.keys(v.traits).filter((k) => !settings.traits.some((t) => t.id === k))
  const calendars = v.calendars ?? []
  const setCalendars = (c: NonNullable<CultureFile['calendars']>): void => save({ calendars: c.length ? c : undefined })

  const remove = (): void => {
    const uses = [
      ...snapshot.polities.filter((p) => p.value?.culture === entity.id).map((p) => `polity “${p.value?.name}”`),
      ...snapshot.relations.filter((r) => (r.value?.between as string[] | undefined)?.includes(entity.id)).map((r) => `relation ${r.id}`),
      ...snapshot.systems.filter((s) => JSON.stringify(s.value.history ?? []).includes(`"${entity.id}"`)).map((s) => `history of ${s.name}`)
    ]
    if (
      window.confirm(
        uses.length
          ? `Delete “${v.name}”?\n\nThese use it and will show errors:\n${uses.map((u) => `• ${u}`).join('\n')}`
          : `Delete “${v.name}”?`
      )
    ) {
      void window.malevo.world.deleteEntity('culture', entity.id)
    }
  }

  return (
    <div className="tool-page culture-editor" data-editing={entity.id}>
      <div className="field-row">
        <TextField label="Name" value={v.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} id="cultureName" />
        <label className="field narrow">
          Colour
          <input type="color" value={v.color} onChange={(e) => save({ color: e.target.value })} />
        </label>
      </div>
      <h3>Traits</h3>
      {settings.traits.map((t) => (
        <div key={t.id} className="trait">
          <span className="trait-label">{t.label}</span>
          <span className="muted small">{t.low ?? '0'}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={v.traits[t.id] ?? 0.5}
            onChange={(e) => save({ traits: { ...v.traits, [t.id]: Number(e.target.value) } })}
            data-trait={t.id}
          />
          <span className="muted small">{t.high ?? '1'}</span>
          <code className="small">{sig(v.traits[t.id] ?? 0.5, 2)}</code>
        </div>
      ))}
      {unknown.length > 0 && (
        <p className="warning small">
          Not defined in settings/cultures.json, so ignored: {unknown.join(', ')}.{' '}
          <button
            className="link"
            onClick={() => save({ traits: Object.fromEntries(Object.entries(v.traits).filter(([k]) => !unknown.includes(k))) })}
          >
            Remove them
          </button>
        </p>
      )}
      <div className="field-row">
        <NumberField
          label="Technology lag, years"
          value={v.techLag_y}
          optional
          placeholder="0"
          onCommit={(techLag_y) => save({ techLag_y })}
        />
        <label className="field">
          Naming palette
          <select value={v.palette ?? 0} onChange={(e) => save({ palette: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((p) => (
              <option key={p} value={p}>
                Palette {p + 1}
              </option>
            ))}
          </select>
          <span className="muted small">Sounds like: {samples.join(', ')}</span>
        </label>
      </div>

      <h3>Calendars it uses</h3>
      <table className="units">
        <tbody>
          {calendars.map((c, i) => (
            <tr key={i}>
              <td>
                <select
                  value={c.calendar}
                  onChange={(e) => setCalendars(calendars.map((x, k) => (k === i ? { ...x, calendar: e.target.value } : x)))}
                >
                  {snapshot.calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={c.from ?? ''}
                  onChange={(e) =>
                    setCalendars(
                      calendars.map((x, k) => (k === i ? { calendar: x.calendar, ...(e.target.value ? { from: e.target.value } : {}) } : x))
                    )
                  }
                >
                  <option value="">from the start</option>
                  {snapshot.events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      from {ev.value?.name ?? ev.id}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button className="link" onClick={() => setCalendars(calendars.filter((_, k) => k !== i))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="link" onClick={() => setCalendars([...calendars, { calendar: snapshot.calendars[0]?.id ?? 'gregorian' }])}>
        Add a calendar
      </button>
      <p className="muted small">
        {calNow ? (
          <>
            At the current date it writes the date as <code>{formatted ?? '…'}</code> (
            {snapshot.calendars.find((c) => c.id === calNow)?.name}).
          </>
        ) : (
          'It has no calendar at the current date.'
        )}
      </p>
      <div className="inspector-actions">
        <button className="danger" onClick={remove}>
          Delete…
        </button>
      </div>
      <p className="muted small">
        Saved as <code>{entity.path}</code>
      </p>
    </div>
  )
}

// ---- polities ----

function PolityEditor({
  entity,
  snapshot,
  now,
  navigate
}: {
  entity: EntityDto
  snapshot: WorldSnapshot
  now: number
  navigate: ToolProps['navigate']
}): React.JSX.Element {
  const v = entity.value as Record<string, string | undefined> | null
  if (!v) return <p className="tool-page error">This polity's file has errors. See Checks, or fix {entity.path} by hand.</p>
  const save = (patch: Record<string, string | undefined>): void =>
    void window.malevo.world.setEntity('polity', entity.id, { ...v, ...patch })
  const held = snapshot.systems.filter((s) => historyAt(s.history, now)?.polity === entity.id)
  const eventSelect = (key: 'founded' | 'dissolved', label: string): React.JSX.Element => (
    <label className="field">
      {label}
      <select value={v[key] ?? ''} onChange={(e) => save({ [key]: e.target.value || undefined })}>
        <option value="">(not set)</option>
        {snapshot.events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.value?.name ?? ev.id}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <div className="tool-page polity-editor" data-editing={entity.id}>
      <div className="field-row">
        <TextField label="Name" value={v.name ?? ''} onCommit={(name) => name.trim() && save({ name: name.trim() })} id="polityName" />
        <label className="field narrow">
          Colour
          <input type="color" value={v.color ?? '#888888'} onChange={(e) => save({ color: e.target.value })} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Dominant culture
          <select value={v.culture ?? ''} onChange={(e) => save({ culture: e.target.value || undefined })}>
            <option value="">(none)</option>
            {snapshot.cultures.map((c) => (
              <option key={c.id} value={c.id}>
                {String(c.value?.name ?? c.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Capital
          <select value={v.capital ?? ''} onChange={(e) => save({ capital: e.target.value || undefined })}>
            <option value="">(none)</option>
            {snapshot.systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        {eventSelect('founded', 'Founded at')}
        {eventSelect('dissolved', 'Dissolved at')}
      </div>
      <h3>Holds at the current date</h3>
      {held.length ? (
        <ul>
          {held.map((s) => (
            <li key={s.id}>
              <button className="link" onClick={() => navigate('systems', s.id)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No systems. A system's history (in the Systems tool) says who holds it when.</p>
      )}
      <div className="inspector-actions">
        <button
          className="danger"
          onClick={() => window.confirm(`Delete “${v.name}”?`) && void window.malevo.world.deleteEntity('polity', entity.id)}
        >
          Delete…
        </button>
      </div>
      <p className="muted small">
        Saved as <code>{entity.path}</code>
      </p>
    </div>
  )
}

// ---- relations ----

function Relations({ snapshot, now }: { snapshot: WorldSnapshot; now: number }): React.JSX.Element {
  const settings = snapshot.cultureSettings as CultureSettings
  const cultures = snapshot.cultures.filter((c) => c.value) as (EntityDto & { value: Record<string, unknown> })[]
  const relations = new Map(snapshot.relations.map((r) => [r.id, r.value as unknown as RelationFile | null]))
  const times = eventTimes(snapshot)
  const [pair, setPair] = useState<[string, string] | null>(null)
  const value = (a: string, b: string): ReturnType<typeof affinityAt> | null => {
    const ca = cultures.find((c) => c.id === a)?.value as unknown as CultureFile
    const cb = cultures.find((c) => c.id === b)?.value as unknown as CultureFile
    if (!ca || !cb) return null
    return affinityAt(ca, cb, relations.get(relationId(a, b)) ?? undefined, settings, now, (id, from) => times(id, from))
  }
  if (cultures.length < 2) return <p className="tool-page muted">Relations need at least two cultures.</p>
  const colour = (v: number): string => (v >= 0 ? `rgba(79, 193, 166, ${0.15 + 0.7 * v})` : `rgba(217, 96, 79, ${0.15 + 0.7 * -v})`)

  // Graph: cultures on a circle, edges by affinity.
  const R = 140
  const pos = cultures.map((_, i) => [
    Math.cos((2 * Math.PI * i) / cultures.length - Math.PI / 2) * R,
    Math.sin((2 * Math.PI * i) / cultures.length - Math.PI / 2) * R
  ])

  return (
    <div className="tool-page wide relations">
      <h1>Relations</h1>
      <div className="relations-layout">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              {cultures.map((c) => (
                <th key={c.id}>
                  <span className="swatch" style={{ background: String(c.value.color) }} /> {String(c.value.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cultures.map((a) => (
              <tr key={a.id}>
                <th>
                  <span className="swatch" style={{ background: String(a.value.color) }} /> {String(a.value.name)}
                </th>
                {cultures.map((b) => {
                  if (a.id === b.id) return <td key={b.id} className="diag" />
                  const v = value(a.id, b.id)!
                  return (
                    <td
                      key={b.id}
                      style={{ background: colour(v.value) }}
                      className={pair && relationId(...pair) === relationId(a.id, b.id) ? 'is-current' : undefined}
                      onClick={() => setPair([a.id, b.id])}
                      title={v.source === 'traits' ? 'From their traits' : v.source === 'set' ? 'Set by hand' : `Since ${v.change?.event}`}
                      data-cell={relationId(a.id, b.id)}
                    >
                      {sig(v.value, 2)}
                      {v.source !== 'traits' && <span className="cell-mark">•</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <svg className="relations-graph" viewBox="-190 -190 380 380" width={380} height={380} role="img" aria-label="Relations graph">
          {cultures.flatMap((a, i) =>
            cultures.slice(i + 1).map((b, k) => {
              const v = value(a.id, b.id)!.value
              const j = i + 1 + k
              return (
                <line
                  key={`${a.id}-${b.id}`}
                  x1={pos[i][0]}
                  y1={pos[i][1]}
                  x2={pos[j][0]}
                  y2={pos[j][1]}
                  stroke={v >= 0 ? '#4fc1a6' : '#d9604f'}
                  strokeWidth={0.5 + 4 * Math.abs(v)}
                  strokeOpacity={0.25 + 0.6 * Math.abs(v)}
                  strokeDasharray={v < 0 ? '5 4' : undefined}
                />
              )
            })
          )}
          {cultures.map((c, i) => (
            <g key={c.id} transform={`translate(${pos[i][0]} ${pos[i][1]})`}>
              <circle r={9} fill={String(c.value.color)} />
              <text className="graph-label" y={-14} textAnchor="middle">
                {String(c.value.name)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="muted small">
        Green is warm, red is hostile; a dot marks a value set by hand or changed at an event. Values are at the current date.
      </p>
      {pair && (
        <RelationEditor key={relationId(...pair)} a={pair[0]} b={pair[1]} snapshot={snapshot} derived={value(pair[0], pair[1])!.derived} />
      )}
    </div>
  )
}

function RelationEditor({
  a,
  b,
  snapshot,
  derived
}: {
  a: string
  b: string
  snapshot: WorldSnapshot
  derived: number
}): React.JSX.Element {
  const id = relationId(a, b)
  const existing = snapshot.relations.find((r) => r.id === id)?.value as unknown as RelationFile | undefined
  const rel: RelationFile = existing ?? { between: [a, b].sort() as [string, string] }
  const save = (patch: Partial<RelationFile>): void => {
    const next: RelationFile = { ...rel, ...patch }
    if (!next.changes?.length) delete next.changes
    if (next.affinity === undefined && !next.changes) {
      if (existing) void window.malevo.world.deleteEntity('relation', id)
      return
    }
    void window.malevo.world.setEntity('relation', id, next)
  }
  const name = (c: string): string => String(snapshot.cultures.find((x) => x.id === c)?.value?.name ?? c)
  const changes = rel.changes ?? []
  return (
    <div className="relation-editor" data-relation={id}>
      <h3>
        {name(a)} and {name(b)}
      </h3>
      <NumberField
        label={`Affinity, −1 to 1 (empty: from their traits, ${sig(derived, 2)})`}
        value={rel.affinity}
        optional
        onCommit={(v) => save({ affinity: v === undefined ? undefined : Math.max(-1, Math.min(1, v)) })}
        id="relationAffinity"
      />
      <h3>Changes at events</h3>
      <table className="units">
        <tbody>
          {changes.map((c, i) => (
            <tr key={i}>
              <td>
                <select
                  value={c.event}
                  onChange={(e) => save({ changes: changes.map((x, k) => (k === i ? { ...x, event: e.target.value } : x)) })}
                >
                  {snapshot.events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.value?.name ?? ev.id}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={c.from ?? 'start'}
                  onChange={(e) =>
                    save({ changes: changes.map((x, k) => (k === i ? { ...x, from: e.target.value === 'end' ? 'end' : undefined } : x)) })
                  }
                >
                  <option value="start">at its start</option>
                  <option value="end">at its end</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min={-1}
                  max={1}
                  step={0.1}
                  defaultValue={c.affinity}
                  onBlur={(e) =>
                    save({
                      changes: changes.map((x, k) =>
                        k === i ? { ...x, affinity: Math.max(-1, Math.min(1, Number(e.target.value) || 0)) } : x
                      )
                    })
                  }
                />
              </td>
              <td>
                <button className="link" onClick={() => save({ changes: changes.filter((_, k) => k !== i) })}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshot.events.length ? (
        <button className="link" onClick={() => save({ changes: [...changes, { event: snapshot.events[0].id, affinity: 0 }] })}>
          Add a change at an event
        </button>
      ) : (
        <p className="muted small">Changes hang on timeline events; add some events first.</p>
      )}
    </div>
  )
}

export const culturesTool: ToolDefinition = {
  id: 'cultures',
  title: 'Cultures',
  description: 'Cultures, polities, and how they feel about each other over time',
  View: CulturesView
}
