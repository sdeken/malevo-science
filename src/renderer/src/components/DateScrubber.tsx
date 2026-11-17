import { useEffect, useRef, useState } from 'react'

/** Steps to scrub by, finest first. Earth units, whatever the calendar: a "month" is 30 days and a "year" 360. */
export const SCRUB_UNITS = [
  { name: 'second', label: 'second', by: 'by the second', s: 1 },
  { name: 'minute', label: 'minute', by: 'by the minute', s: 60 },
  { name: 'hour', label: 'hour', by: 'by the hour', s: 3600 },
  { name: 'day', label: 'day', by: 'by the day', s: 86400 },
  { name: 'month', label: '30 days', by: 'by 30 days', s: 30 * 86400 },
  { name: 'year', label: '360 days', by: 'by 360 days', s: 360 * 86400 }
] as const

const START = 3 // a day
/** Pixels of sideways drag per step. */
const PX_PER_STEP = 8
/** Pixels of up or down drag per change of unit. */
const PX_PER_LEVEL = 36

/** Which unit a drag is on, from how far up (finer) or down (coarser) it has gone since it started. */
export function scrubLevel(start: number, dy: number): number {
  return Math.max(0, Math.min(SCRUB_UNITS.length - 1, start + Math.round(dy / PX_PER_LEVEL)))
}

interface Props {
  now: number
  setNow(t: number): void
  /** The unit being scrubbed by, as it changes (to show the date that finely). */
  onUnit?(unit: (typeof SCRUB_UNITS)[number]['name'] | null): void
}

/**
 * Drag left and right to go earlier and later. Drag up as well for finer steps (hour, minute, second), down
 * for coarser (30 days, 360 days); it starts on days. With the keyboard: ← and → step, ↑ and ↓ change the
 * step. Steps are whole units, so scrubbing by days keeps the time of day.
 */
export function DateScrubber({ now, setNow, onUnit }: Props): React.JSX.Element {
  const [level, setLevel] = useState(START)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; t: number; acc: number; startLevel: number; level: number } | null>(null)
  const pending = useRef<number | null>(null)
  const frame = useRef(0)
  const nowRef = useRef(now)
  nowRef.current = now
  const unit = SCRUB_UNITS[level]

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  /** Send the date at most once a frame: everything that follows the date redraws. */
  const push = (t: number): void => {
    pending.current = t
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (pending.current !== null) setNow(pending.current)
      pending.current = null
    })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    // Every drag starts on days.
    drag.current = { x: e.clientX, y: e.clientY, t: nowRef.current, acc: 0, startLevel: START, level: START }
    setLevel(START)
    setDragging(true)
    onUnit?.(SCRUB_UNITS[START].name)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const lv = scrubLevel(d.startLevel, e.clientY - d.y)
    if (lv !== d.level) {
      d.level = lv
      d.acc = 0
      setLevel(lv)
      onUnit?.(SCRUB_UNITS[lv].name)
    }
    d.acc += e.clientX - d.x
    d.x = e.clientX
    const steps = Math.trunc(d.acc / PX_PER_STEP)
    if (!steps) return
    d.acc -= steps * PX_PER_STEP
    d.t += steps * SCRUB_UNITS[lv].s
    push(d.t)
  }
  const end = (): void => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onUnit?.(null)
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const by = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setNow(nowRef.current + (e.key === 'ArrowLeft' ? -by : by) * unit.s)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setLevel((l) => Math.max(0, Math.min(SCRUB_UNITS.length - 1, l + (e.key === 'ArrowUp' ? -1 : 1))))
    }
  }

  return (
    <div
      className={`date-scrubber${dragging ? ' dragging' : ''}`}
      id="dateScrubber"
      role="slider"
      tabIndex={0}
      aria-label={`Scrub the date ${unit.by}`}
      aria-valuetext={`${unit.label} steps`}
      data-unit={unit.name}
      title="Drag left or right to go earlier or later. Drag up for finer steps (hour, minute, second), down for coarser (30 days, 360 days). Keys: ← → step (Shift: ten), ↑ ↓ change the step."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={onKeyDown}
    >
      <span className="scrub-arrow" aria-hidden>
        ◂
      </span>
      <span className="scrub-current">{unit.by}</span>
      {dragging && (
        <span className="scrub-ladder" aria-hidden>
          {SCRUB_UNITS.map((u, i) => (
            <span key={u.name} className={i === level ? 'on' : ''}>
              {i === 0 ? '↑ ' : i === SCRUB_UNITS.length - 1 ? '↓ ' : ''}
              {u.label}
            </span>
          ))}
        </span>
      )}
      <span className="scrub-arrow" aria-hidden>
        ▸
      </span>
    </div>
  )
}
