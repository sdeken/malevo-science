import { useEffect, useMemo, useRef, useState } from 'react'
import { AU, DEG, HOUR, MINUTE, DAY, altAz, cdToMu, luminanceOf, toLocal, type Vec3 } from '@malevo/core'
import { drawSky, instrumentFor, pictureModel, starColor, type SkyCamera, type SkyPicture, type SkyPick, type SkyPoint } from '@malevo/viz'
import type { SkySceneDto, SkyStarsDto, ViewpointDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, duration, sig } from '../../components/fields'
import { slugId, useFormattedOne, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

const TORCH_COLOR: [number, number, number] = [255, 214, 178]
const BODY_COLOR: [number, number, number] = [236, 228, 210]
const SUN_COLOR: [number, number, number] = [255, 247, 228]

const nodeLabel = (snapshot: WorldSnapshot, id: string): string => snapshot.nodes[id]?.name ?? id
const routeName = (snapshot: WorldSnapshot, id: string): string => snapshot.routes.find((r) => r.id === id)?.name ?? id

function SkyView({ world, snapshot, now, setNow, displayCal, navigate }: ToolProps): React.JSX.Element {
  const bodies = snapshot.systems.flatMap((s) => s.bodies.filter((b) => b.cls !== 'belt').map((b) => ({ ...b, systemName: s.name })))
  const [vp, setVp] = useWorldPref<ViewpointDto | null>(world.root, 'skyViewpoint', null)
  const [cam, setCam] = useWorldPref<SkyCamera>(world.root, 'skyCamera', { az: Math.PI, alt: 25 * DEG, fov: 100 * DEG })
  const [picked, setPicked] = useState<SkyPick | null>(null)
  const [playing, setPlaying] = useState(false)
  const formatted = useFormattedOne(displayCal, now, 'minute', snapshot.version)

  // A sensible first viewpoint: the first saved one, or the first body.
  const current: ViewpointDto | null =
    vp && bodies.some((b) => b.id === vp.body)
      ? vp
      : snapshot.viewpoints[0]?.value
        ? (snapshot.viewpoints[0].value as unknown as ViewpointDto)
        : bodies[0]
          ? { body: bodies[0].id, lat_deg: 30, lon_deg: 0 }
          : null
  const { scene, error, picture, model } = useSky(current, now, snapshot)

  const nowRef = useRef(now)
  nowRef.current = now
  useEffect(() => {
    if (!playing) return
    const h = setInterval(() => setNow(nowRef.current + 6 * MINUTE), 120)
    return () => clearInterval(h)
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

  const sunAlt = picture ? altAz(picture.sun).alt / DEG : null
  const zenith = model ? model.light([0, 0, 1]) : null
  const body = bodies.find((b) => b.id === current?.body)

  const saveViewpoint = async (): Promise<void> => {
    if (!current) return
    const name = window.prompt(
      'Name this viewpoint',
      body ? `${body.name} ${sig(current.lat_deg, 3)}°, ${sig(current.lon_deg, 3)}°` : 'Viewpoint'
    )
    if (!name?.trim()) return
    const id = slugId(
      name,
      snapshot.viewpoints.map((v) => v.id)
    )
    await window.malevo.world.setEntity('viewpoint', id, { name: name.trim(), ...current })
  }

  const noonHere = async (): Promise<void> => {
    if (!current || !body) return
    const m = await window.malevo.skyNoon(current.body, current.lon_deg, now)
    if (m === null) return
    await window.malevo.world.setEntity('body', body.id, {
      ...body.value,
      rotation: { ...(body.value.rotation as object), meridian_deg: m }
    })
  }

  if (!bodies.length)
    return (
      <div className="tool-page">
        <h1>Sky</h1>
        <p>The sky is seen from a body. Make a system and give it a planet first.</p>
        <button className="primary" onClick={() => navigate('systems')}>
          Open Systems
        </button>
      </div>
    )

  return (
    <div className="split-tool">
      <nav className="split-list sky-side">
        <h2>Sky</h2>
        <label className="field">
          Viewpoint
          <select
            value=""
            onChange={(e) => {
              const v = snapshot.viewpoints.find((x) => x.id === e.target.value)
              if (v?.value) setVp(v.value as unknown as ViewpointDto)
            }}
            id="skyViewpoints"
          >
            <option value="">{snapshot.viewpoints.length ? 'Go to a saved viewpoint…' : 'No saved viewpoints'}</option>
            {snapshot.viewpoints.map((v) => (
              <option key={v.id} value={v.id}>
                {String(v.value?.name ?? v.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <select value={current?.body ?? ''} onChange={(e) => current && setVp({ ...current, body: e.target.value })} id="skyBody">
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.systemName})
              </option>
            ))}
          </select>
        </label>
        {current && (
          <div className="field-row tight">
            <NumberField
              label="Latitude, °"
              value={current.lat_deg}
              onCommit={(x) => x !== undefined && setVp({ ...current, lat_deg: Math.max(-90, Math.min(90, x)) })}
              id="skyLat"
            />
            <NumberField
              label="Longitude, ° E"
              value={current.lon_deg}
              onCommit={(x) => x !== undefined && setVp({ ...current, lon_deg: x })}
              id="skyLon"
            />
          </div>
        )}
        <div className="inspector-actions wrap">
          <button onClick={() => void saveViewpoint()}>Save as viewpoint…</button>
          {body && !(body.value.rotation as { locked?: boolean } | undefined)?.locked && (
            <button
              onClick={() => void noonHere()}
              title="Sets the body's prime meridian so the star crosses this longitude's meridian at the current date"
              id="skyNoon"
            >
              Make it noon here now
            </button>
          )}
        </div>

        <h3>When</h3>
        <p className="sky-when" id="skyWhen">
          {formatted ?? '…'}
        </p>
        <div className="seg time-steps">
          {(
            [
              ['−1 d', -DAY],
              ['−1 h', -HOUR],
              ['−10 m', -10 * MINUTE],
              ['+10 m', 10 * MINUTE],
              ['+1 h', HOUR],
              ['+1 d', DAY]
            ] as const
          ).map(([label, dt]) => (
            <button key={label} onClick={() => setNow(now + dt)}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setPlaying(!playing)} id="skyPlay">
          {playing ? 'Pause' : 'Play (6 min per tick)'}
        </button>

        {error && <p className="error">{error}</p>}
        {scene && model && (
          <>
            <dl className="facts compact" id="skyFacts">
              <dt>Sun</dt>
              <dd>
                {sig(sunAlt, 3)}° up, az {sig(altAz(picture!.sun).az / DEG, 3)}° · {twilight(sunAlt!)}
              </dd>
              <dt>Zenith sky</dt>
              <dd>{zenith && luminanceOf(zenith) > 0 ? `${sig(cdToMu(luminanceOf(zenith)), 3)} mag/arcsec²` : '—'}</dd>
              <dt>Faintest visible</dt>
              <dd>
                {sig(model.limitingMagnitude([0, 0, 1], instrumentFor(cam.fov).instrument), 3)} at the zenith ({instrumentFor(cam.fov).name}
                )
              </dd>
              <dt>Air</dt>
              <dd>{scene.atmosphere ? `${sig(scene.atmosphere.column, 3)} × Earth's column` : 'none (set it on the body)'}</dd>
            </dl>

            <h3>Torches from the route network</h3>
            {scene.routes.length === 0 ? (
              <p className="muted small">No routes with traffic touch this system.</p>
            ) : (
              <table className="units sky-routes" id="skyRoutes">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Ships/day</th>
                    <th>Crawl</th>
                    <th>Up now</th>
                  </tr>
                </thead>
                <tbody>
                  {scene.routes.map((r) => (
                    <tr key={`${r.route}${r.kind}${r.neighbour}`} data-sky-route={`${r.route}:${r.kind}`}>
                      <td>
                        {routeName(snapshot, r.route)}
                        <div className="muted small">
                          {r.kind === 'in'
                            ? `arriving from ${nodeLabel(snapshot, r.neighbour)}`
                            : `leaving for ${nodeLabel(snapshot, r.neighbour)}`}
                        </div>
                      </td>
                      <td>{sig(r.perDay, 3)}</td>
                      <td>{duration(r.crawl)}</td>
                      <td title={`On average ${sig(r.expected, 3)}: ships per day × crawl time`}>
                        {r.shown} <span className="muted small">(avg {sig(r.expected, 3)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">
              Each route's torches are its own traffic: ships per day times the time a ship spends crawling in-system, placed along the line
              toward the star it comes from or goes to.
            </p>
          </>
        )}
        {picked && <PickCard pick={picked} scene={scene} snapshot={snapshot} />}
      </nav>
      <div className="split-detail sky-pane">
        {picture && model ? (
          <SkyCanvas picture={picture} model={model} cam={cam} setCam={setCam} onPick={setPicked} />
        ) : (
          <p className="tool-page muted">{error ?? 'Working out the sky…'}</p>
        )}
        <p className="map-hint muted small">
          Drag to look around, wheel to zoom (binoculars below 15°, a telescope below 3°), click a light to name it.
        </p>
      </div>
    </div>
  )
}

/** The sky from a viewpoint at an instant: the scene from main, the stars for its system, and the picture and sky model to draw. */
export function useSky(
  current: ViewpointDto | null,
  now: number,
  snapshot: WorldSnapshot
): { scene: SkySceneDto | null; error: string | null; picture: SkyPicture | null; model: ReturnType<typeof pictureModel> | null } {
  const [scene, setScene] = useState<SkySceneDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stars, setStars] = useState<{ system: string; data: SkyStarsDto } | null>(null)
  const vpKey = current ? `${current.body}|${current.lat_deg}|${current.lon_deg}|${current.elevation_m ?? 0}` : ''

  useEffect(() => {
    if (!current) return
    let live = true
    void window.malevo.sky.scene(current, now).then((s) => {
      if (!live) return
      if ('error' in s) {
        setError(s.error)
        setScene(null)
      } else {
        setError(null)
        setScene(s)
      }
    })
    return () => {
      live = false
    }
  }, [vpKey, now, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const system = scene?.system ?? null
  useEffect(() => {
    if (!system || stars?.system === system) return
    void window.malevo.sky.stars(system).then((data) => data && setStars({ system, data }))
  }, [system, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const picture: SkyPicture | null = useMemo(() => {
    if (!scene) return null
    const f = scene.frame
    const L = (v: [number, number, number]): Vec3 => toLocal(f, v)
    const points: SkyPoint[] = []
    if (stars && stars.system === scene.system) {
      const d = stars.data
      for (let i = 0; i < d.ids.length; i++)
        points.push({
          id: d.ids[i],
          kind: 'star',
          dir: L([d.dir[i * 3], d.dir[i * 3 + 1], d.dir[i * 3 + 2]]),
          mag: d.mag[i],
          color: starColor(d.ci[i]),
          label: d.names[i]
        })
    }
    for (const t of scene.torches)
      if (!t.dark)
        points.push({
          id: `torch:${t.route}:${t.service}:${t.kind}:${Math.round(t.tau)}`,
          kind: 'torch',
          dir: L(t.dir),
          mag: t.mag,
          color: TORCH_COLOR,
          label: routeName(snapshot, t.route)
        })
    for (const b of scene.bodies)
      points.push({
        id: b.id,
        kind: 'body',
        dir: L(b.dir),
        mag: b.mag,
        color: BODY_COLOR,
        label: b.name,
        radius: b.radius,
        lit: L(b.lit),
        phase: b.phase
      })
    points.push({
      id: 'sun',
      kind: 'sun',
      dir: L(scene.sun.dir),
      mag: scene.sun.mag,
      color: SUN_COLOR,
      radius: scene.sun.radius,
      label: 'Sun'
    })
    return { sun: L(scene.sun.dir), atmosphere: scene.atmosphere, galPole: L(scene.galPole), galCentre: L(scene.galCentre), points }
  }, [scene, stars, snapshot])
  const model = useMemo(() => (picture ? pictureModel(picture) : null), [picture])
  return { scene, error, picture, model }
}

export function twilight(alt: number): string {
  if (alt > -0.833) return 'day'
  if (alt > -6) return 'civil twilight'
  if (alt > -12) return 'nautical twilight'
  if (alt > -18) return 'astronomical twilight'
  return 'night'
}

function PickCard({ pick, scene, snapshot }: { pick: SkyPick; scene: SkySceneDto | null; snapshot: WorldSnapshot }): React.JSX.Element {
  const p = pick.point
  const { alt, az } = altAz(p.dir)
  const torch =
    p.kind === 'torch' && scene ? scene.torches.find((t) => `torch:${t.route}:${t.service}:${t.kind}:${Math.round(t.tau)}` === p.id) : null
  const body = p.kind === 'body' && scene ? scene.bodies.find((b) => b.id === p.id) : null
  return (
    <div className="star-card" id="skyPick">
      <h3>{p.kind === 'torch' ? 'A torch' : (p.label ?? p.id)}</h3>
      <dl className="facts compact">
        <dt>Where</dt>
        <dd>
          {sig(alt / DEG, 3)}° up, az {sig(az / DEG, 3)}°
        </dd>
        <dt>Magnitude</dt>
        <dd>
          {sig(pick.seen, 3)} after extinction · limit there {sig(pick.limit, 3)}
        </dd>
        {torch && (
          <>
            <dt>Route</dt>
            <dd>
              {routeName(snapshot, torch.route)}, {torch.kind === 'in' ? 'arriving from' : 'leaving for'}{' '}
              {nodeLabel(snapshot, torch.neighbour)}
            </dd>
            <dt>Crawl</dt>
            <dd>{duration(torch.tau)} in</dd>
            <dt>Distance</dt>
            <dd>{sig(torch.distance / AU, 3)} AU</dd>
          </>
        )}
        {body && (
          <>
            <dt>Distance</dt>
            <dd>{body.distance > 0.01 * AU ? `${sig(body.distance / AU, 3)} AU` : `${sig(body.distance / 1000, 4)} km`}</dd>
            <dt>Lit</dt>
            <dd>{sig(((1 + Math.cos(body.phase)) / 2) * 100, 3)}%</dd>
          </>
        )}
        {p.kind === 'star' && (
          <>
            <dt>Star</dt>
            <dd>
              <code>{p.id}</code>
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

export function SkyCanvas({
  picture,
  model,
  cam,
  setCam,
  onPick
}: {
  picture: SkyPicture
  model: ReturnType<typeof pictureModel>
  cam: SkyCamera
  setCam(c: SkyCamera): void
  onPick(p: SkyPick | null): void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawn = useRef<ReturnType<typeof drawSky>>([])
  const [size, setSize] = useState<[number, number]>([800, 500])
  const [view, setView] = useState(cam)
  const dragging = useRef<{ x: number; y: number; cam: SkyCamera; moved: boolean } | null>(null)
  useEffect(() => setView(cam), [cam])

  useEffect(() => {
    const el = host.current!
    const ro = new ResizeObserver(() => setSize([Math.max(100, el.clientWidth), Math.max(100, el.clientHeight)]))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvas.current!
    const dpr = window.devicePixelRatio || 1
    c.width = size[0] * dpr
    c.height = size[1] * dpr
    const ctx = c.getContext('2d')!
    drawn.current = drawSky(ctx, size[0], size[1], dpr, picture, model, view, { resolution: dragging.current ? 10 : 5 })
  }, [picture, model, view, size])

  const onDown = (e: React.PointerEvent): void => {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragging.current = { x: e.clientX, y: e.clientY, cam: view, moved: false }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = dragging.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.hypot(dx, dy) > 3) d.moved = true
    const perPx = view.fov / size[0]
    setView({ ...d.cam, az: d.cam.az - dx * perPx, alt: Math.max(-10 * DEG, Math.min(90 * DEG, d.cam.alt + dy * perPx)) })
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = dragging.current
    dragging.current = null
    if (!d) return
    if (d.moved) {
      setCam(view)
      return
    }
    const rect = canvas.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    let best: (typeof drawn.current)[number] | null = null
    for (const p of drawn.current) if (Math.hypot(p.x - x, p.y - y) < 10 && (!best || p.pick.seen < best.pick.seen)) best = p
    onPick(best?.pick ?? null)
  }
  const onWheel = (e: React.WheelEvent): void => {
    const fov = Math.max(0.5 * DEG, Math.min(150 * DEG, view.fov * Math.exp(e.deltaY * 0.0012)))
    const next = { ...view, fov }
    setView(next)
    setCam(next)
  }

  return (
    <div className="sky-canvas" ref={host}>
      <canvas
        ref={canvas}
        style={{ width: size[0], height: size[1] }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onWheel={onWheel}
        id="skyCanvas"
      />
    </div>
  )
}

export const skyTool: ToolDefinition = {
  id: 'sky',
  title: 'Sky',
  description: 'The sky from any point on any body at the current date: stars, sun, moons and the torches the routes imply',
  View: SkyView
}
