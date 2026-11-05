import { useEffect, useMemo, useRef, useState } from 'react'
import { AU, DAY, JULIAN_YEAR } from '@malevo/core'
import type { ApproachInfoDto, ApproachMapDto, ApproachQueryDto, ApproachSeriesDto, WorldSnapshot } from '../../../../shared/types'
import { NumberField, duration, sig } from '../../components/fields'
import { useFormatted, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/** Nodes ships reach this system from: its route neighbours first, then every other system. */
function sourcesFor(snapshot: WorldSnapshot, system: string): { id: string; name: string; onRoute: boolean }[] {
  const me = `system:${system}`
  const near = new Set<string>()
  for (const r of snapshot.routes)
    r.nodes.forEach((n, i) => {
      if (n !== me) return
      const prev = r.nodes[i - 1]
      const next = r.nodes[i + 1]
      if (prev) near.add(prev)
      if (next) near.add(next)
    })
  const others = snapshot.systems.filter((s) => s.id !== system && !near.has(`system:${s.id}`)).map((s) => `system:${s.id}`)
  return [
    ...[...near].map((id) => ({ id, name: snapshot.nodes[id]?.name ?? id, onRoute: true })),
    ...others.map((id) => ({ id, name: snapshot.nodes[id]?.name ?? id, onRoute: false }))
  ]
}

function ApproachView({ world, snapshot, now, setNow, displayCal, focus, navigate }: ToolProps): React.JSX.Element {
  const systems = snapshot.systems.filter((s) => s.star && s.star.mass !== null)
  const [systemPref, setSystem] = useWorldPref<string>(world.root, 'approachSystem', systems[0]?.id ?? '')
  const system = systems.find((s) => s.id === (focus?.startsWith('system:') ? focus.slice(7) : systemPref)) ?? systems[0]
  const sources = system ? sourcesFor(snapshot, system.id) : []
  const [fromPref, setFrom] = useWorldPref<string>(world.root, 'approachFrom', '')
  const from = sources.find((s) => s.id === fromPref)?.id ?? sources[0]?.id ?? ''
  const [marginAu, setMarginAu] = useWorldPref<number>(world.root, 'approachMargin', 0.02)
  const [extentAu, setExtentAu] = useWorldPref<number>(world.root, 'approachExtent', 0.4)
  const [spanY, setSpanY] = useWorldPref<number>(world.root, 'approachSpan', 2)
  const [offset, setOffset] = useState<[number, number]>([0, 0])
  const [info, setInfo] = useState<ApproachInfoDto | null>(null)
  const [map, setMap] = useState<ApproachMapDto | null>(null)
  const [series, setSeries] = useState<ApproachSeriesDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const q: ApproachQueryDto | null = system && from ? { system: system.id, from, t: now, offset, margin: marginAu * AU } : null
  const key = q ? JSON.stringify(q) : ''
  useEffect(() => {
    if (!q) return
    let live = true
    void window.malevo.approach.info(q).then((r) => {
      if (!live) return
      if ('error' in r) {
        setError(r.error)
        setInfo(null)
      } else {
        setError(null)
        setInfo(r)
      }
    })
    return () => {
      live = false
    }
  }, [key, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const mapKey = q ? `${q.system}|${q.from}|${now}|${extentAu}` : ''
  useEffect(() => {
    if (!q) return
    let live = true
    setMap(null)
    void window.malevo.approach
      .map({ system: q.system, from: q.from, t: now }, extentAu * AU, 41)
      .then((r) => live && !('error' in r) && setMap(r))
    return () => {
      live = false
    }
  }, [mapKey, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  // The sweep starts at the current date's year and does not chase every change of the current date.
  const [sweepStart, setSweepStart] = useState(now)
  const seriesKey = q ? `${q.system}|${q.from}|${sweepStart}|${spanY}` : ''
  useEffect(() => {
    if (!q) return
    let live = true
    setSeries(null)
    void window.malevo.approach
      .series({ system: q.system, from: q.from, t: sweepStart }, sweepStart, sweepStart + spanY * JULIAN_YEAR, 240)
      .then((r) => live && !('error' in r) && setSeries(r))
    return () => {
      live = false
    }
  }, [seriesKey, snapshot.version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!system)
    return (
      <div className="tool-page">
        <h1>Approach</h1>
        <p>Approaches are planned into a system whose star has a known mass. Make a system first.</p>
        <button className="primary" onClick={() => navigate('stars')}>
          Open Stars
        </button>
      </div>
    )

  return (
    <div className="tool-page wide approach" id="approach">
      <h1>Approach</h1>
      <div className="field-row">
        <label className="field">
          Into
          <select value={system.id} onChange={(e) => setSystem(e.target.value)} id="approachSystem">
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Coming from
          <select value={from} onChange={(e) => setFrom(e.target.value)} id="approachFrom">
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.onRoute ? ' (on a route)' : ''}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Navigator's margin, AU" value={marginAu} onCommit={(m) => m !== undefined && m >= 0 && setMarginAu(m)} />
        <NumberField label="Map half-width, AU" value={extentAu} onCommit={(m) => m !== undefined && m > 0 && setExtentAu(m)} />
      </div>
      <p className="muted small">
        Ships come in through the foam on a straight line from the other star, aimed at the port (
        {system.value.port ? 'the port body' : 'a habitable distance out, since no port body is set'}), and drop where the foam first
        collapses under the tide of the star and every body. Then they crawl by torch, flipping halfway.
      </p>
      {error && <p className="error">{error}</p>}

      {info && (
        <dl className="facts compact two-col" id="approachFacts">
          <dt>Drop</dt>
          <dd>{info.dropRadius !== null ? `${sig(info.dropRadius / AU, 4)} AU from the star` : 'the foam holds all the way'}</dd>
          <dt>Crawl</dt>
          <dd>
            {info.crawlDistance !== null ? `${sig(info.crawlDistance / AU, 4)} AU, ` : ''}
            {duration(info.crawl)}
          </dd>
          <dt>Star alone</dt>
          <dd>
            {info.starOnly.dropRadius !== null ? `${sig(info.starOnly.dropRadius / AU, 4)} AU, ` : ''}
            {duration(info.starOnly.crawl)}
          </dd>
          <dt>The bodies' lee</dt>
          <dd className={info.leeGain !== null && info.leeGain > 0.005 ? 'ok' : ''}>
            {info.leeGain === null
              ? '—'
              : info.leeGain > 0.0005
                ? `saves ${sig(info.leeGain * 100, 3)}%`
                : info.leeGain < -0.0005
                  ? `costs ${sig(-info.leeGain * 100, 3)}%`
                  : 'none to speak of'}
          </dd>
          <dt>Aim offset</dt>
          <dd>
            {sig(offset[0] / AU, 3)}, {sig(offset[1] / AU, 3)} AU{' '}
            {(offset[0] !== 0 || offset[1] !== 0) && (
              <button className="link" onClick={() => setOffset([0, 0])}>
                dead on
              </button>
            )}
          </dd>
          {info.margin && (
            <>
              <dt>Within the margin</dt>
              <dd>
                {duration(info.margin.best)} to {duration(info.margin.worst)}
              </dd>
            </>
          )}
        </dl>
      )}

      <div className="approach-panels">
        <div>
          <h3>Looking down the lane</h3>
          <p className="muted small">
            Crawl time for each aim, against the star alone: teal is shorter, orange longer. Click to aim there.
          </p>
          <AimMap map={map} info={info} offset={offset} setOffset={setOffset} marginAu={marginAu} />
        </div>
        <div className="approach-series">
          <h3>Over time</h3>
          <div className="field-row tight">
            <NumberField label="Years to sweep" value={spanY} onCommit={(y) => y !== undefined && y > 0 && setSpanY(Math.min(50, y))} />
            <button onClick={() => setSweepStart(now)}>Start at the current date</button>
          </div>
          <SeriesChart series={series} now={now} setNow={setNow} displayCal={displayCal} version={snapshot.version} />
        </div>
      </div>
    </div>
  )
}

function crawlRgb(ratio: number): number[] {
  // ratio = crawl / star-only crawl: teal below 1, orange above.
  const x = Math.max(-1, Math.min(1, (ratio - 1) / 0.25))
  const teal = [47, 155, 135]
  const mid = [235, 232, 222]
  const orange = [214, 112, 52]
  const c = x < 0 ? mid.map((m, i) => m + (teal[i] - m) * -x) : mid.map((m, i) => m + (orange[i] - m) * x)
  return c.map(Math.round)
}

function AimMap({
  map,
  info,
  offset,
  setOffset,
  marginAu
}: {
  map: ApproachMapDto | null
  info: ApproachInfoDto | null
  offset: [number, number]
  setOffset(o: [number, number]): void
  marginAu: number
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const S = 320
  useEffect(() => {
    const c = ref.current!
    const dpr = window.devicePixelRatio || 1
    c.width = S * dpr
    c.height = S * dpr
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#20242c'
    ctx.fillRect(0, 0, S, S)
    if (!map || !info?.starOnly.crawl) return
    // One pixel per cell, scaled up without smoothing: no seams between cells.
    const img = new ImageData(map.n, map.n)
    for (let j = 0; j < map.n; j++)
      for (let i = 0; i < map.n; i++) {
        const v = map.crawl[j * map.n + i]
        const c = v === null ? [58, 63, 74] : crawlRgb(v / info.starOnly.crawl)
        const k = ((map.n - 1 - j) * map.n + i) * 4
        img.data.set([c[0], c[1], c[2], 255], k)
      }
    const tmp = new OffscreenCanvas(map.n, map.n)
    tmp.getContext('2d')!.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, 0, 0, S, S)
    const toPx = (x: number, y: number): [number, number] => [S / 2 + (x / map.extent) * (S / 2), S / 2 - (y / map.extent) * (S / 2)]
    const [cx, cy] = toPx(offset[0], offset[1])
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(3, ((marginAu * AU) / map.extent) * (S / 2)), 0, 2 * Math.PI)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 6, cy)
    ctx.lineTo(cx + 6, cy)
    ctx.moveTo(cx, cy - 6)
    ctx.lineTo(cx, cy + 6)
    ctx.stroke()
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(`±${sig(map.extent / AU, 3)} AU`, 6, S - 6)
  }, [map, info, offset, marginAu])
  const click = (e: React.MouseEvent): void => {
    if (!map) return
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left - S / 2) / (S / 2)) * map.extent
    const y = (-(e.clientY - r.top - S / 2) / (S / 2)) * map.extent
    setOffset([x, y])
  }
  return <canvas ref={ref} style={{ width: S, height: S, cursor: 'crosshair' }} onClick={click} id="aimMap" />
}

function SeriesChart({
  series,
  now,
  setNow,
  displayCal,
  version
}: {
  series: ApproachSeriesDto | null
  now: number
  setNow(t: number): void
  displayCal: string | null
  version: number
}): React.JSX.Element {
  const W = 560
  const H = 240
  const pad = { l: 52, r: 10, t: 10, b: 30 }
  const ends = useMemo(() => (series ? [{ t: series.t[0] }, { t: series.t[series.t.length - 1] }] : []), [series])
  const labels = useFormatted(
    displayCal,
    ends.map((e) => ({ t: e.t, precision: 'day' })),
    version
  )
  if (!series) return <p className="muted small">Sweeping…</p>
  const vals = [...series.crawl, ...series.starOnly].filter((v): v is number => v !== null).map((v) => v / DAY)
  if (!vals.length) return <p className="muted small">The foam holds all along the line.</p>
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || hi * 0.05 || 1
  const t0 = series.t[0]
  const t1 = series.t[series.t.length - 1]
  const X = (t: number): number => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r)
  const Y = (d: number): number => pad.t + (1 - (d - (lo - span * 0.1)) / (span * 1.2)) * (H - pad.t - pad.b)
  const line = (v: (number | null)[]): string =>
    v
      .map((c, k) => (c === null ? null : `${X(series.t[k]).toFixed(1)},${Y(c / DAY).toFixed(1)}`))
      .filter(Boolean)
      .join(' ')
  // Lee windows: where the bodies save more than 2%.
  const windows: [number, number][] = []
  let start: number | null = null
  series.t.forEach((t, k) => {
    const c = series.crawl[k]
    const b = series.starOnly[k]
    const inLee = c !== null && b !== null && c < b * 0.98
    if (inLee && start === null) start = t
    if (!inLee && start !== null) {
      windows.push([start, t])
      start = null
    }
  })
  if (start !== null) windows.push([start, t1])
  const click = (e: React.MouseEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left - pad.l) / (r.width - pad.l - pad.r)
    if (f >= 0 && f <= 1) setNow(t0 + f * (t1 - t0))
  }
  return (
    <svg width={W} height={H} className="approach-chart" onClick={click} id="approachChart">
      {windows.map(([a, b], k) => (
        <rect key={k} x={X(a)} y={pad.t} width={Math.max(1, X(b) - X(a))} height={H - pad.t - pad.b} className="lee-window" />
      ))}
      <polyline points={line(series.starOnly)} className="series-base" />
      <polyline points={line(series.crawl)} className="series-crawl" />
      {now >= t0 && now <= t1 && <line x1={X(now)} x2={X(now)} y1={pad.t} y2={H - pad.b} className="series-now" />}
      <text x={pad.l - 6} y={Y(hi) + 4} textAnchor="end" className="axis">
        {sig(hi, 3)} d
      </text>
      <text x={pad.l - 6} y={Y(lo) + 4} textAnchor="end" className="axis">
        {sig(lo, 3)} d
      </text>
      <text x={pad.l} y={H - 8} className="axis">
        {labels[0] ?? ''}
      </text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="axis">
        {labels[1] ?? ''}
      </text>
      <text x={W - pad.r} y={pad.t + 12} textAnchor="end" className="axis legend">
        crawl · star alone (dashed) · lee windows shaded
      </text>
    </svg>
  )
}

export const approachTool: ToolDefinition = {
  id: 'approach',
  title: 'Approach',
  description: 'Where ships drop out of the foam and how long they crawl, by aim and by date; the lee windows',
  View: ApproachView
}
