/**
 * A scene timeline: a list of events, each lasting a while, and a set of clocks read at each one. Kept in a
 * `*.timeline.json` file of its own, which knows nothing of a world.
 *
 * Times in the file are written as durations, "0d 0h 4m 0s" (always 60-minute hours, 24-hour days), so the
 * file reads well by hand. Everything is worked out in standard seconds from the start of the first event.
 */

export type ClockKind = 'ship' | 'local' | 'duration' | 'countdown'

export interface Clock {
  id: string
  name: string
  kind: ClockKind
  /** Ship and local: what the clock reads when the first event starts, in its own units ("3d 14h 5m 0s"). */
  start?: string
  /** Local: how long a local hour is, in standard hours (1.0412…). Its minutes and seconds are sixtieths. */
  hour_h?: number
  /** Local: local hours in a local day (24 if not given). */
  hoursPerDay?: number
  /** Duration and countdown: the event that starts it (none: the first event's start). */
  startedBy?: string
  /** When in that event: its start (the default) or its end. */
  at?: 'start' | 'end'
  /** Countdown: how long it counts down from. */
  length?: string
}

export interface TimelineEvent {
  id: string
  name: string
  /** How long it lasts: "0d 0h 4m 0s". */
  duration: string
  /** Starts with the event before it (at the same moment), rather than when it ends. */
  with?: boolean
  notes?: string
}

export interface TimelineFile {
  format: 1
  title?: string
  clocks: Clock[]
  events: TimelineEvent[]
}

export const KIND_LABEL: Record<ClockKind, string> = {
  ship: 'Ship time',
  local: 'Local time',
  duration: 'Duration',
  countdown: 'Countdown'
}

export function emptyTimeline(title = 'Untitled'): TimelineFile {
  return {
    format: 1,
    title,
    clocks: [{ id: 'ship', name: 'Ship time', kind: 'ship', start: '0d 0h 0m 0s' }],
    events: [{ id: 'e1', name: 'First event', duration: '0d 0h 10m 0s' }]
  }
}

// ---- durations ----

/**
 * Seconds from a written duration: "0d 0h 4m 0s", "1h 30m", "90s", "2.5h", "-4m", "3d 14:05:00", "14:05", or a
 * bare number of seconds. Null if it doesn't read as one. `hour` scales hours, minutes and seconds (a local
 * hour); `day` is the length of a day.
 */
export function parseDuration(text: string, unit: { hour?: number; day?: number } = {}): number | null {
  const hour = unit.hour ?? 3600
  const day = unit.day ?? 86400
  const scale: Record<string, number> = { d: day, h: hour, m: hour / 60, s: hour / 3600 }
  let s = text.trim().toLowerCase()
  if (!s) return null
  let sign = 1
  if (/^[-−]/.test(s)) {
    sign = -1
    s = s.slice(1).trim()
  } else if (s.startsWith('+')) s = s.slice(1).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return sign * Number(s) * scale.s
  let total = 0
  // A clock face, "14:05" or "14:05:30", after any days.
  const face = /(\d+(?:\.\d+)?):(\d{1,2}(?:\.\d+)?)(?::(\d{1,2}(?:\.\d+)?))?$/.exec(s)
  if (face) {
    total += Number(face[1]) * scale.h + Number(face[2]) * scale.m + Number(face[3] ?? 0) * scale.s
    s = s.slice(0, face.index).trim()
  }
  const re = /(\d+(?:\.\d+)?)\s*([dhms])/g
  let used = ''
  for (let m = re.exec(s); m; m = re.exec(s)) {
    total += Number(m[1]) * scale[m[2]]
    used += m[0]
  }
  if (s.replace(/\s+/g, '') !== used.replace(/\s+/g, '')) return null
  if (!face && !used) return null
  return sign * total
}

/** Split whole seconds of a clock into days, hours, minutes and seconds (`perDay` hours a day). */
function split(total: number, perDay = 24): [number, number, number, number] {
  const t = Math.floor(total + 1e-6)
  const day = perDay * 3600
  const d = Math.floor(t / day)
  let rest = t - d * day
  const h = Math.floor(rest / 3600)
  rest -= h * 3600
  const m = Math.floor(rest / 60)
  return [d, h, m, rest - m * 60]
}

/** "0d 0h 4m 0s", from standard seconds (negative: "-0d 0h 4m 0s"). */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const [d, h, m, s] = split(Math.round(Math.abs(seconds)))
  return `${sign}${d}d ${h}h ${m}m ${s}s`
}

