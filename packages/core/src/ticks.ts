/**
 * Axis ticks for a timeline in any calendar.
 *
 * Calendars differ in their units and in how long those units are (a fixed
 * calendar's months are exact, a solar calendar's years vary by a day, a
 * script calendar can do anything), so ticks are found by walking the
 * calendar's own fields rather than by dividing time evenly. The chosen unit
 * is the finest one whose ticks, at a "nice" step, stay at or under the
 * target count. Steps restart at each boundary of the unit above
 * (days 1, 6, 11, …, then 1 again in the next month).
 */
import { formatInstant, type Calendar, type Fields } from './calendar'
import type { Instant } from './time'

export interface Tick {
  t: Instant
  label: string
  /** The tick also starts a new unit one level up (a new month on a day axis): label it more prominently. */
  major: boolean
}

export interface TickSet {
  /** The unit the ticks step in. */
  unit: string
  step: number
  ticks: Tick[]
}

const TOP_STEPS = [1, 2, 5]
const SUB_STEPS = [1, 2, 3, 5, 6, 10, 12, 15, 20, 30]

/** 1, 2, 5, 10, 20, 50, … up to `max`. */
function topSteps(max: number): number[] {
  const out: number[] = []
  for (let p = 1; p <= max * 10; p *= 10) for (const s of TOP_STEPS) if (s * p <= max) out.push(s * p)
  return out
}

/** Average length of one of unit `level`, sampled near `t`. */
function unitLength(cal: Calendar, level: number, t: Instant): number {
  const name = cal.units[level].name
  const f = truncate(cal, cal.toFields(t), level)
  const a = cal.fromFields(f)
  const b = cal.fromFields({ ...f, [name]: f[name] + 4 })
  return (b - a) / 4
}

/** Fields with every unit below `level` set to its first value. */
function truncate(cal: Calendar, f: Fields, level: number): Fields {
  const out: Fields = {}
  cal.units.forEach((u, i) => {
    out[u.name] = i <= level ? Math.floor(f[u.name]) : u.first
  })
  return out
}

export function calendarTicks(cal: Calendar, t0: Instant, t1: Instant, target = 10, maxTicks = 400): TickSet {
  if (!(t1 > t0)) return { unit: cal.units[0].name, step: 1, ticks: [] }
  const span = t1 - t0
  const mid = (t0 + t1) / 2
  // Pick the finest level and step that keeps the count at or below the target.
  let level = 0
  let step = 1
  for (let i = 0; i < cal.units.length; i++) {
    const len = unitLength(cal, i, mid)
    if (!(len > 0)) break
    let fit: number | undefined
    if (i === 0) fit = topSteps(Math.max(1, span / len)).find((s) => span / (len * s) <= target)
    else {
      // Steps restart in every parent, so only steps shorter than the parent make sense,
      // and each parent holds ceil(perParent / step) ticks.
      const parentLen = unitLength(cal, i - 1, mid)
      const perParent = Math.round(parentLen / len)
      fit = SUB_STEPS.filter((s) => s < perParent).find((s) => (span / parentLen) * Math.ceil(perParent / s) <= target)
    }
    if (fit === undefined) break
    level = i
    step = fit
    // A coarser step at this level fits; a finer level might too, so keep looking.
  }
  // At the top level, also consider larger steps when even step 1 is too dense.
  if (level === 0) {
    const len = unitLength(cal, 0, mid)
    const steps = topSteps(Math.max(1, Math.ceil(span / len)))
    step = steps.find((s) => span / (len * s) <= target) ?? steps[steps.length - 1] ?? 1
  }

  const unit = cal.units[level]
  const parent = level > 0 ? cal.units[level - 1] : null
  const ticks: Tick[] = []
  const f = truncate(cal, cal.toFields(t0), level)
  // Align to the step: the top unit to multiples of the step, others to first + k·step within their parent.
  if (level === 0) f[unit.name] = Math.floor(f[unit.name] / step) * step
  else f[unit.name] = unit.first + Math.floor((f[unit.name] - unit.first) / step) * step
  let t = cal.fromFields(f)
  let guard = 0
  while (t <= t1 && ticks.length < maxTicks && guard++ < maxTicks * 4) {
    const fields = cal.toFields(t)
    if (t >= t0) {
      const major = parent ? Math.floor(fields[unit.name]) === unit.first : step > 1 && Math.floor(fields[unit.name]) % (step * 10) === 0
      ticks.push({ t, label: formatInstant(cal, t, unit.name), major })
    }
    // Advance by one step; if that rolls over into the next parent, restart at its first value.
    const next = { ...truncate(cal, fields, level), [unit.name]: Math.floor(fields[unit.name]) + step }
    let tn = cal.fromFields(next)
    if (parent) {
      const nf = cal.toFields(tn)
      const parentChanged = cal.units.slice(0, level).some((u) => Math.floor(nf[u.name]) !== Math.floor(fields[u.name]))
      if (parentChanged) tn = cal.fromFields({ ...truncate(cal, nf, level - 1), [unit.name]: unit.first })
    }
    if (!(tn > t)) break
    t = tn
  }
  return { unit: unit.name, step, ticks }
}
