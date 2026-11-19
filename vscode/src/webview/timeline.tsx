/**
 * The scene timeline editor, in a VS Code webview: a `*.timeline.json` file's clocks and events. The file is
 * VS Code's (unsaved changes, undo, Save); every change here goes to it as a whole new text, and every change
 * to it (from here, the text editor, or the disk) comes back as the text.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DateScrubber } from '../../../src/renderer/src/components/DateScrubber'
import {
  KIND_LABEL,
  clockStart,
  formatDuration,
  formatFace,
  nextId,
  parseDuration,
  perDay,
  readTimeline,
  reading,
  schedule,
  toMarkdown,
  writeReading,
  writeTimeline,
  type Clock,
  type ClockKind,
  type TimelineEvent,
  type TimelineFile
} from '../timeline/model'

interface VsApi {
  postMessage(m: unknown): void
}
declare function acquireVsCodeApi(): VsApi
const vs = acquireVsCodeApi()

function Root(): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [file, setFile] = useState<TimelineFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sent = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const m = e.data as { type: string; text?: string }
      if (m.type !== 'doc' || m.text === undefined) return
      // Our own change coming back: nothing new.
      if (m.text === sent.current) return
      if (timer.current) return // a change of ours is on its way; it wins
      setText(m.text)
      const r = readTimeline(m.text)
      if ('error' in r) setError(r.error)
      else {
        setError(null)
        setFile(r.file)
      }
    }
    window.addEventListener('message', onMessage)
    vs.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /** Change it here at once; send it to the file shortly (a drag sends one change, not hundreds). */
  const change = (next: TimelineFile): void => {
    setFile(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const t = writeTimeline(next)
      sent.current = t
      setText(t)
      vs.postMessage({ type: 'edit', text: t })
    }, 150)
  }

  if (error)
    return (
      <div className="tool-page timeline-page">
        <p className="error">This file doesn’t read as a scene timeline: {error}</p>
        <p className="muted">Fix it in the text editor (Reopen Editor With… → Text Editor); this view follows.</p>
      </div>
    )
  if (!file || text === null) return <p className="muted vs-loading">Opening…</p>
  return <TimelineEditor file={file} change={change} />
}

