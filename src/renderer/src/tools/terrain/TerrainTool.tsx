import { useEffect, useMemo, useRef, useState } from 'react'
import type { BodyInfoDto, EntityDto, TerrainRasterDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, sig } from '../../components/fields'
import { newClouds, withClouds } from '@malevo/model'
import { useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

type ShapeKind = 'land' | 'sea' | 'raise' | 'lower' | 'ridge'
interface Shape {
  kind: ShapeKind
  points: [number, number][]
  height_km?: number
  width_deg?: number
  note?: string
}
interface TerrainValue {
  body: string
  roll: number
  params?: { plates: number; continents: number; ocean: number; mountains_km: number; roughness: number }
  bands?: { bands: number; contrast: number; turbulence: number; storms: number; palette: string[] }
  clouds?: { cover: number; cells: number; turbulence: number; storms: number; colour?: string }
  climate?: { greenhouse_K?: number; heatTransport?: number; temperature_K?: number; water?: boolean; rock?: string }
  shapes?: Shape[]
  lock?: { gen: string; seed?: number; inputs: Record<string, string> }
}

const SURFACE = ['rocky', 'ocean', 'dwarf', 'gas-giant', 'ice-giant']
const GIANT = ['gas-giant', 'ice-giant']
const DEFAULT_BANDS: Record<string, NonNullable<TerrainValue['bands']>> = {
  'gas-giant': { bands: 14, contrast: 0.6, turbulence: 0.45, storms: 3, palette: ['#e9dcc0', '#c79a68', '#f2ead8', '#a87650', '#d8bf98'] },
  'ice-giant': { bands: 8, contrast: 0.25, turbulence: 0.3, storms: 1, palette: ['#a8d8e4', '#8cc4d6', '#c2e6ee', '#7fb4cc'] }
}
const MAP_W = 512
const MAP_H = 256
const SHAPE_HELP: Record<ShapeKind, string> = {
  land: 'Click the corners of an area that must be land; double-click to finish.',
  sea: 'Click the corners of an area that must be sea; double-click to finish.',
  raise: 'Click the corners of an area to raise; double-click to finish.',
  lower: 'Click the corners of an area to lower; double-click to finish.',
  ridge: 'Click along a mountain ridge; double-click to finish.'
}
const SHAPE_COLOUR: Record<ShapeKind, string> = { land: '#e0a43c', sea: '#4f8fe0', raise: '#d9604f', lower: '#7f8cff', ridge: '#ffffff' }

function TerrainView({ world, snapshot, focus }: ToolProps): React.JSX.Element {
  const bodies = snapshot.systems.flatMap((s) => s.bodies.filter((b) => SURFACE.includes(b.cls)).map((b) => ({ ...b, systemName: s.name })))
  const [pref, setPref] = useWorldPref<string | null>(world.root, 'terrainBody', null)
  const selected = bodies.find((b) => b.id === (focus ?? pref)) ?? bodies.find((b) => b.id === 'earth') ?? bodies[0] ?? null
  const terrainOf = (id: string): EntityDto | undefined => snapshot.terrains.find((t) => t.value?.body === id)

  if (!bodies.length)
    return (
      <div className="tool-page">
        <h1>Terrain</h1>
        <p>Terrain is for bodies with a solid surface: rocky worlds, ocean worlds and dwarf planets. There are none yet.</p>
      </div>
    )

  return (
    <div className="split-tool">
      <nav className="split-list">
        <h2>Terrain</h2>
        <ul>
          {bodies.map((b) => (
            <li key={b.id}>
              <button
                className={b.id === selected?.id ? 'list-item is-current' : 'list-item'}
                onClick={() => setPref(b.id)}
                data-terrain-body={b.id}
              >
                <span>
                  {'  '.repeat(b.depth)}
                  {b.name}
                </span>
                <span className="muted small">
                  {b.systemName}
                  {terrainOf(b.id) ? ' · terrain' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="split-detail">
        {selected && <TerrainDetail key={selected.id} body={selected} entity={terrainOf(selected.id) ?? null} snapshot={snapshot} />}
      </div>
    </div>
  )
}

function TerrainDetail({
  body,
  entity,
  snapshot
}: {
  body: BodyInfoDto
  entity: EntityDto | null
  snapshot: WorldSnapshot
}): React.JSX.Element {
  const v = entity?.value as unknown as TerrainValue | null
  const [raster, setRaster] = useState<TerrainRasterDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drawState, setDrawing] = useState<{ kind: ShapeKind; points: [number, number][] } | null>(null)
  const drawing = drawState
  const [note, setNote] = useState<string | null>(null)
  const [showClouds, setShowClouds] = useState(true)
  const id = entity?.id ?? body.id
  const shown = useMemo(
    () =>
      raster && showClouds && raster.clouds && raster.cloudColour
        ? { ...raster, rgba: withClouds(raster.rgba, raster.clouds, raster.cloudColour) }
        : raster,
    [raster, showClouds]
  )

  useEffect(() => {
    if (!v) {
      setRaster(null)
      return
    }
    let live = true
    setBusy(true)
    void window.malevo.terrain.raster(body.id, MAP_W, MAP_H).then((r) => {
      if (!live) return
      setBusy(false)
      if ('error' in r) {
        setError(r.error)
        setRaster(null)
      } else {
        setError(null)
        setRaster(r)
      }
    })
    return () => {
      live = false
    }
  }, [body.id, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: TerrainValue): void => void window.malevo.world.setEntity('terrain', id, next)
  const locked = Boolean(v?.lock)

  if (!v)
    return (
      <div className="tool-page">
        <h1>{body.name}</h1>
        <p>
          {GIANT.includes(body.cls)
            ? 'No cloud bands yet. A giant has no surface; its look is generated from a few settings and a roll: bands, streaks and storms.'
            : 'No terrain yet. A terrain is generated from a few parameters and a roll, then shaped by hand; nothing is stored as pixels.'}
        </p>
        <button
          className="primary"
          id="makeTerrain"
          onClick={() =>
            save(
              GIANT.includes(body.cls)
                ? { body: body.id, roll: 0, bands: { ...DEFAULT_BANDS[body.cls], palette: [...DEFAULT_BANDS[body.cls].palette] } }
                : {
                    body: body.id,
                    roll: 0,
                    params: {
                      plates: 12,
                      continents: 0.35,
                      ocean: body.cls === 'ocean' ? 0.75 : body.cls === 'dwarf' ? 0 : 0.5,
                      mountains_km: body.cls === 'dwarf' ? 3 : 6,
                      roughness: 0.5
                    }
                  }
            )
          }
        >
          Make terrain
        </button>
      </div>
    )

  const setParam = (k: keyof NonNullable<TerrainValue['params']>, x: number): void => save({ ...v, params: { ...v.params!, [k]: x } })
  const giant = Boolean(v.bands)
  const setClimate = (patch: Partial<NonNullable<TerrainValue['climate']>>): void => {
    const c = { ...v.climate, ...patch }
    for (const k of Object.keys(c) as (keyof typeof c)[]) if (c[k] === undefined) delete c[k]
    save({ ...v, climate: Object.keys(c).length ? c : undefined })
  }
  const shapes = v.shapes ?? []
  const finish = (): void => {
    let drawing = drawState
    if (!drawing) return
    // A double-click to finish also lands as clicks: drop points that repeat the one before.
    const points = drawing.points.filter((p, k, a) => k === 0 || Math.abs(p[0] - a[k - 1][0]) + Math.abs(p[1] - a[k - 1][1]) > 0.5)
    drawing = { ...drawing, points }
    const min = drawing.kind === 'ridge' ? 2 : 3
    if (drawing.points.length >= min)
      save({
        ...v,
        shapes: [
          ...shapes,
          {
            kind: drawing.kind,
            points: drawing.points,
            height_km: drawing.kind === 'raise' || drawing.kind === 'lower' ? 1.5 : drawing.kind === 'ridge' ? 3 : undefined,
            width_deg: drawing.kind === 'land' || drawing.kind === 'sea' ? undefined : 3
          }
        ]
      })
    setDrawing(null)
  }
  const exportMap = async (what: 'colour' | 'height' | 'clouds'): Promise<void> => {
    const p = await window.malevo.terrain.export(body.id, what)
    if (p) setNote(`Saved ${p}. Exports are for reference, outside the world.`)
  }
  const s = raster?.stats

  return (
    <div className="tool-page wide terrain" data-terrain={body.id}>
      <div className="field-row">
        <h1>{body.name}</h1>
        <div className="inspector-actions">
          <button
            onClick={() => save({ ...v, roll: v.roll + 1 })}
            disabled={locked}
            id="terrainReroll"
            title={locked ? 'Unlock to re-roll' : 'A new roll of terrain@1'}
          >
            Re-roll
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => {
                const next = { ...v }
                if (e.target.checked) next.lock = { gen: 'terrain@1', inputs: {} }
                else delete next.lock
                save(next)
              }}
              id="terrainLock"
            />
            Locked
          </label>
          <button onClick={() => void exportMap('colour')}>Export colour map…</button>
          <button onClick={() => void exportMap('height')}>Export height map…</button>
          {!giant && v.clouds && <button onClick={() => void exportMap('clouds')}>Export cloud map…</button>}
        </div>
      </div>
      <p className="muted small">
        Roll {v.roll} of terrain@1{locked ? ', locked: its seed, parameters and generator version are fixed' : ''}. Heights are worked out
        on the sphere, so every size of map reads the same. The colours follow {body.name}'s sunlight, tilt and air
        {v.climate?.temperature_K ? ' (fixed here at a set temperature)' : ', so moving it changes its look'}.
      </p>
      {note && <p className="ok small">{note}</p>}
      {error && <p className="error">{error}</p>}

      <div className="terrain-views">
        <TerrainMap raster={shown} shapes={shapes} drawing={drawing} setDrawing={setDrawing} finish={finish} busy={busy} />
        <Globe raster={shown} />
      </div>
      {!giant && v.clouds && (
        <label className="check">
          <input type="checkbox" checked={showClouds} onChange={(e) => setShowClouds(e.target.checked)} id="showClouds" />
          Show clouds
        </label>
      )}

      {s && giant && (
        <p className="muted small" id="terrainStats">
          Cloud tops of a giant: no surface to stand on.
        </p>
      )}
      {s && !giant && (
        <p className="muted small" id="terrainStats">
          {sig(s.ocean * 100, 3)}% under water · highest {sig(s.highest, 3)} km · deepest {sig(-s.lowest, 3)} km
          {s.meanTemp !== null && (
            <>
              {' '}
              · mean {sig(s.meanTemp - 273.15, 3)} °C (from {sig(s.minTemp! - 273.15, 3)} to {sig(s.maxTemp! - 273.15, 3)} °C)
            </>
          )}
        </p>
      )}

      {!giant && v.params && <CloudsEditor value={v.clouds} onChange={(c) => save({ ...v, clouds: c })} />}
      {giant && v.bands && <BandsEditor value={v.bands} locked={locked} onChange={(b) => save({ ...v, bands: b })} />}
      {!giant && v.params && (
        <>
          <h3>Shaping</h3>
          <div className="seg">
            {(['land', 'sea', 'raise', 'lower', 'ridge'] as const).map((k) => (
              <button
                key={k}
                className={drawing?.kind === k ? 'on' : ''}
                onClick={() => setDrawing(drawing?.kind === k ? null : { kind: k, points: [] })}
                data-shape={k}
              >
                {k === 'land' ? 'Land' : k === 'sea' ? 'Sea' : k === 'raise' ? 'Raise' : k === 'lower' ? 'Lower' : 'Ridge'}
              </button>
            ))}
          </div>
          {drawing && (
            <p className="small">
              {SHAPE_HELP[drawing.kind]}{' '}
              {drawing.points.length > 0 && (
                <button className="link" onClick={finish}>
                  Finish
                </button>
              )}{' '}
              <button className="link" onClick={() => setDrawing(null)}>
                Cancel
              </button>
            </p>
          )}
          {shapes.length > 0 && (
            <table className="units" id="terrainShapes">
              <tbody>
                {shapes.map((sh, k) => {
                  const set = (patch: Partial<Shape>): void =>
                    save({ ...v, shapes: shapes.map((x, j) => (j === k ? { ...x, ...patch } : x)) })
                  return (
                    <tr key={k}>
                      <td>
                        <span className="swatch" style={{ background: SHAPE_COLOUR[sh.kind] }} /> {sh.kind}, {sh.points.length} points
                      </td>
                      <td>
                        {(sh.kind === 'raise' || sh.kind === 'lower' || sh.kind === 'ridge') && (
                          <NumberField label="Height, km" value={sh.height_km} onCommit={(x) => x !== undefined && set({ height_km: x })} />
                        )}
                      </td>
                      <td>
                        {sh.kind !== 'land' && sh.kind !== 'sea' && (
                          <NumberField
                            label="Width, °"
                            value={sh.width_deg}
                            onCommit={(x) => x !== undefined && x > 0 && set({ width_deg: x })}
                          />
                        )}
                      </td>
                      <td>
                        <button onClick={() => save({ ...v, shapes: shapes.filter((_, j) => j !== k) })}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <h3>Generation</h3>
          <fieldset disabled={locked} className="plain">
            <div className="field-row">
              <NumberField
                label="Plates"
                value={v.params.plates}
                onCommit={(x) => x !== undefined && setParam('plates', Math.max(2, Math.min(60, Math.round(x))))}
              />
              <NumberField
                label="Continental share"
                value={v.params.continents}
                onCommit={(x) => x !== undefined && setParam('continents', Math.max(0, Math.min(1, x)))}
              />
              <NumberField
                label="Under water"
                value={v.params.ocean}
                hint="Share of the surface, 0–1"
                onCommit={(x) => x !== undefined && setParam('ocean', Math.max(0, Math.min(1, x)))}
                id="terrainOcean"
              />
              <NumberField
                label="Mountains, km"
                value={v.params.mountains_km}
                onCommit={(x) => x !== undefined && setParam('mountains_km', Math.max(0, Math.min(30, x)))}
              />
              <NumberField
                label="Roughness"
                value={v.params.roughness}
                onCommit={(x) => x !== undefined && setParam('roughness', Math.max(0, Math.min(1, x)))}
              />
            </div>
          </fieldset>
          {locked && <p className="muted small">Unlock to change the generation; shaping and climate stay editable.</p>}

          <h3>Climate</h3>
          <div className="field-row">
            <NumberField
              label="Greenhouse warming, K"
              value={v.climate?.greenhouse_K}
              optional
              placeholder="from the air"
              onCommit={(x) => setClimate({ greenhouse_K: x })}
            />
            <NumberField
              label="Heat transport, 0–1"
              value={v.climate?.heatTransport}
              optional
              placeholder="0.35 with air"
              onCommit={(x) => setClimate({ heatTransport: x === undefined ? undefined : Math.max(0, Math.min(1, x)) })}
            />
            <NumberField
              label="Fixed mean temperature, K"
              value={v.climate?.temperature_K}
              optional
              placeholder="follows the orbit"
              onCommit={(x) => setClimate({ temperature_K: x })}
            />
          </div>
          <div className="field-row">
            <label className="field">
              Surface water
              <select
                value={v.climate?.water === undefined ? '' : v.climate.water ? 'yes' : 'no'}
                onChange={(e) => setClimate({ water: e.target.value === '' ? undefined : e.target.value === 'yes' })}
                id="terrainWater"
              >
                <option value="">With half an atmosphere or more</option>
                <option value="yes">Yes: seas and ice</option>
                <option value="no">No: a dry world</option>
              </select>
            </label>
            <label className="field">
              Rock colour
              <input type="color" value={v.climate?.rock ?? '#80766c'} onChange={(e) => setClimate({ rock: e.target.value })} />
            </label>
            {v.climate?.rock && (
              <button className="link" onClick={() => setClimate({ rock: undefined })}>
                default rock
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function BandsEditor({
  value,
  locked,
  onChange
}: {
  value: NonNullable<TerrainValue['bands']>
  locked: boolean
  onChange(b: NonNullable<TerrainValue['bands']>): void
}): React.JSX.Element {
  const set = (patch: Partial<NonNullable<TerrainValue['bands']>>): void => onChange({ ...value, ...patch })
  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
  return (
    <fieldset disabled={locked} className="plain" id="bandsEditor">
      <h3>Cloud bands</h3>
      <div className="field-row">
        <NumberField
          label="Bands, pole to pole"
          value={value.bands}
          onCommit={(x) => x !== undefined && set({ bands: Math.max(1, Math.min(60, Math.round(x))) })}
        />
        <NumberField label="Contrast, 0–1" value={value.contrast} onCommit={(x) => x !== undefined && set({ contrast: clamp01(x) })} />
        <NumberField
          label="Turbulence, 0–1"
          value={value.turbulence}
          onCommit={(x) => x !== undefined && set({ turbulence: clamp01(x) })}
        />
        <NumberField
          label="Storms"
          value={value.storms}
          onCommit={(x) => x !== undefined && set({ storms: Math.max(0, Math.min(20, Math.round(x))) })}
        />
      </div>
      <div className="field-row palette">
        {value.palette.map((c, k) => (
          <span key={k} className="palette-chip">
            <input type="color" value={c} onChange={(e) => set({ palette: value.palette.map((x, j) => (j === k ? e.target.value : x)) })} />
            {value.palette.length > 2 && (
              <button className="link" title="Remove" onClick={() => set({ palette: value.palette.filter((_, j) => j !== k) })}>
                ✕
              </button>
            )}
          </span>
        ))}
        {value.palette.length < 8 && (
          <button onClick={() => set({ palette: [...value.palette, value.palette[value.palette.length - 1]] })}>Add a colour</button>
        )}
      </div>
      {locked && <p className="muted small">Unlock to change the bands.</p>}
    </fieldset>
  )
}

function CloudsEditor({
  value,
  onChange
}: {
  value: TerrainValue['clouds']
  onChange(c: TerrainValue['clouds']): void
}): React.JSX.Element {
  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
  if (!value)
    return (
      <div className="plain" id="cloudsEditor">
        <h3>Clouds</h3>
        <p className="muted small">
          An optional cloud layer (clouds@1): weather to make the world look lived-in, not a record of the sky at any moment. It is drawn
          over the map and globe and can be hidden.
        </p>
        <button onClick={() => onChange(newClouds())} id="addClouds">
          Add a cloud layer
        </button>
      </div>
    )
  const set = (patch: Partial<NonNullable<TerrainValue['clouds']>>): void => onChange({ ...value, ...patch })
  return (
    <div className="plain" id="cloudsEditor">
      <h3>Clouds</h3>
      <div className="field-row">
        <NumberField label="Cover, 0–1" value={value.cover} onCommit={(x) => x !== undefined && set({ cover: clamp01(x) })} />
        <NumberField
          label="Cells, equator to pole"
          value={value.cells}
          onCommit={(x) => x !== undefined && set({ cells: Math.max(1, Math.min(9, Math.round(x))) })}
        />
        <NumberField
          label="Turbulence, 0–1"
          value={value.turbulence}
          onCommit={(x) => x !== undefined && set({ turbulence: clamp01(x) })}
        />
        <NumberField
          label="Storms"
          value={value.storms}
          onCommit={(x) => x !== undefined && set({ storms: Math.max(0, Math.min(40, Math.round(x))) })}
        />
        <label className="field">
          Colour
          <input
            type="color"
            value={value.colour ?? '#ffffff'}
            onChange={(e) => set({ colour: e.target.value === '#ffffff' ? undefined : e.target.value })}
          />
        </label>
        <button className="danger" onClick={() => onChange(undefined)}>
          Remove clouds
        </button>
      </div>
      <p className="muted small">
        Earth has three circulation cells: cloudy at the equator and near 60°, clear near 30°. A slowly turning world has one. The cloud
        layer re-rolls with the terrain.
      </p>
    </div>
  )
}

function TerrainMap({
  raster,
  shapes,
  drawing,
  setDrawing,
  finish,
  busy
}: {
  raster: TerrainRasterDto | null
  shapes: Shape[]
  drawing: { kind: ShapeKind; points: [number, number][] } | null
  setDrawing(d: { kind: ShapeKind; points: [number, number][] } | null): void
  finish(): void
  busy: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    c.width = MAP_W
    c.height = MAP_H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#20242c'
    ctx.fillRect(0, 0, MAP_W, MAP_H)
    if (raster) ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba), raster.width, raster.height), 0, 0)
  }, [raster])
  const xy = (lat: number, lon: number): [number, number] => [((lon + 180) / 360) * MAP_W, ((90 - lat) / 180) * MAP_H]
  const toLatLon = (e: React.MouseEvent): [number, number] => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * MAP_W
    const y = ((e.clientY - r.top) / r.height) * MAP_H
    return [Math.round((90 - (y / MAP_H) * 180) * 100) / 100, Math.round(((x / MAP_W) * 360 - 180) * 100) / 100]
  }
  const pts = (p: [number, number][]): string => p.map(([a, b]) => xy(a, b).join(',')).join(' ')
  return (
    <div className="terrain-map" style={{ width: MAP_W, height: MAP_H }}>
      <canvas ref={ref} style={{ width: MAP_W, height: MAP_H }} id="terrainMap" />
      <svg
        width={MAP_W}
        height={MAP_H}
        className={drawing ? 'drawing' : ''}
        onClick={(e) => drawing && setDrawing({ ...drawing, points: [...drawing.points, toLatLon(e)] })}
        onDoubleClick={(e) => {
          e.preventDefault()
          finish()
        }}
      >
        {shapes.map((s, k) =>
          s.kind === 'ridge' ? (
            <polyline key={k} points={pts(s.points)} stroke={SHAPE_COLOUR[s.kind]} fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
          ) : (
            <polygon key={k} points={pts(s.points)} stroke={SHAPE_COLOUR[s.kind]} fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
          )
        )}
        {drawing && drawing.points.length > 0 && (
          <polyline points={pts(drawing.points)} stroke={SHAPE_COLOUR[drawing.kind]} fill="none" strokeWidth={2} />
        )}
      </svg>
      {busy && <span className="terrain-busy muted small">Working out the map…</span>}
    </div>
  )
}

/** An orthographic globe drawn from the map; drag to turn it. */
function Globe({ raster }: { raster: TerrainRasterDto | null }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ lon: 0, lat: 20 })
  const drag = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null)
  const S = 256
  const img = useMemo(() => (raster ? new Uint8ClampedArray(raster.rgba) : null), [raster])
  useEffect(() => {
    const c = ref.current!
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, S, S)
    if (!raster || !img) return
    const out = ctx.createImageData(S, S)
    const lat0 = (view.lat * Math.PI) / 180
    const lon0 = (view.lon * Math.PI) / 180
    const R = S / 2 - 2
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const x = (i + 0.5 - S / 2) / R
        const y = -(j + 0.5 - S / 2) / R
        const rho2 = x * x + y * y
        if (rho2 > 1) continue
        const z = Math.sqrt(1 - rho2)
        // Inverse orthographic projection centred on (lat0, lon0).
        const lat = Math.asin(z * Math.sin(lat0) + y * Math.cos(lat0))
        const lon = lon0 + Math.atan2(x, z * Math.cos(lat0) - y * Math.sin(lat0))
        const u = Math.floor((((((lon / Math.PI + 1) / 2) % 1) + 1) % 1) * raster.width)
        const v = Math.min(raster.height - 1, Math.floor(((Math.PI / 2 - lat) / Math.PI) * raster.height))
        const k = (v * raster.width + u) * 4
        const shade = 0.55 + 0.45 * z
        const o = (j * S + i) * 4
        out.data[o] = img[k] * shade
        out.data[o + 1] = img[k + 1] * shade
        out.data[o + 2] = img[k + 2] * shade
        out.data[o + 3] = 255
      }
    ctx.putImageData(out, 0, 0)
  }, [raster, img, view])
  return (
    <canvas
      ref={ref}
      className="terrain-globe"
      style={{ width: S, height: S }}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, ...view }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        setView({ lon: d.lon - (e.clientX - d.x) * 0.6, lat: Math.max(-90, Math.min(90, d.lat + (e.clientY - d.y) * 0.6)) })
      }}
      onPointerUp={() => (drag.current = null)}
      title="Drag to turn"
    />
  )
}

export const terrainTool: ToolDefinition = {
  id: 'terrain',
  title: 'Terrain',
  description: 'Planet surfaces: generated on the sphere, rolled and locked, shaped by hand, coloured by their climate',
  View: TerrainView
}
