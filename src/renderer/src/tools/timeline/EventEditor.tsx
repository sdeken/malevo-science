import { useEffect, useState } from 'react'
import type { CalendarInfo, EventInfo, EventValue, WhenValue } from '../../../../shared/types'
import { WhenEditor } from './WhenEditor'

interface Props {
  event: EventInfo
  events: EventInfo[]
  calendars: CalendarInfo[]
  displayCal: string
  now: number
  setNow(t: number): void
  version: number
  onDeleted(): void
}

/** Edit one event. Every change is an unsaved, undoable edit; nothing is written until Save. */
export function EventEditor({ event, events, calendars, displayCal, now, setNow, version, onDeleted }: Props): React.JSX.Element {
  const value = event.value
  const [name, setName] = useState(value?.name ?? '')
  const [tags, setTags] = useState((value?.tags ?? []).join(', '))
  useEffect(() => {
    setName(value?.name ?? '')
    setTags((value?.tags ?? []).join(', '))
  }, [value?.name, value?.tags])

  if (!value) {
    return (
      <div className="inspector">
        <h2>{event.id}</h2>
        <p className="error">This event's file has errors, so it cannot be edited here. See Checks, or fix {event.path} by hand.</p>
      </div>
    )
  }

  const save = (patch: Partial<EventValue>): void => {
    const next: EventValue = { ...value, ...patch }
    if (!next.tags?.length) delete next.tags
    if (!next.until) delete next.until
    void window.malevo.world.setEntity('event', event.id, next)
  }
  const anchors = events.filter((e) => e.id !== event.id)
  const dependents = events.filter((e) => e.value?.when.after === event.id || e.value?.until?.after === event.id)

  const remove = (): void => {
    const lines = dependents.map((d) => `• ${d.value?.name ?? d.id}`).join('\n')
    const message = dependents.length
      ? `Delete "${value.name}"?\n\nThese events are anchored to it and will show errors until you re-anchor them:\n${lines}`
      : `Delete "${value.name}"?`
    if (!window.confirm(message)) return
    void window.malevo.world.deleteEntity('event', event.id).then(onDeleted)
  }

  return (
    <div className="inspector" data-editing={event.id}>
      <label className="field">
        Name
        <input
          id="eventName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== value.name && save({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <div className="field-row">
        <label className="field">
          Kind
          <select value={value.type} onChange={(e) => save({ type: e.target.value as EventValue['type'] })}>
            <option value="event">Event</option>
            <option value="period">Period</option>
            <option value="story">Story</option>
          </select>
        </label>
        <label className="field grow">
          Tags
          <input
            value={tags}
            placeholder="politics, travel"
            onChange={(e) => setTags(e.target.value)}
            onBlur={() =>
              save({
                tags: [
                  ...new Set(
                    tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  )
                ]
              })
            }
          />
        </label>
      </div>

      {event.errors.map((m) => (
        <p key={m} className="error">
          {m}
        </p>
      ))}
      {event.warnings.map((m) => (
        <p key={m} className="warning">
          {m}
        </p>
      ))}

      <WhenEditor
        label={value.type === 'event' ? 'When' : 'Starts'}
        when={value.when}
        onChange={(w: WhenValue) => save({ when: w })}
        calendars={calendars}
        anchors={anchors}
        resolved={event.start}
        displayCal={displayCal}
        now={now}
        version={version}
      />
      {value.until ? (
        <>
          <WhenEditor
            label="Ends"
            when={value.until}
            onChange={(w: WhenValue) => save({ until: w })}
            calendars={calendars}
            anchors={[event, ...anchors]}
            resolved={event.end}
            displayCal={displayCal}
            now={now}
            version={version}
          />
          <button className="link" onClick={() => save({ until: undefined })}>
            Remove the end
          </button>
        </>
      ) : (
        <button
          onClick={() =>
            save({
              until: {
                after: event.id,
                cal: displayCal,
                offset: { [calendars.find((c) => c.id === displayCal)?.units[0]?.name ?? 'year']: 1 }
              }
            })
          }
        >
          Add an end
        </button>
      )}

      <div className="inspector-actions">
        {event.start && <button onClick={() => setNow(event.start!.t)}>Go to its date</button>}
        <button className="danger" onClick={remove}>
          Delete…
        </button>
      </div>
      <p className="muted small">
        Saved as <code>{event.path}</code>
      </p>
    </div>
  )
}
