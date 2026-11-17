import { useEffect, useState } from 'react'
import type { StarSearchHit, SystemInfoDto } from '../../../../shared/types'

type Placement = 'detached' | 'stand-in' | 'placed'

/**
 * Where a system is: detached (its own star by type, no place among the stars yet), on a stand-in star (a
 * provisional place, for its sky and distances), or placed on a star for good. A stand-in or a placement can
 * be any star: a real one, or a generated one.
 */
export function StarPlacement({ system, save }: { system: SystemInfoDto; save(patch: Record<string, unknown>): void }): React.JSX.Element {
  const v = system.value as { star?: string; provisional?: boolean; spect?: string }
  const placement: Placement = !v.star ? 'detached' : v.provisional ? 'stand-in' : 'placed'
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StarSearchHit[]>([])
  const [spect, setSpect] = useState(v.spect ?? '')
  useEffect(() => setSpect(v.spect ?? ''), [v.spect])
  useEffect(() => {
    const q = query.trim()
    if (!q) return setHits([])
    const h = setTimeout(() => void window.malevo.stars.search(q).then(setHits), 150)
    return () => clearTimeout(h)
  }, [query])

  const setPlacement = (p: Placement): void => {
    if (p === 'detached') save({ star: undefined, provisional: undefined, spect: v.spect ?? guessType(system) })
    else if (!v.star) setQuery(' ')
    else save({ provisional: p === 'stand-in' ? true : undefined })
  }
  const place = (id: string): void => {
    save({ star: id, provisional: placement === 'placed' ? undefined : true })
    setQuery('')
    setHits([])
  }
  /** A generated star near where it is now (or near Sol): a believable spot nobody has charted. */
  const randomGenerated = async (): Promise<void> => {
    const center = system.star && system.placement !== 'detached' ? system.star.pos : ([0, 0, 0] as [number, number, number])
    const field = await window.malevo.stars.near(center, 40, true)
    const ids = field.ids.filter((_, i) => field.generated[i] && field.ids[i] !== v.star)
    if (!ids.length) return
    place(ids[Math.floor(Math.random() * ids.length)])
  }
  const commitSpect = (): void => {
    const s = spect.trim()
    if (s === (v.spect ?? '')) return
    if (!s && placement === 'detached') return setSpect(v.spect ?? '')
    save({ spect: s || undefined })
  }
  return (
    <details className="overrides star-placement" open={placement !== 'placed'} id="starPlacement">
      <summary>
        Where it is:{' '}
        {placement === 'detached'
          ? 'detached, not placed among the stars'
          : placement === 'stand-in'
            ? 'on a stand-in star (provisional)'
            : 'placed on its star'}
      </summary>
      <div className="seg" role="group" aria-label="Where it is">
        {(
          [
            ['detached', 'Detached'],
            ['stand-in', 'On a stand-in'],
            ['placed', 'Placed']
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={placement === k ? 'on' : ''} onClick={() => setPlacement(k)} id={`placement-${k}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {placement === 'detached'
          ? 'Its star is described by type alone. Orbits, years, days, sunlight and temperatures all work; its sky shows only its own sun, planets and moons, and it has no distances to other stars until it is placed.'
          : placement === 'stand-in'
            ? 'It borrows this star’s place for its sky and its distances, for now; swap it for another any time. Its own star is still the one described by its type, if it has one.'
            : 'It is on this star for good: the star’s place, and (unless a type is given) its brightness and mass.'}
      </p>
      <div className="field-row">
        <label className="field">
          Its own star’s type
          <input
            value={spect}
            onChange={(e) => setSpect(e.target.value.toUpperCase().replace(/V$/, 'V'))}
            onBlur={commitSpect}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder={placement === 'detached' ? 'G2V' : 'the star’s own'}
            id="systemSpect"
          />
          <span className="muted small">Main sequence: G2V is the Sun; K1V, M4.5V…</span>
        </label>
        {placement !== 'detached' && (
          <span className="small">
            On <strong>{system.star?.name ?? v.star}</strong> <code className="muted">{v.star}</code>
          </span>
        )}
      </div>
      {(placement !== 'detached' || query) && (
        <div className="field-row">
          <input
            type="search"
            value={query.trim() ? query : ''}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={v.star ? 'Move it to another star…' : 'Find a star: a name, hip.…, or g.…'}
            aria-label="Find a star"
            id="placementSearch"
            autoFocus={query === ' '}
          />
          <button
            onClick={() => void randomGenerated()}
            id="placementRandom"
            title="A generated star within 40 ly of where it is now (or of Sol)"
          >
            A random generated star nearby
          </button>
        </div>
      )}
      {hits.length > 0 && (
        <ul className="placement-hits">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id}>
              <button className="link" onClick={() => place(h.id)} data-place={h.id}>
                {h.name ?? h.id}
              </button>{' '}
              <span className="muted small">
                {h.id} · {h.distance.toFixed(1)} ly from Sol{h.system ? ` · ${h.system} is there` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/** A type to start a detached system with: its current star's, if that reads as one, else the Sun's. */
function guessType(system: SystemInfoDto): string {
  const s = system.star?.spect?.trim() ?? ''
  const m = /^([OBAFGKM]\d(?:\.\d)?)/.exec(s)
  return m ? `${m[1]}V` : 'G2V'
}
