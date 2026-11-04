import { useState } from 'react'
import type { WorldSnapshot } from '../../../shared/types'
import { useFormattedOne } from '../state'
import { DateInput } from './DateInput'

interface Props {
  snapshot: WorldSnapshot
  now: number
  setNow(t: number): void
  displayCal: string | null
  setDisplayCal(id: string): void
}

/** The global current date, which every tool follows, and the calendar dates are shown in. */
export function DateBar({ snapshot, now, setNow, displayCal, setDisplayCal }: Props): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const text = useFormattedOne(displayCal, now, 'minute', snapshot.version) ?? ''
  const usable = snapshot.calendars.filter((c) => !c.error)

  return (
    <div className="datebar">
      <span className="datebar-label">Current date</span>
      {displayCal ? (
        <DateInput
          id="currentDate"
          calendars={snapshot.calendars}
          cal={displayCal}
          text={text}
          onCalendarChange={setDisplayCal}
          onCommit={(d) => setNow(d.t)}
        />
      ) : (
        <span className="muted">This world has no usable calendar. Add one in Calendars.</span>
      )}
      {usable.length > 1 && (
        <button className="link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide other calendars' : 'In every calendar'}
        </button>
      )}
      {showAll && (
        <ul className="datebar-all">
          {usable.map((c) => (
            <CalendarReading key={c.id} cal={c.id} name={c.name} t={now} version={snapshot.version} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CalendarReading({ cal, name, t, version }: { cal: string; name: string; t: number; version: number }): React.JSX.Element {
  const text = useFormattedOne(cal, t, 'minute', version)
  return (
    <li>
      <span className="muted">{name}</span> <code>{text ?? '…'}</code>
    </li>
  )
}
