import { territoryLegend, CONTESTED_COLOUR, type ColourBy, type Territory } from './territory'

/** What the star map is coloured by, and a key to the colours. */
export function MapColour({
  value,
  onChange,
  territory,
  choices = true
}: {
  value: ColourBy
  onChange(v: ColourBy): void
  territory: Territory | null
  /** Offer the choice of colouring (off: just the key). */
  choices?: boolean
}): React.JSX.Element {
  const legend = territory ? territoryLegend(territory.holders) : []
  return (
    <div className="map-colour">
      {choices && (
        <div className="seg" role="group" aria-label="Colour the stars by">
          {(
            [
              ['type', 'Star type'],
              ['culture', 'Culture'],
              ['polity', 'Polity']
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)} id={`colourBy-${k}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {territory && (
        <ul className="map-legend small" id="mapLegend">
          {legend.slice(0, 12).map((g) => (
            <li key={g.key}>
              <span className="swatch" style={{ background: g.color }} />
              {g.name} <span className="muted">{g.systems}</span>
            </li>
          ))}
          {legend.length > 12 && <li className="muted">and {legend.length - 12} more</li>}
          {territory.mode === 'polity' && legend.length > 1 && (
            <li>
              <span className="swatch" style={{ background: CONTESTED_COLOUR }} />
              contested
            </li>
          )}
          {!legend.length && <li className="muted">No system holds a {territory.mode} at this date.</li>}
        </ul>
      )}
    </div>
  )
}
