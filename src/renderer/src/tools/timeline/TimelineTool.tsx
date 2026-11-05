import { useEffect, useMemo, useState } from 'react'
import type { EventInfo } from '../../../../shared/types'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { EventEditor } from './EventEditor'
import { TimelineCanvas, fitView, type View } from './TimelineCanvas'

function TimelineView({ world, snapshot, now, setNow, displayCal }: ToolProps): React.JSX.Element {
  const events = snapshot.events
  const [stored, setView] = useWorldPref<View | null>(world.root, 'timelineView', null)
  const view = stored ?? fitView(events, now)
  // Keep the first fitted view, so the timeline does not jump while events are edited; "Fit" re-fits on demand.
  useEffect(() => {
    if (stored === null && events.some((e) => e.start)) setView(fitView(events, now))
  }, [stored, events, now, setView])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'' | 'event' | 'period' | 'story'>('')
  const [tag, setTag] = useState('')

  const allTags = useMemo(() => [...new Set(events.flatMap((e) => e.value?.tags ?? []))].sort(), [events])
  const shown = useMemo(
    () =>
      events.filter((e) => {
        const v = e.value
        if (type && v?.type !== type) return false
        if (tag && !(v?.tags ?? []).includes(tag)) return false
        if (query && !(v?.name ?? e.id).toLowerCase().includes(query.toLowerCase())) return false
        return true
      }),
    [events, type, tag, query]
  )
  const unplaced = shown.filter((e) => !e.start)
  const current = events.find((e) => e.id === selected) ?? null

  const addEvent = async (): Promise<void> => {
    if (!displayCal) return
    const [text] = await window.malevo.calendar.format(displayCal, [{ t: now, precision: 'day' }])
    const parsed = text ? await window.malevo.calendar.parse(displayCal, text) : null
    const id = slugId(
      'new event',
      events.map((e) => e.id)
    )
    await window.malevo.world.setEntity('event', id, {
      name: 'New event',
      type: 'event',
      when: { at: { t_s: parsed?.t ?? now, cal: displayCal, text: text ?? undefined } }
    })
    setSelected(id)
    if (now < view.t0 || now > view.t1) {
      const span = view.t1 - view.t0
      setView({ t0: now - span / 2, t1: now + span / 2 })
    }
  }

  if (!displayCal) {
    return (
      <div className="tool-page">
        <h1>Timeline</h1>
        <p>This world has no usable calendar yet. Add one in the Calendars tool first.</p>
      </div>
    )
  }

  return (
    <div className="timeline-tool">
      <div className="timeline-main">
        <div className="toolbar">
          <button className="primary" onClick={() => void addEvent()} id="newEvent">
            New event
          </button>
          <button onClick={() => setView(fitView(shown, now))} title="Zoom to show every event">
            Fit
          </button>
          <input className="search" placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Kind">
            <option value="">All kinds</option>
            <option value="event">Events</option>
            <option value="period">Periods</option>
            <option value="story">Stories</option>
          </select>
          {allTags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <span className="muted small">
            {shown.length} of {events.length}
          </span>
        </div>
        <TimelineCanvas
          events={shown}
          view={view}
          setView={setView}
          now={now}
          setNow={setNow}
          displayCal={displayCal}
          selected={selected}
          onSelect={setSelected}
          version={snapshot.version}
        />
        {events.length === 0 && (
          <p className="muted timeline-empty">
            No events yet. “New event” adds one at the current date; drag the red line or click the axis to move it.
          </p>
        )}
        {unplaced.length > 0 && (
          <div className="unplaced">
            <span className="muted">Not on the timeline (their time cannot be worked out):</span>
            {unplaced.map((e: EventInfo) => (
              <button key={e.id} className="link" onClick={() => setSelected(e.id)}>
                {e.value?.name ?? e.id}
              </button>
            ))}
          </div>
        )}
      </div>
      {current && (
        <EventEditor
          key={current.id}
          event={current}
          events={events}
          calendars={snapshot.calendars}
          systems={snapshot.systems.map((x) => ({ id: x.id, name: x.name }))}
          displayCal={displayCal}
          now={now}
          setNow={setNow}
          version={snapshot.version}
          onDeleted={() => setSelected(null)}
        />
      )}
    </div>
  )
}

export const timelineTool: ToolDefinition = {
  id: 'timeline',
  title: 'Timeline',
  description: 'Events, periods and stories across every calendar',
  View: TimelineView
}