function TimelineEditor({ file, change }: { file: TimelineFile; change(f: TimelineFile): void }): React.JSX.Element {
  const sched = useMemo(() => schedule(file), [file])
  const ended = sched.length ? Math.max(...sched.map((s) => s.end)) : 0

  const setClock = (id: string, patch: Partial<Clock>): void =>
    change({ ...file, clocks: file.clocks.map((c) => (c.id === id ? strip({ ...c, ...patch }) : c)) })
  const setEvent = (id: string, patch: Partial<TimelineEvent>): void =>
    change({ ...file, events: file.events.map((e) => (e.id === id ? strip({ ...e, ...patch }) : e)) })
  const move = <T,>(list: T[], i: number, by: number): T[] => {
    const j = i + by
    if (j < 0 || j >= list.length) return list
    const out = [...list]
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  }
  const addClock = (kind: ClockKind): void => {
    const id = nextId('c', file.clocks)
    const base: Clock = { id, name: KIND_LABEL[kind], kind }
    const extra: Partial<Clock> =
      kind === 'ship'
        ? { start: '0d 0h 0m 0s' }
        : kind === 'local'
          ? { start: '0d 12h 0m 0s', hour_h: 1, hoursPerDay: 24 }
          : kind === 'countdown'
            ? { length: '0d 0h 30m 0s', ...(file.events[0] ? { startedBy: file.events[0].id } : {}) }
            : file.events[0]
              ? { startedBy: file.events[0].id }
              : {}
    change({ ...file, clocks: [...file.clocks, { ...base, ...extra }] })
  }
  const addEvent = (after: number): void => {
    const id = nextId('e', file.events)
    const events = [...file.events]
    events.splice(after + 1, 0, { id, name: 'New event', duration: '0d 0h 5m 0s' })
    change({ ...file, events })
  }
  const removeEvent = (id: string): void => {
    const starts = file.clocks.filter((c) => c.startedBy === id)
    const ev = file.events.find((e) => e.id === id)
    if (starts.length) {
      // The clocks it started start at the beginning instead (the host asks first).
      vs.postMessage({
        type: 'confirm',
        message: `Delete “${ev?.name}”? It starts ${starts.map((c) => c.name).join(', ')}, which would start with the first event instead.`,
        then: { type: 'deleteEvent', id }
      })
      return
    }
    change({ ...file, events: file.events.filter((e) => e.id !== id) })
  }
  // The host's answer to a confirm.
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const m = e.data as { type: string; id?: string }
      if (m.type === 'deleteEvent' && m.id)
        change({
          ...file,
          events: file.events.filter((x) => x.id !== m.id),
          clocks: file.clocks.map((c) => (c.startedBy === m.id ? strip({ ...c, startedBy: undefined, at: undefined }) : c))
        })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })

  const markdown = (): string => toMarkdown(file)

  return (
    <div className="tool-page wide timeline-page">
      <div className="timeline-head">
        <input
          className="timeline-title"
          defaultValue={file.title ?? ''}
          key={file.title ?? ''}
          placeholder="Title"
          aria-label="Title"
          id="timelineTitle"
          onBlur={(e) => e.target.value !== (file.title ?? '') && change(strip({ ...file, title: e.target.value || undefined }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="timeline-actions">
          <button onClick={() => vs.postMessage({ type: 'copy', text: markdown() })} id="copyMarkdown">
            Copy as Markdown
          </button>
          <button onClick={() => vs.postMessage({ type: 'export', text: markdown() })} id="exportMarkdown">
            Save as Markdown…
          </button>
        </span>
      </div>

      <h3>Clocks</h3>
      <div className="timeline-clocks">
        {file.clocks.map((c, i) => (
          <ClockRow
            key={c.id}
            clock={c}
            events={file.events}
            set={(p) => setClock(c.id, p)}
            up={() => change({ ...file, clocks: move(file.clocks, i, -1) })}
            down={() => change({ ...file, clocks: move(file.clocks, i, 1) })}
            remove={() => change({ ...file, clocks: file.clocks.filter((x) => x.id !== c.id) })}
          />
        ))}
        <p className="timeline-add">
          Add a clock:{' '}
          {(['ship', 'local', 'duration', 'countdown'] as const).map((k) => (
            <button key={k} className="link" onClick={() => addClock(k)} data-add-clock={k}>
              {KIND_LABEL[k].toLowerCase()}
            </button>
          ))}
        </p>
      </div>

      <h3>Events</h3>
      <div className="timeline-table-wrap">
        <table className="timeline-table" id="timelineTable">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Event</th>
              <th>Lasts</th>
              <th title="Starts when the event before it starts, not when it ends">With the one before</th>
              {file.clocks.map((c) => (
                <th key={c.id} className="clock-col">
                  {c.name}
                </th>
              ))}
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sched.map((s, i) => {
              const starts = file.clocks.filter((c) => c.startedBy === s.event.id)
              return (
                <tr key={s.event.id} data-event={s.event.id}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <Cell value={s.event.name} onCommit={(name) => setEvent(s.event.id, { name })} label="Event" />
                    {starts.length > 0 && (
                      <span className="timeline-starts small">
                        starts {starts.map((c) => `${c.name}${c.at === 'end' ? ' (at its end)' : ''}`).join(', ')}
                      </span>
                    )}
                  </td>
                  <td>
                    <Cell
                      value={s.event.duration}
                      onCommit={(t) => {
                        const d = parseDuration(t)
                        if (d === null || d < 0) return false
                        setEvent(s.event.id, { duration: formatDuration(d) })
                      }}
                      label="Lasts"
                      mono
                      invalid={s.bad}
                    />
                  </td>
                  <td className="center">
                    {i > 0 && (
                      <input
                        type="checkbox"
                        checked={Boolean(s.event.with)}
                        onChange={(e) => setEvent(s.event.id, { with: e.target.checked || undefined })}
                        aria-label="Starts with the event before it"
                      />
                    )}
                  </td>
                  {file.clocks.map((c) => (
                    <td key={c.id} className="clock-col mono" title={`At its end: ${reading(c, s.end, sched)}`}>
                      {reading(c, s.start, sched)}
                    </td>
                  ))}
                  <td>
                    <Cell
                      value={s.event.notes ?? ''}
                      onCommit={(notes) => setEvent(s.event.id, { notes: notes || undefined })}
                      label="Notes"
                    />
                  </td>
                  <td className="row-actions">
                    <button className="link" title="Move up" onClick={() => change({ ...file, events: move(file.events, i, -1) })}>
                      ↑
                    </button>
                    <button className="link" title="Move down" onClick={() => change({ ...file, events: move(file.events, i, 1) })}>
                      ↓
                    </button>
                    <button className="link" title="Add an event after this one" onClick={() => addEvent(i)} data-add-after={s.event.id}>
                      +
                    </button>
                    <button className="link danger" title="Delete" onClick={() => removeEvent(s.event.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td className="muted">Ends</td>
              <td className="mono muted">{formatDuration(ended)}</td>
              <td />
              {file.clocks.map((c) => (
                <td key={c.id} className="clock-col mono muted">
                  {reading(c, ended, sched)}
                </td>
              ))}
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <button onClick={() => addEvent(file.events.length - 1)} id="addEvent">
        Add an event
      </button>
      <p className="muted small">
        Durations are written <code>0d 0h 4m 0s</code> (also <code>4m</code>, <code>1h 30m</code>, <code>90s</code>, <code>2.5h</code>);
        hours are always 60 minutes. Each clock shows what it reads as the event starts; hover for its end.
      </p>
    </div>
  )
}

function ClockRow({
  clock: c,
  events,
  set,
  up,
  down,
  remove
}: {
  clock: Clock
  events: TimelineEvent[]
  set(p: Partial<Clock>): void
  up(): void
  down(): void
  remove(): void
}): React.JSX.Element {
  const timeOfDay = c.kind === 'ship' || c.kind === 'local'
  const day = perDay(c) * 3600
  return (
    <div className="timeline-clock" data-clock={c.id}>
      <div className="field-row">
        <label className="field">
          Name
          <Cell value={c.name} onCommit={(name) => name.trim() && set({ name: name.trim() })} label="Clock name" />
        </label>
        <label className="field">
          Kind
          <select value={c.kind} onChange={(e) => set(kindChange(c, e.target.value as ClockKind, events))}>
            {(['ship', 'local', 'duration', 'countdown'] as const).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {timeOfDay && (
          <>
            <label className="field">
              Reads at the start
              <Cell
                value={formatFace(clockStart(c), perDay(c))}
                onCommit={(t) => {
                  const s = parseDuration(t, { day })
                  if (s === null) return false
                  set({ start: writeReading(s, perDay(c)) })
                }}
                label="Reads at the start"
                mono
              />
            </label>
            <span className="field">
              Slide it
              <DateScrubber
                now={clockStart(c)}
                setNow={(s) => set({ start: writeReading(s, perDay(c)) })}
                day={day}
                label={`Slide ${c.name}`}
                id={`slide-${c.id}`}
              />
            </span>
          </>
        )}
        {c.kind === 'local' && (
          <>
            <label className="field">
              Its hour, in standard hours
              <Cell
                value={String(c.hour_h ?? 1)}
                onCommit={(t) => {
                  const h = Number(t)
                  if (!(h > 0)) return false
                  set({ hour_h: h })
                }}
                label="Local hour"
                mono
              />
            </label>
            <label className="field">
              Hours a day
              <Cell
                value={String(c.hoursPerDay ?? 24)}
                onCommit={(t) => {
                  const h = Number(t)
                  if (!(h > 0)) return false
                  set({ hoursPerDay: h === 24 ? undefined : h })
                }}
                label="Hours a day"
                mono
              />
            </label>
          </>
        )}
        {!timeOfDay && (
          <>
            <label className="field">
              Started by
              <select value={c.startedBy ?? ''} onChange={(e) => set({ startedBy: e.target.value || undefined })}>
                <option value="">the first event</option>
                {events.map((e, i) => (
                  <option key={e.id} value={e.id}>
                    {i + 1}. {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              At its
              <select value={c.at ?? 'start'} onChange={(e) => set({ at: e.target.value === 'end' ? 'end' : undefined })}>
                <option value="start">start</option>
                <option value="end">end</option>
              </select>
            </label>
          </>
        )}
        {c.kind === 'countdown' && (
          <label className="field">
            From
            <Cell
              value={c.length ?? '0d 0h 0m 0s'}
              onCommit={(t) => {
                const d = parseDuration(t)
                if (d === null || d < 0) return false
                set({ length: formatDuration(d) })
              }}
              label="Counts down from"
              mono
            />
          </label>
        )}
        <span className="row-actions">
          <button className="link" title="Move left" onClick={up}>
            ←
          </button>
          <button className="link" title="Move right" onClick={down}>
            →
          </button>
          <button className="link danger" title="Delete this clock" onClick={remove}>
            ×
          </button>
        </span>
      </div>
    </div>
  )
}

/** Changing a clock's kind: keep what still applies, give it what it now needs. */
function kindChange(c: Clock, kind: ClockKind, events: TimelineEvent[]): Partial<Clock> {
  const timeOfDay = kind === 'ship' || kind === 'local'
  return {
    kind,
    name: c.name === KIND_LABEL[c.kind] ? KIND_LABEL[kind] : c.name,
    start: timeOfDay ? (c.start ?? '0d 0h 0m 0s') : undefined,
    hour_h: kind === 'local' ? (c.hour_h ?? 1) : undefined,
    hoursPerDay: kind === 'local' ? c.hoursPerDay : undefined,
    startedBy: timeOfDay ? undefined : (c.startedBy ?? events[0]?.id),
    at: timeOfDay ? undefined : c.at,
    length: kind === 'countdown' ? (c.length ?? '0d 0h 30m 0s') : undefined
  }
}

/** A text box that commits on Enter or leaving it; `onCommit` returning false marks the text as not taken. */
function Cell({
  value,
  onCommit,
  label,
  mono,
  invalid
}: {
  value: string
  onCommit(text: string): boolean | void | '' | undefined
  label: string
  mono?: boolean
  invalid?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setDraft(value)
    setBad(false)
  }, [value])
  const commit = (): void => {
    if (draft === value) return setBad(false)
    setBad(onCommit(draft) === false)
  }
  return (
    <input
      className={`timeline-cell${mono ? ' mono' : ''}${bad || invalid ? ' invalid' : ''}`}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          setDraft(value)
          setBad(false)
        }
      }}
    />
  )
}

/** Drop keys set to undefined, so the file doesn't carry them. */
function strip<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

createRoot(document.getElementById('root')!).render(<Root />)
