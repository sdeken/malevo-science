import { useEffect, useMemo, useState } from 'react'
import { placeholderNames, runGenerator } from '@malevo/gen'
import type { StarField, StarInfoDto, StarSearchHit } from '../../../../shared/types'
import { duration, sig } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { StarMap, type MapSystem } from './StarMap'

const SOL = 'hyg.0'

function StarsView({ world, snapshot, focus: navFocus, navigate }: ToolProps): React.JSX.Element {
  const systems = snapshot.systems
  const [focusId, setFocusId] = useWorldPref<string>(world.root, 'starsFocus', systems[0]?.starId ?? SOL)
  const [radius, setRadius] = useWorldPref<number>(world.root, 'starsRadius', 20)
  const [showGenerated, setShowGenerated] = useWorldPref<boolean>(world.root, 'starsGenerated', true)
  const [focusStar, setFocusStar] = useState<StarInfoDto | null>(null)
  const [field, setField] = useState<StarField | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [selectedStar, setSelectedStar] = useState<StarInfoDto | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StarSearchHit[]>([])
  const [moving, setMoving] = useState('')
  /** A star to select once the field around it has loaded (from a search result). */
  const [, setPendingSelect] = useState<string | null>(null)

  // Another tool can point this one at a system's star.
  useEffect(() => {
    if (!navFocus) return
    const sys = systems.find((s) => s.id === navFocus)
    if (sys) setFocusId(sys.starId)
  }, [navFocus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true
    void window.malevo.stars.get(focusId).then((s) => {
      if (!live) return
      if (s) setFocusStar(s)
      else if (focusId !== SOL) setFocusId(SOL)
    })
    return () => {
      live = false
    }
  }, [focusId, setFocusId, snapshot.version])

  const center = useMemo<[number, number, number]>(() => focusStar?.pos ?? [0, 0, 0], [focusStar])
  useEffect(() => {
    let live = true
    void window.malevo.stars.near(center, radius, showGenerated).then((f) => {
      if (!live) return
      setField(f)
      setSelected(null)
      setPendingSelect((want) => {
        if (want) {
          const i = f.ids.indexOf(want)
          if (i >= 0) setSelected(i)
        }
        return null
      })
    })
    return () => {
      live = false
    }
  }, [center, radius, showGenerated, snapshot.version])

  const selectedId = field && selected !== null ? field.ids[selected] : null
  useEffect(() => {
    if (!selectedId) {
      setSelectedStar(null)
      return
    }
    void window.malevo.stars.get(selectedId).then(setSelectedStar)
  }, [selectedId])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    const h = setTimeout(() => void window.malevo.stars.search(q).then(setHits), 150)
    return () => clearTimeout(h)
  }, [query])

  const mapSystems: MapSystem[] = useMemo(
    () => systems.filter((s) => s.star).map((s) => ({ id: s.id, name: s.name, pos: s.star!.pos })),
    [systems]
  )
  const onStar = (id: string): string[] => systems.filter((s) => s.starId === id).map((s) => s.id)
  const dist = (a: StarInfoDto | null, b: StarInfoDto | null): number | null =>
    a && b ? Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) : null
  const legLimit = snapshot.physics?.legLimit_ly ?? null

  const createSystem = async (star: StarInfoDto): Promise<void> => {
    const name = star.name ?? runGenerator(placeholderNames, { ids: [star.id], palette: 0 }, world.seed)[star.id]
    const id = slugId(
      name,
      systems.map((s) => s.id)
    )
    await window.malevo.world.setEntity('system', id, { name, star: star.id })
    navigate('systems', id)
  }

  const moveSystem = async (sysId: string, star: StarInfoDto): Promise<void> => {
    const sys = systems.find((s) => s.id === sysId)
    if (!sys) return
    await window.malevo.world.setEntity('system', sysId, { ...sys.value, star: star.id })
    setMoving('')
  }

  const d = dist(focusStar, selectedStar)

  return (
    <div className="split-tool">
      <nav className="split-list stars-side">
        <h2>Stars</h2>
        <input
          className="search"
          placeholder="Find a star or system…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          id="starSearch"
        />
        {hits.length > 0 && (
          <ul className="hits">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  className="list-item"
                  onClick={() => {
                    setPendingSelect(h.id)
                    if (h.id === focusId) {
                      const i = field?.ids.indexOf(h.id) ?? -1
                      if (i >= 0) setSelected(i)
                    }
                    setFocusId(h.id)
                    setQuery('')
                  }}
                  data-hit={h.id}
                >
                  <span>{h.name}</span>
                  <span className="muted small">
                    {h.system ? 'system · ' : ''}
                    {sig(h.distance, 3)} ly from Sol
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Centred on <strong>{focusStar?.name ?? focusStar?.id ?? '…'}</strong>
          {focusStar && focusStar.id !== SOL && <> · {sig(Math.hypot(...focusStar.pos), 3)} ly from Sol</>}
        </p>
        <label className="field">
          Show stars within {radius} ly
          <input type="range" min={5} max={150} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </label>
        <label className="check small">
          <input type="checkbox" checked={showGenerated} onChange={(e) => setShowGenerated(e.target.checked)} />
          Include generated faint stars
        </label>
        <p className="muted small">{field ? `${field.ids.length.toLocaleString()} stars` : 'Loading…'}</p>

        <h3>Systems</h3>
        {systems.length === 0 && <p className="muted small">None yet. Pick a star and make one.</p>}
        <ul>
          {systems.map((s) => (
            <li key={s.id}>
              <button
                className={s.starId === focusId ? 'list-item is-current' : 'list-item'}
                onClick={() => setFocusId(s.starId)}
                data-system={s.id}
              >
                <span>{s.name}</span>
                <span className={s.starError ? 'error small' : 'muted small'}>
                  {s.starError ? 'star missing' : (s.star?.name ?? s.starId)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selectedStar && (
          <div className="star-card" data-star={selectedStar.id}>
            <h3>{selectedStar.name ?? 'Unnamed star'}</h3>
            <p className="muted small">
              <code>{selectedStar.id}</code>
              {selectedStar.generated && ' · generated'}
            </p>
            <dl className="facts compact">
              <dt>Type</dt>
              <dd>{selectedStar.spect || '—'}</dd>
              <dt>From Sol</dt>
              <dd>{sig(Math.hypot(...selectedStar.pos), 4)} ly</dd>
              {d !== null && focusStar && focusStar.id !== selectedStar.id && (
                <>
                  <dt>From {focusStar.name ?? 'the centre'}</dt>
                  <dd>
                    {sig(d, 4)} ly
                    {legLimit !== null && (
                      <span className={d <= legLimit ? 'ok' : 'warning'}>
                        {' '}
                        · {d <= legLimit ? 'one leg' : `${Math.ceil(d / legLimit)} legs at least`}
                      </span>
                    )}
                    {snapshot.physics && (
                      <span className="muted"> · {duration((d * 31_557_600) / snapshot.physics.topSpeed_c)} in the foam</span>
                    )}
                  </dd>
                </>
              )}
              <dt>Temperature</dt>
              <dd>{sig(selectedStar.teff, 4)} K</dd>
              <dt>Luminosity</dt>
              <dd>{sig(selectedStar.luminosity, 3)} L☉</dd>
              <dt>Mass</dt>
              <dd>{selectedStar.mass === null ? 'unknown (not main sequence)' : `${sig(selectedStar.mass, 3)} M☉`}</dd>
              <dt>Radius</dt>
              <dd>{sig(selectedStar.radius, 3)} R☉</dd>
            </dl>
            <div className="inspector-actions wrap">
              {selectedStar.id !== focusId && <button onClick={() => setFocusId(selectedStar.id)}>Centre here</button>}
              {onStar(selectedStar.id).map((id) => (
                <button key={id} onClick={() => navigate('systems', id)}>
                  Open {systems.find((s) => s.id === id)?.name}
                </button>
              ))}
              {onStar(selectedStar.id).length === 0 && (
                <button className="primary" onClick={() => void createSystem(selectedStar)} id="newSystemHere">
                  New system here
                </button>
              )}
            </div>
            {systems.length > 0 && onStar(selectedStar.id).length === 0 && (
              <div className="field-row">
                <select value={moving} onChange={(e) => setMoving(e.target.value)} aria-label="System to move">
                  <option value="">Move a system here…</option>
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button disabled={!moving} onClick={() => void moveSystem(moving, selectedStar)}>
                  Move
                </button>
              </div>
            )}
          </div>
        )}
      </nav>
      <div className="split-detail map-pane">
        <StarMap field={field} focus={center} systems={mapSystems} selected={selected} onPick={setSelected} reach={legLimit} />
        <p className="map-hint muted small">
          Drag to turn, wheel to zoom, right-drag to pan, click a star to pick it. The blue sphere is one leg.
        </p>
      </div>
    </div>
  )
}

export const starsTool: ToolDefinition = {
  id: 'stars',
  title: 'Stars',
  description: 'The real and generated stars, in 3D; put systems on them',
  View: StarsView
}
