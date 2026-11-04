import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EventInfo, TickInfo } from '../../../../shared/types'

export interface View {
  t0: number
  t1: number
}

interface Props {
  events: EventInfo[]
  view: View
  setView(v: View): void
  now: number
  setNow(t: number): void
  displayCal: string | null
  selected: string | null
  onSelect(id: string | null): void
  version: number
}

const AXIS = 40
const LANE = 30
const MIN_SPAN = 60
const MAX_SPAN = 1e14

interface Placed {
  ev: EventInfo
  x0: number
  x1: number
  band: [number, number] | null
  lane: number
}

/**
 * The timeline: a zoomable, pannable axis in the display calendar, events
 * packed into lanes, uncertainty drawn as a band (the span the date's
 * precision covers; dashed when the date is circa), and the current date as a
 * line that can be dragged. Wheel zooms around the pointer; dragging the
 * background pans; clicking the axis moves the current date.
 */
export function TimelineCanvas({ events, view, setView, now, setNow, displayCal, selected, onSelect, version }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [ticks, setTicks] = useState<TickInfo[]>([])
  const drag = useRef<{ kind: 'pan' | 'now'; x: number; view: View; moved: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)))
    ro.observe(el)
    setWidth(Math.max(200, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  // Ticks come from main (script calendars run there). Keep the old ones until the new ones arrive.
  useEffect(() => {
    if (!displayCal) return
    let live = true
    const handle = requestAnimationFrame(() => {
      void window.malevo.calendar.ticks(displayCal, view.t0, view.t1, Math.max(3, Math.floor(width / 110))).then((t) => live && setTicks(t))
    })
    return () => {
      live = false
      cancelAnimationFrame(handle)
    }
  }, [displayCal, view.t0, view.t1, width, version])

  const span = view.t1 - view.t0
  const xOf = (t: number): number => ((t - view.t0) / span) * width
  const tOf = (x: number): number => view.t0 + (x / width) * span

  const placed = useMemo(() => {
    const out: Placed[] = []
    const visible = events
      .filter((e) => e.start)
      .map((ev) => {
        const s = ev.start!
        const x0 = xOf(s.t)
        const x1 = ev.end ? Math.max(x0, xOf(ev.end.t)) : x0
        const band: [number, number] | null = s.range[1] > s.range[0] ? [xOf(s.range[0]), xOf(s.range[1])] : null
        return { ev, x0, x1, band, lane: 0 }
      })
      .filter((p) => p.x1 >= -400 && p.x0 <= width + 400)
      .sort((a, b) => a.x0 - b.x0 || a.ev.id.localeCompare(b.ev.id))
    const laneEnds: number[] = []
    for (const p of visible) {
      const label = (p.ev.value?.name ?? p.ev.id).length * 7 + 24
      const right = Math.max(p.x1, p.x0 + label, p.band ? p.band[1] : -Infinity)
      const left = Math.min(p.x0, p.band ? p.band[0] : Infinity)
      let lane = laneEnds.findIndex((end) => end + 6 < left)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = right
      p.lane = lane
      out.push(p)
    }
    return { items: out, lanes: Math.max(1, laneEnds.length) }
  }, [events, view.t0, view.t1, width]) // eslint-disable-line react-hooks/exhaustive-deps

  const height = AXIS + placed.lanes * LANE + 16
  const nowX = xOf(now)

  const onWheel = (e: React.WheelEvent): void => {
    const rect = box.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const at = tOf(x)
    const factor = Math.pow(1.0015, e.deltaY)
    const newSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span * factor))
    const t0 = at - (x / width) * newSpan
    setView({ t0, t1: t0 + newSpan })
  }

  const onPointerDown = (e: React.PointerEvent, kind: 'pan' | 'now'): void => {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { kind, x: e.clientX, view, moved: false }
    e.stopPropagation()
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 2) d.moved = true
    if (d.kind === 'pan') {
      const dt = (dx / width) * (d.view.t1 - d.view.t0)
      setView({ t0: d.view.t0 - dt, t1: d.view.t1 - dt })
    } else {
      const rect = box.current!.getBoundingClientRect()
      setNow(tOf(e.clientX - rect.left))
    }
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved && d.kind === 'pan') {
      const rect = box.current!.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < AXIS) setNow(tOf(e.clientX - rect.left))
      else onSelect(null)
    }
  }

  return (
    <div className="timeline-canvas" ref={box} onWheel={onWheel}>
      <svg
        width={width}
        height={height}
        onPointerDown={(e) => onPointerDown(e, 'pan')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="img"
        aria-label="Timeline"
      >
        <rect className="tl-axis-bg" x={0} y={0} width={width} height={AXIS} />
        {ticks.map((t) => {
          const x = xOf(t.t)
          return (
            <g key={t.t} className={t.major ? 'tl-tick major' : 'tl-tick'}>
              <line x1={x} x2={x} y1={AXIS - (t.major ? 14 : 8)} y2={height} />
              <text x={x + 4} y={AXIS - 18}>
                {t.label}
              </text>
            </g>
          )
        })}
        {placed.items.map((p) => {
          const y = AXIS + 10 + p.lane * LANE
          const ev = p.ev
          const type = ev.value?.type ?? 'event'
          const name = ev.value?.name ?? ev.id
          const circa = ev.start!.circa
          const isSel = ev.id === selected
          const hasError = ev.errors.length > 0
          return (
            <g
              key={ev.id}
              className={`tl-event tl-${type}${isSel ? ' selected' : ''}${hasError ? ' has-error' : ''}`}
              data-event={ev.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(ev.id)
              }}
            >
              <title>{name}</title>
              {p.band && (
                <rect
                  className={circa ? 'tl-band circa' : 'tl-band'}
                  x={p.band[0]}
                  y={y - 2}
                  width={Math.max(1, p.band[1] - p.band[0])}
                  height={LANE - 8}
                  rx={3}
                />
              )}
              {p.x1 > p.x0 + 1 ? (
                <rect className="tl-bar" x={p.x0} y={y + 3} width={p.x1 - p.x0} height={LANE - 18} rx={3} />
              ) : (
                <path className="tl-point" d={`M ${p.x0} ${y + 1} l 6 6 l -6 6 l -6 -6 z`} />
              )}
              <text className="tl-label" x={p.x0 + 10} y={y + 13}>
                {circa ? `c. ${name}` : name}
              </text>
            </g>
          )
        })}
        <g className="tl-now" onPointerDown={(e) => onPointerDown(e, 'now')}>
          <line x1={nowX} x2={nowX} y1={0} y2={height} />
          <rect className="tl-now-handle" x={nowX - 6} y={0} width={12} height={AXIS} />
        </g>
      </svg>
    </div>
  )
}

/** A view that shows every placed event, with some margin. */
export function fitView(events: EventInfo[], around: number): View {
  const ts: number[] = []
  for (const e of events) {
    if (e.start) ts.push(e.start.range[0], e.start.range[1], e.start.t)
    if (e.end) ts.push(e.end.t)
  }
  if (ts.length === 0) return { t0: around - 50 * 31_557_600, t1: around + 50 * 31_557_600 }
  let lo = Math.min(...ts)
  let hi = Math.max(...ts)
  if (hi - lo < 10 * 31_557_600) {
    const mid = (lo + hi) / 2
    lo = mid - 5 * 31_557_600
    hi = mid + 5 * 31_557_600
  }
  // Labels run to the right of their marker, so leave more room on that side.
  const span = hi - lo
  return { t0: lo - span * 0.06, t1: hi + span * 0.3 }
}
