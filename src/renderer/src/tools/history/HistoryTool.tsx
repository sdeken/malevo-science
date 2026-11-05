import { useMemo, useState } from 'react'
import { JULIAN_YEAR } from '@malevo/core'
import type { HistoryProposalDto, NewsDto, ProposedFileDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, sig } from '../../components/fields'
import { useFormatted, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { StarMap, type MapRoute, type MapSystem } from '../stars/StarMap'

type Tab = 'run' | 'settings' | 'news'
type Settings = {
  seed?: number
  origin: string
  originCulture: string
  slowShips: string
  foamDrive: string
  end: string
  step_y?: number
  slow: { reach_ly: number; colonies: number }
  growth: { systems: number; maxRadius_ly: number; outward_ly?: number; legs?: number }
  culture: { enclaveRate: number; splitRate: number; splitDistance_ly: number; blendRate: number }
  enclaves?: { culture: string; from?: string }[]
  polities?: { from: string; list: { polity: string; share: number; unify?: number }[] }
}

const GROUPS: { group: ProposedFileDto['group']; title: string }[] = [
  { group: 'system', title: 'Systems' },
  { group: 'culture', title: 'Cultures' },
  { group: 'route', title: 'Routes' },
  { group: 'event', title: 'Events' },
  { group: 'polity', title: 'Polities' }
]

const name = (list: { id: string; value: Record<string, unknown> | null }[], id: string): string =>
  String(list.find((x) => x.id === id)?.value?.name ?? id)

function HistoryView({ world, snapshot, displayCal, navigate, setNow }: ToolProps): React.JSX.Element {
  const [tab, setTab] = useWorldPref<Tab>(world.root, 'historyTab', 'run')
  const settings = snapshot.historySettings as Settings | null
  if (!settings) return <Setup snapshot={snapshot} navigate={navigate} />
  return (
    <div className="tool-page wide history" id="history">
      <div className="history-head">
        <h1>History</h1>
        <div className="seg tabs">
          {(['run', 'settings', 'news'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-tab={t}>
              {t === 'run' ? 'Run' : t === 'settings' ? 'Settings' : 'News'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'run' && <Run snapshot={snapshot} settings={settings} worldSeed={world.seed} displayCal={displayCal} />}
      {tab === 'settings' && <SettingsEditor snapshot={snapshot} settings={settings} />}
      {tab === 'news' && <News snapshot={snapshot} displayCal={displayCal} setNow={setNow} />}
    </div>
  )
}

// ---- setup ----

function Setup({ snapshot, navigate }: { snapshot: WorldSnapshot; navigate: ToolProps['navigate'] }): React.JSX.Element {
  const events = snapshot.events.filter((e) => e.value)
  const [s, set] = useState({
    origin: snapshot.systems[0]?.id ?? '',
    originCulture: snapshot.cultures[0]?.id ?? '',
    slowShips: events[0]?.id ?? '',
    foamDrive: events[1]?.id ?? events[0]?.id ?? '',
    end: events[events.length - 1]?.id ?? ''
  })
  const missing = [
    !snapshot.systems.length && 'a system to start from (Stars or Systems tool)',
    !snapshot.cultures.length && 'a culture for it (Cultures tool)',
    events.length < 3 && 'events for when slow ships and the foam drive arrive, and for when the run ends (Timeline)'
  ].filter(Boolean)
  const create = (): void => {
    void window.malevo.world.setEntity('historySettings', 'historySettings', {
      ...s,
      slow: { reach_ly: 12.5, colonies: 8 },
      growth: { systems: 150, maxRadius_ly: 120 },
      culture: { enclaveRate: 0.09, splitRate: 0.3, splitDistance_ly: 70, blendRate: 0.03 }
    })
  }
  const sel = (label: string, key: keyof typeof s, options: { id: string; label: string }[], id: string): React.JSX.Element => (
    <label className="field">
      {label}
      <select value={s[key]} onChange={(e) => set({ ...s, [key]: e.target.value })} id={id}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
  const evOpts = events.map((e) => ({ id: e.id, label: e.value!.name }))
  return (
    <div className="tool-page" id="historySetup">
      <h1>History</h1>
      <p>
        The history generator plays settlement out on the stars: a few slow-ship colonies, then the foam drive and the spread outward, with
        cultures branching and blending and polities drawing their borders. It proposes systems, cultures, routes and events; you accept the
        pieces you want, and those become fixed points for the next run.
      </p>
      {missing.length > 0 ? (
        <>
          <p>It needs, first:</p>
          <ul>
            {missing.map((m) => (
              <li key={String(m)}>{m}</li>
            ))}
          </ul>
          <button onClick={() => navigate('timeline')}>Open the Timeline</button>
        </>
      ) : (
        <>
          <div className="field-row">
            {sel(
              'Starts from',
              'origin',
              snapshot.systems.map((x) => ({ id: x.id, label: x.name })),
              'histOrigin'
            )}
            {sel(
              'Its culture',
              'originCulture',
              snapshot.cultures.map((x) => ({ id: x.id, label: String(x.value?.name ?? x.id) })),
              'histCulture'
            )}
          </div>
          <div className="field-row">
            {sel('Slow ships arrive with', 'slowShips', evOpts, 'histSlow')}
            {sel('The foam drive arrives with', 'foamDrive', evOpts, 'histFoam')}
            {sel('The run ends at', 'end', evOpts, 'histEnd')}
          </div>
          <button className="primary" onClick={create} id="historyCreate">
            Create settings/history.json
          </button>
          <p className="muted small">Everything else starts at a default you can change under Settings.</p>
        </>
      )}
    </div>
  )
}

// ---- settings ----

function SettingsEditor({ snapshot, settings }: { snapshot: WorldSnapshot; settings: Settings }): React.JSX.Element {
  const save = (patch: Partial<Settings>): void =>
    void window.malevo.world.setEntity('historySettings', 'historySettings', { ...settings, ...patch })
  const events = snapshot.events.filter((e) => e.value)
  const evSelect = (value: string | undefined, onChange: (v: string) => void, allowNone = false): React.JSX.Element => (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">(from the start)</option>}
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.value!.name}
        </option>
      ))}
    </select>
  )
  const polities = settings.polities
  return (
    <div className="history-settings">
      <h3>When</h3>
      <div className="field-row">
        <label className="field">Slow ships arrive with {evSelect(settings.slowShips, (v) => save({ slowShips: v }))}</label>
        <label className="field">The foam drive arrives with {evSelect(settings.foamDrive, (v) => save({ foamDrive: v }))}</label>
        <label className="field">The run ends at {evSelect(settings.end, (v) => save({ end: v }))}</label>
        <NumberField label="Step, years" value={settings.step_y} optional placeholder="10" onCommit={(v) => save({ step_y: v })} />
      </div>
      <h3>Where and how far</h3>
      <div className="field-row">
        <label className="field">
          Starts from
          <select value={settings.origin} onChange={(e) => save({ origin: e.target.value })}>
            {snapshot.systems.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Its culture
          <select value={settings.originCulture} onChange={(e) => save({ originCulture: e.target.value })}>
            {snapshot.cultures.map((x) => (
              <option key={x.id} value={x.id}>
                {String(x.value?.name ?? x.id)}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Slow ships reach, ly"
          value={settings.slow.reach_ly}
          onCommit={(v) => v && v > 0 && save({ slow: { ...settings.slow, reach_ly: v } })}
        />
        <NumberField
          label="Slow-ship colonies"
          value={settings.slow.colonies}
          onCommit={(v) => v !== undefined && v >= 0 && save({ slow: { ...settings.slow, colonies: Math.round(v) } })}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Systems by the end"
          value={settings.growth.systems}
          onCommit={(v) => v && v >= 1 && save({ growth: { ...settings.growth, systems: Math.round(Math.min(5000, v)) } })}
          id="histSystems"
        />
        <NumberField
          label="Farthest from the start, ly"
          value={settings.growth.maxRadius_ly}
          onCommit={(v) => v && v > 0 && save({ growth: { ...settings.growth, maxRadius_ly: v } })}
        />
        <NumberField
          label="Legs out a system reaches"
          value={settings.growth.legs}
          optional
          placeholder="2"
          onCommit={(v) =>
            save({ growth: { ...settings.growth, legs: v === undefined ? undefined : Math.max(1, Math.min(4, Math.round(v))) } })
          }
        />
        <NumberField
          label="Outward push, ly (higher is gentler)"
          value={settings.growth.outward_ly}
          optional
          placeholder="7"
          onCommit={(v) => save({ growth: { ...settings.growth, outward_ly: v && v > 0 ? v : undefined } })}
        />
      </div>
      <h3>Cultures</h3>
      <div className="field-row">
        <NumberField
          label="Enclave chance"
          value={settings.culture.enclaveRate}
          onCommit={(v) => v !== undefined && save({ culture: { ...settings.culture, enclaveRate: Math.max(0, Math.min(1, v)) } })}
        />
        <NumberField
          label="Branching chance"
          value={settings.culture.splitRate}
          onCommit={(v) => v !== undefined && save({ culture: { ...settings.culture, splitRate: Math.max(0, Math.min(1, v)) } })}
        />
        <NumberField
          label="Branches beyond, ly"
          value={settings.culture.splitDistance_ly}
          onCommit={(v) => v !== undefined && v >= 0 && save({ culture: { ...settings.culture, splitDistance_ly: v } })}
        />
        <NumberField
          label="Blending per step"
          value={settings.culture.blendRate}
          onCommit={(v) => v !== undefined && save({ culture: { ...settings.culture, blendRate: Math.max(0, Math.min(1, v)) } })}
        />
      </div>
      <p className="muted small">Belief cultures that found enclaves, each from an event:</p>
      <table className="units">
        <tbody>
          {(settings.enclaves ?? []).map((e, k) => (
            <tr key={k}>
              <td>{name(snapshot.cultures, e.culture)}</td>
              <td>
                {evSelect(
                  e.from,
                  (v) =>
                    save({
                      enclaves: (settings.enclaves ?? []).map((x, j) => (j === k ? { culture: x.culture, from: v || undefined } : x))
                    }),
                  true
                )}
              </td>
              <td>
                <button onClick={() => save({ enclaves: (settings.enclaves ?? []).filter((_, j) => j !== k) })}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <select
        value=""
        onChange={(e) => e.target.value && save({ enclaves: [...(settings.enclaves ?? []), { culture: e.target.value }] })}
        aria-label="Add an enclave culture"
      >
        <option value="">Add an enclave culture…</option>
        {snapshot.cultures
          .filter((c) => !(settings.enclaves ?? []).some((e) => e.culture === c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {String(c.value?.name ?? c.id)}
            </option>
          ))}
      </select>

      <h3>Polities</h3>
      {!polities ? (
        <button onClick={() => events[0] && save({ polities: { from: events[0].id, list: [] } })} disabled={!snapshot.polities.length}>
          Draw polity borders in the run
        </button>
      ) : (
        <>
          <label className="field">They take shape at {evSelect(polities.from, (v) => save({ polities: { ...polities, from: v } }))}</label>
          <table className="units">
            <thead>
              <tr>
                <th>Polity</th>
                <th>Share of systems</th>
                <th>Unifies its culture, per decade</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {polities.list.map((p, k) => {
                const set = (patch: Partial<(typeof polities.list)[number]>): void =>
                  save({ polities: { ...polities, list: polities.list.map((x, j) => (j === k ? { ...x, ...patch } : x)) } })
                return (
                  <tr key={p.polity}>
                    <td>{name(snapshot.polities, p.polity)}</td>
                    <td>
                      <NumberField
                        label=""
                        value={p.share}
                        onCommit={(v) => v !== undefined && set({ share: Math.max(0, Math.min(1, v)) })}
                      />
                    </td>
                    <td>
                      <NumberField
                        label=""
                        value={p.unify}
                        optional
                        placeholder="0"
                        onCommit={(v) => set({ unify: v === undefined ? undefined : Math.max(0, Math.min(1, v)) })}
                      />
                    </td>
                    <td>
                      <button onClick={() => save({ polities: { ...polities, list: polities.list.filter((_, j) => j !== k) } })}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <select
            value=""
            onChange={(e) =>
              e.target.value && save({ polities: { ...polities, list: [...polities.list, { polity: e.target.value, share: 0.2 }] } })
            }
            aria-label="Add a polity"
          >
            <option value="">Add a polity…</option>
            {snapshot.polities
              .filter((p) => !polities.list.some((x) => x.polity === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {String(p.value?.name ?? p.id)}
                </option>
              ))}
          </select>{' '}
          <button className="link" onClick={() => save({ polities: undefined })}>
            No polities in the run
          </button>
          <p className="muted small">A polity with a capital keeps it; the run chooses capitals for the rest, spread apart.</p>
        </>
      )}
    </div>
  )
}

// ---- run ----

function Run({
  snapshot,
  settings,
  worldSeed,
  displayCal
}: {
  snapshot: WorldSnapshot
  settings: Settings
  worldSeed: number
  displayCal: string | null
}): React.JSX.Element {
  const [seed, setSeed] = useState<number>(settings.seed ?? worldSeed)
  const [proposal, setProposal] = useState<HistoryProposalDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>('system')
  const [note, setNote] = useState<string | null>(null)

  const run = async (s: number): Promise<void> => {
    setBusy(true)
    setError(null)
    setNote(null)
    const p = await window.malevo.history.propose(s)
    setBusy(false)
    if ('error' in p) {
      setError(p.error)
      setProposal(null)
      return
    }
    setProposal(p)
    setChosen(new Set(p.files.map((f) => f.key)))
  }
  const accept = async (): Promise<void> => {
    if (!proposal) return
    try {
      const n = await window.malevo.history.accept([...chosen])
      setNote(`Accepted ${n} file${n === 1 ? '' : 's'}: unsaved, and undoable. They are fixed points for the next run.`)
      setProposal(null)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }
  const toggle = (keys: string[], on: boolean): void => {
    const next = new Set(chosen)
    for (const k of keys) {
      if (on) next.add(k)
      else next.delete(k)
    }
    setChosen(next)
  }
  const years = useMemo(
    () => (proposal ? proposal.files.map((f) => ({ t: (f.year ?? 0) * JULIAN_YEAR, precision: 'year' })) : []),
    [proposal]
  )
  const dates = useFormatted(displayCal, years, snapshot.version)

  return (
    <div className="history-run">
      <div className="history-left">
        <div className="field-row">
          <NumberField
            label="Seed"
            value={seed}
            onCommit={(v) => v !== undefined && setSeed(Math.trunc(Math.abs(v)) >>> 0)}
            id="historySeed"
          />
          <div className="inspector-actions">
            <button className="primary" onClick={() => void run(seed)} disabled={busy} id="historyRun">
              {busy ? 'Running…' : 'Run'}
            </button>
            <button
              onClick={() => {
                const s = (seed + 1) >>> 0
                setSeed(s)
                void run(s)
              }}
              disabled={busy}
            >
              Re-roll
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {note && <p className="ok">{note}</p>}
        {!proposal && !error && (
          <p className="muted small">
            A run proposes; nothing changes until you accept. Systems that already exist are kept: dated ones are settled when their history
            says, undated ones are places the run should reach. A run takes a second or two.
          </p>
        )}
        {proposal && (
          <>
            <p id="historySummary">
              Seed {proposal.seed}: {proposal.counts.systems} systems, {proposal.counts.cultures} cultures, {proposal.counts.routes} routes,{' '}
              {proposal.counts.events} events.
            </p>
            {proposal.conflicts.length > 0 && (
              <div className="history-conflicts" id="historyConflicts">
                <h3>What it could not honour</h3>
                <ul>
                  {proposal.conflicts.map((c, k) => (
                    <li key={k} className="warning">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Object.keys(proposal.shares).length > 0 && (
              <p className="muted small">
                Shares:{' '}
                {Object.entries(proposal.shares)
                  .map(([k, v]) => `${name(snapshot.polities, k)} ${sig(v.actual * 100, 2)}% (asked ${sig(v.target * 100, 2)}%)`)
                  .join(' · ')}
              </p>
            )}
            {GROUPS.map(({ group, title }) => {
              const files = proposal.files.filter((f) => f.group === group)
              if (!files.length) return null
              const on = files.filter((f) => chosen.has(f.key)).length
              return (
                <div key={group} className="proposal-group" data-group={group}>
                  <div className="proposal-head">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={on === files.length}
                        ref={(el) => {
                          if (el) el.indeterminate = on > 0 && on < files.length
                        }}
                        onChange={(e) =>
                          toggle(
                            files.map((f) => f.key),
                            e.target.checked
                          )
                        }
                      />
                      {title}
                    </label>
                    <span className="muted small">
                      {on} of {files.length}
                    </span>
                    <button className="link" onClick={() => setOpen(open === group ? null : group)}>
                      {open === group ? 'hide' : 'show'}
                    </button>
                  </div>
                  {open === group && (
                    <ul className="proposal-list">
                      {files.map((f) => (
                        <li key={f.key}>
                          <label className="check">
                            <input type="checkbox" checked={chosen.has(f.key)} onChange={(e) => toggle([f.key], e.target.checked)} />
                            <span>
                              {f.label}
                              {f.change && <span className="muted small"> (changes {f.path})</span>}
                            </span>
                          </label>
                          <span className="muted small">{f.year !== null ? dates[proposal.files.indexOf(f)] : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
            <div className="inspector-actions">
              <button className="primary" onClick={() => void accept()} disabled={!chosen.size} id="historyAccept">
                Accept {chosen.size} selected
              </button>
              <button onClick={() => setProposal(null)}>Discard the run</button>
            </div>
            <p className="muted small">
              To compare runs side by side, fork the world (Fork &amp; compare), accept a run in the fork, and compare.
            </p>
          </>
        )}
      </div>
      <div className="history-map map-pane">
        <ProposalMap snapshot={snapshot} proposal={proposal} chosen={chosen} />
      </div>
    </div>
  )
}

function ProposalMap({
  snapshot,
  proposal,
  chosen
}: {
  snapshot: WorldSnapshot
  proposal: HistoryProposalDto | null
  chosen: Set<string>
}): React.JSX.Element {
  const systems: MapSystem[] = useMemo(() => {
    const polColor = (id: unknown): string | undefined =>
      typeof id === 'string' ? String(snapshot.polities.find((p) => p.id === id)?.value?.color ?? '') || undefined : undefined
    const out: MapSystem[] = snapshot.systems.filter((s) => s.star).map((s) => ({ id: s.id, name: s.name, pos: s.star!.pos }))
    if (proposal)
      for (const f of proposal.files) {
        if (f.group !== 'system' || f.change || !chosen.has(f.key)) continue
        const p = proposal.positions[f.stars[0]]
        const hist = (f.value.history as { polity?: string }[] | undefined) ?? []
        if (p) out.push({ id: f.id, name: '', pos: p, color: polColor(hist[hist.length - 1]?.polity) ?? '#9aa4b2' })
      }
    return out
  }, [snapshot, proposal, chosen])
  const routes: MapRoute[] = useMemo(
    () =>
      proposal
        ? proposal.files
            .filter((f) => f.group === 'route' && chosen.has(f.key))
            .map((f) => ({ id: f.id, color: '#6fd0a0', points: f.stars.map((s) => proposal.positions[s]).filter(Boolean) }))
        : [],
    [proposal, chosen]
  )
  const focus = useMemo<[number, number, number]>(
    () => (proposal ? (proposal.positions[proposal.origin] ?? [0, 0, 0]) : [0, 0, 0]),
    [proposal]
  )
  return <StarMap field={null} focus={focus} systems={systems} selected={null} onPick={() => {}} reach={null} routes={routes} />
}

// ---- news ----

function News({
  snapshot,
  displayCal,
  setNow
}: {
  snapshot: WorldSnapshot
  displayCal: string | null
  setNow(t: number): void
}): React.JSX.Element {
  const placed = snapshot.events.filter((e) => e.value?.where)
  const [eventId, setEventId] = useState<string>(placed[0]?.id ?? '')
  const [news, setNews] = useState<NewsDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = useMemo(() => (news ? news.arrivals.map((a) => ({ t: a.t, precision: 'day' })) : []), [news])
  const dates = useFormatted(displayCal, items, snapshot.version)
  const look = async (id: string): Promise<void> => {
    setEventId(id)
    const n = id ? await window.malevo.history.news(id) : null
    if (n && 'error' in n) {
      setError(n.error)
      setNews(null)
    } else {
      setError(null)
      setNews(n)
    }
  }
  const sysName = (id: string): string => snapshot.systems.find((s) => s.id === id)?.name ?? id
  const after = (dt: number): string =>
    dt < 2 * 86400 ? `${sig(dt / 3600, 3)} h` : dt < 2 * JULIAN_YEAR ? `${sig(dt / 86400, 3)} d` : `${sig(dt / JULIAN_YEAR, 3)} yr`
  return (
    <div className="history-news" id="historyNews">
      <p className="muted small">
        When each system heard of an event: by radio at the speed of light, or by ship over the routes open at the time once the foam drive
        exists, whichever is first. Give an event a place (its “Where”, in the Timeline) to see it here.
      </p>
      <label className="field">
        Event
        <select value={eventId} onChange={(e) => void look(e.target.value)} id="newsEvent">
          <option value="">{placed.length ? 'Choose an event…' : 'No events have a place yet'}</option>
          {placed.map((e) => (
            <option key={e.id} value={e.id}>
              {e.value!.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {news && (
        <table className="units" id="newsTable">
          <thead>
            <tr>
              <th>System</th>
              <th>Heard</th>
              <th>After</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            {news.arrivals.map((a, k) => (
              <tr key={a.system} data-news={a.via}>
                <td>{sysName(a.system)}</td>
                <td>
                  <button className="link" onClick={() => setNow(a.t)}>
                    {dates[k] ?? '…'}
                  </button>
                </td>
                <td>{a.via === 'here' ? '—' : after(a.t - news.t0)}</td>
                <td className="muted small">
                  {a.via === 'here'
                    ? 'where it happened'
                    : a.via === 'radio'
                      ? 'radio'
                      : `by ship via ${a.path.slice(1, -1).map(sysName).join(', ') || 'one leg'}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export const historyTool: ToolDefinition = {
  id: 'history',
  title: 'History',
  description: 'Play settlement out on the stars, gated by the timeline; accept what you want; see when news reached each system',
  View: HistoryView
}
