import type { Ride } from '@malevo/model'
import { duration, sig } from '../../components/fields'

const W = 640
const H = 170
const PAD = { l: 34, r: 40, t: 10, b: 22 }
/** A weightless coast longer than this is drawn as a short break. */
const BREAK_S = 60
const BREAK_W = 60

/**
 * The ride, moment by moment: the push felt (g, the line, left scale) and the shaking (the air's push, kPa,
 * shaded, right scale), with the hardest shaking and the sound barrier marked. Long coasts are squeezed.
 */
export function RideChart({ ride, label, id }: { ride: Ride; label: string; id?: string }): React.JSX.Element | null {
  const s = ride.samples
  if (s.length < 2) return null
  // Segments of flight, split at long coasts.
  const segs: { from: number; to: number }[] = []
  let start = s[0].t
  for (let i = 1; i < s.length; i++) {
    if (s[i].t - s[i - 1].t > BREAK_S && s[i].g === 0 && s[i - 1].g === 0) {
      segs.push({ from: start, to: s[i - 1].t })
      start = s[i].t
    }
  }
  segs.push({ from: start, to: s[s.length - 1].t })
  const breaks = segs.length - 1
  const flying = segs.reduce((a, g) => a + Math.max(1, g.to - g.from), 0)
  const plotW = W - PAD.l - PAD.r - breaks * BREAK_W
  const xs: { from: number; to: number; x0: number; k: number }[] = []
  let x = PAD.l
  for (const g of segs) {
    const k = plotW / flying
    xs.push({ ...g, x0: x, k })
    x += Math.max(1, g.to - g.from) * k + BREAK_W
  }
  const X = (t: number): number => {
    for (const g of xs) if (t <= g.to + 1e-6) return g.x0 + Math.max(0, t - g.from) * g.k
    const g = xs[xs.length - 1]
    return g.x0 + (g.to - g.from) * g.k
  }
  const gMax = Math.max(1, Math.ceil(ride.peak_g))
  const qMax = Math.max(1, ride.maxQ_kPa * 1.1)
  const Yg = (g: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - g / gMax)
  const Yq = (q: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - q / qMax)
  const bottom = H - PAD.b
  const within = (g: { from: number; to: number }): typeof s => s.filter((p) => p.t >= g.from - 1e-6 && p.t <= g.to + 1e-6)
  const gPaths = xs.map((g) =>
    within(g)
      .map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Yg(p.g).toFixed(1)}`)
      .join('')
  )
  const qAreas = xs.map((g) => {
    const pts = within(g)
    if (pts.length < 2 || ride.maxQ_kPa < 0.05) return ''
    return `M${X(pts[0].t).toFixed(1)},${bottom}${pts.map((p) => `L${X(p.t).toFixed(1)},${Yq(p.q).toFixed(1)}`).join('')}L${X(pts[pts.length - 1].t).toFixed(1)},${bottom}Z`
  })
  const gTicks = Array.from({ length: gMax + 1 }, (_, i) => i).filter((i) => gMax <= 6 || i % 2 === 0)
  return (
    <figure className="ride-chart" id={id}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {gTicks.map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Yg(g)} y2={Yg(g)} className="ride-grid" />
            <text x={PAD.l - 4} y={Yg(g) + 3} className="ride-axis" textAnchor="end">
              {g} g
            </text>
          </g>
        ))}
        <text x={W - PAD.r + 4} y={Yq(ride.maxQ_kPa) + 3} className="ride-axis ride-q-label">
          {sig(ride.maxQ_kPa, 2)} kPa
        </text>
        {ride.shake && (
          <rect
            x={X(ride.shake.from)}
            width={Math.max(1, X(ride.shake.to) - X(ride.shake.from))}
            y={PAD.t}
            height={bottom - PAD.t}
            className="ride-shake"
          >
            <title>Hardest shaking</title>
          </rect>
        )}
        {qAreas.map((d, i) => d && <path key={i} d={d} className="ride-q" />)}
        {gPaths.map((d, i) => d && <path key={i} d={d} className="ride-g" />)}
        {ride.mach1_t !== null && (
          <g>
            <line x1={X(ride.mach1_t)} x2={X(ride.mach1_t)} y1={PAD.t} y2={bottom} className="ride-mach" />
            <text x={X(ride.mach1_t) + 3} y={PAD.t + 9} className="ride-axis">
              Mach 1
            </text>
          </g>
        )}
        {xs.slice(0, -1).map((g, i) => {
          const bx = g.x0 + (g.to - g.from) * g.k
          return (
            <g key={i}>
              <path d={`M${bx + (BREAK_W - 24) / 2},${bottom} l6,-8 l6,8 l6,-8 l6,8`} className="ride-break" />
              <text x={bx + BREAK_W / 2} y={bottom - 30} className="ride-axis" textAnchor="middle">
                {duration(Math.round(xs[i + 1].from - g.to))}
              </text>
              <text x={bx + BREAK_W / 2} y={bottom - 18} className="ride-axis" textAnchor="middle">
                weightless
              </text>
            </g>
          )
        })}
        {xs.map((g, i) => (
          <g key={`t${i}`}>
            <text x={g.x0} y={H - 6} className="ride-axis">
              {fmtT(g.from)}
            </text>
            {g.to - g.from > 30 && (
              <text x={g.x0 + (g.to - g.from) * g.k} y={H - 6} className="ride-axis" textAnchor="end">
                {fmtT(g.to)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="muted small">
        <span className="ride-key-g" /> push felt, g · <span className="ride-key-q" /> shaking (the air’s push) ·{' '}
        <span className="ride-key-shake" /> hardest shaking · zigzags: weightless coasts, shortened
      </figcaption>
    </figure>
  )
}

/** "+1:05", "+44:50", "+1:02:00" from seconds. */
export function fmtT(t: number): string {
  const s = Math.round(t)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h ? `+${h}:${p(m)}:${p(ss)}` : `+${m}:${p(ss)}`
}

/** What it feels like, in a few lines. */
export function RideFacts({ ride }: { ride: Ride }): React.JSX.Element {
  return (
    <>
      <dt>The push</dt>
      <dd>
        peaks at {sig(ride.peak_g, 2)} g{ride.over2g_s > 1 ? `; over 2 g for ${duration(ride.over2g_s)}` : ''}
        {ride.over4g_s > 1 ? `, over 4 g for ${duration(ride.over4g_s)}` : ''}
      </dd>
      <dt>The shaking</dt>
      <dd>
        {ride.shakeWord}
        {ride.maxQ_kPa >= 0.5 && (
          <>
            , peaking at {sig(ride.maxQ_kPa, 2)} kPa at {fmtT(ride.maxQ_t)}
            {ride.shake ? `; hardest from ${fmtT(ride.shake.from)} to ${fmtT(ride.shake.to)}` : ''}
          </>
        )}
        {ride.mach1_t !== null ? `; through the sound barrier at ${fmtT(ride.mach1_t)}` : ''}
      </dd>
    </>
  )
}