/** A clock's face, "3d 14:05:00", from seconds of its own (a day of `perDay` hours). */
export function formatFace(seconds: number, perDay = 24): string {
  const neg = seconds < 0
  const [d, h, m, s] = split(Math.abs(seconds), perDay)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${neg ? '-' : ''}${d}d ${pad(h)}:${pad(m)}:${pad(s)}`
}

/** Written the file's way, "3d 14h 5m 0s", from seconds of a clock's own. */
export function writeReading(seconds: number, perDay = 24): string {
  const neg = seconds < 0
  const [d, h, m, s] = split(Math.abs(seconds), perDay)
  return `${neg ? '-' : ''}${d}d ${h}h ${m}m ${s}s`
}

// ---- reading the file ----

/** The file's text as a timeline, or what's wrong with it. Missing pieces get defaults; unknown ones are kept. */
export function readTimeline(text: string): { file: TimelineFile } | { error: string } {
  if (!text.trim()) return { file: emptyTimeline() }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { error: `It isn't valid JSON: ${(err as Error).message}` }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'It should be a JSON object, with "clocks" and "events".' }
  const o = raw as Record<string, unknown>
  const clocks = Array.isArray(o.clocks) ? o.clocks : []
  const events = Array.isArray(o.events) ? o.events : []
  for (const c of clocks)
    if (!c || typeof c !== 'object' || !['ship', 'local', 'duration', 'countdown'].includes((c as Clock).kind))
      return { error: `A clock should have a "kind" of ship, local, duration or countdown (${JSON.stringify(c)}).` }
  for (const e of events) if (!e || typeof e !== 'object') return { error: `An event should be an object (${JSON.stringify(e)}).` }
  const file: TimelineFile = {
    ...(o as object),
    format: 1,
    clocks: clocks.map((c, i) => {
      const x = c as Clock
      return { ...x, id: String(x.id ?? `c${i + 1}`), name: String(x.name ?? KIND_LABEL[x.kind]) }
    }),
    events: events.map((e, i) => {
      const x = e as TimelineEvent
      return { ...x, id: String(x.id ?? `e${i + 1}`), name: String(x.name ?? ''), duration: String(x.duration ?? '0d 0h 0m 0s') }
    })
  }
  return { file }
}

/** The file's text: two-space JSON, one key order. */
export function writeTimeline(file: TimelineFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** A fresh id among `taken`: "e7", "c3". */
export function nextId(prefix: string, taken: readonly { id: string }[]): string {
  let n = taken.length + 1
  const ids = new Set(taken.map((t) => t.id))
  while (ids.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

// ---- working it out ----

export interface Scheduled {
  event: TimelineEvent
  /** Standard seconds from the first event's start. */
  start: number
  end: number
  /** The duration as written didn't read (taken as zero). */
  bad: boolean
}

/** When each event starts and ends: after the one before it ends, or with it if `with`. */
export function schedule(file: TimelineFile): Scheduled[] {
  const out: Scheduled[] = []
  let prev: Scheduled | null = null
  for (const event of file.events) {
    const d = parseDuration(event.duration)
    const start: number = prev ? (event.with ? prev.start : prev.end) : 0
    const s: Scheduled = { event, start, end: start + Math.max(0, d ?? 0), bad: d === null || d < 0 }
    out.push(s)
    prev = s
  }
  return out
}

/** A local clock's hour, in standard seconds. */
export const localHour = (c: Clock): number => (c.hour_h && c.hour_h > 0 ? c.hour_h : 1) * 3600
export const perDay = (c: Clock): number => (c.kind === 'local' && c.hoursPerDay && c.hoursPerDay > 0 ? c.hoursPerDay : 24)

/** What a ship or local clock reads at its start, in its own seconds. */
export function clockStart(c: Clock): number {
  if (c.kind !== 'ship' && c.kind !== 'local') return 0
  return parseDuration(c.start ?? '0s', { hour: 3600, day: perDay(c) * 3600 }) ?? 0
}

/** When a duration or countdown starts, in standard seconds; null if its event is gone. */
export function clockOrigin(c: Clock, sched: readonly Scheduled[]): number | null {
  if (!c.startedBy) return 0
  const s = sched.find((x) => x.event.id === c.startedBy)
  if (!s) return null
  return c.at === 'end' ? s.end : s.start
}

/** What a clock shows at `t` (standard seconds from the first event's start). */
export function reading(c: Clock, t: number, sched: readonly Scheduled[]): string {
  switch (c.kind) {
    case 'ship':
      return formatFace(clockStart(c) + t)
    case 'local':
      // Its own seconds: each a sixtieth of a sixtieth of its hour.
      return formatFace(clockStart(c) + (t * 3600) / localHour(c), perDay(c))
    case 'duration': {
      const o = clockOrigin(c, sched)
      if (o === null || t < o - 1e-6) return '—'
      return formatDuration(t - o)
    }
    case 'countdown': {
      const o = clockOrigin(c, sched)
      if (o === null || t < o - 1e-6) return '—'
      const left = (parseDuration(c.length ?? '0s') ?? 0) - (t - o)
      return left >= 0 ? `T−${formatDuration(left)}` : `T+${formatDuration(-left)}`
    }
  }
}

// ---- Markdown ----

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** The timeline as a Markdown table: each event, how long it lasts, and every clock as it starts. */
export function toMarkdown(file: TimelineFile): string {
  const sched = schedule(file)
  const head = ['#', 'Event', 'Duration', ...file.clocks.map((c) => c.name), 'Notes']
  const lines = [
    ...(file.title ? [`## ${file.title}`, ''] : []),
    `| ${head.map(cell).join(' | ')} |`,
    `|${head.map((_, i) => (i === 0 ? ' --: ' : ' --- ')).join('|')}|`,
    ...sched.map(
      (s, i) =>
        `| ${[
          String(i + 1),
          s.event.name,
          formatDuration(s.end - s.start),
          ...file.clocks.map((c) => reading(c, s.start, sched)),
          s.event.notes ?? ''
        ]
          .map(cell)
          .join(' | ')} |`
    )
  ]
  const ended = sched.length ? Math.max(...sched.map((s) => s.end)) : 0
  if (sched.length)
    lines.push(
      '',
      `Ends after ${formatDuration(ended)}${file.clocks.length ? `: ${file.clocks.map((c) => `${c.name} ${reading(c, ended, sched)}`).join(', ')}` : ''}.`
    )
  return `${lines.join('\n')}\n`
}
