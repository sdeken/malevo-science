import { historyAt } from '@malevo/model'
import type { SystemInfoDto, WhenValue, WorldSnapshot } from '../../../../shared/types'
import { sig } from '../../components/fields'
import { WhenEditor } from '../timeline/WhenEditor'

type Entry = { from: WhenValue; polity?: string; cultures?: { culture: string; share: number }[]; note?: string }

/**
 * Who held a system and who lived there, over time. Each entry holds from its
 * date until the next one; dates work like event dates (a date in any
 * calendar, or anchored to an event).
 */
export function HistoryEditor({
  system,
  snapshot,
  now,
  displayCal
}: {
  system: SystemInfoDto
  snapshot: WorldSnapshot
  now: number
  displayCal: string
}): React.JSX.Element {
  const entries = ((system.value.history as Entry[] | undefined) ?? []).map((e) => ({ ...e }))
  const save = (next: Entry[]): void =>
    void window.malevo.world.setEntity('system', system.id, { ...system.value, history: next.length ? next : undefined })
  const set = (i: number, patch: Partial<Entry>): void => save(entries.map((e, k) => (k === i ? clean({ ...e, ...patch }) : e)))
  const current = historyAt(system.history, now)
  const name = (kind: 'polities' | 'cultures', id: string): string => String(snapshot[kind].find((x) => x.id === id)?.value?.name ?? id)

  const add = (): void => {
    const last = entries[entries.length - 1]
    save([
      ...entries,
      {
        from: { at: { t_s: now, cal: displayCal } },
        ...(last?.polity ? { polity: last.polity } : {}),
        ...(last?.cultures ? { cultures: last.cultures } : {})
      }
    ])
  }

  return (
    <div className="history-editor">
      <h3>History</h3>
      <p className="small">
        {current ? (
          <>
            At the current date: {current.polity ? <strong>{name('polities', current.polity)}</strong> : 'no polity'}
            {current.cultures.length > 0 && (
              <> · {current.cultures.map((c) => `${name('cultures', c.culture)} ${sig(c.share * 100, 2)}%`).join(', ')}</>
            )}
          </>
        ) : (
          <span className="muted">
            {entries.length ? 'At the current date its history has not begun.' : 'No history yet: who settles it, who holds it, when.'}
          </span>
        )}
      </p>
      {system.history.map((h) => {
        const e = entries[h.index]
        return (
          <div key={h.index} className="history-entry" data-history={h.index}>
            <WhenEditor
              label={`From${h.t === null ? ' (cannot be worked out)' : ''}`}
              when={e.from}
              onChange={(from) => set(h.index, { from })}
              calendars={snapshot.calendars}
              anchors={snapshot.events}
              resolved={h.t === null ? null : { t: h.t, cal: null, precision: null, circa: false, range: [h.t, h.t] }}
              displayCal={displayCal}
              now={now}
              version={snapshot.version}
            />
            <div className="field-row">
              <label className="field">
                Held by
                <select value={e.polity ?? ''} onChange={(ev) => set(h.index, { polity: ev.target.value || undefined })}>
                  <option value="">(no polity)</option>
                  {snapshot.polities.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.value?.name ?? p.id)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <table className="units">
              <tbody>
                {(e.cultures ?? []).map((c, k) => (
                  <tr key={k}>
                    <td>
                      <select
                        value={c.culture}
                        onChange={(ev) =>
                          set(h.index, { cultures: (e.cultures ?? []).map((x, j) => (j === k ? { ...x, culture: ev.target.value } : x)) })
                        }
                      >
                        {snapshot.cultures.map((cu) => (
                          <option key={cu.id} value={cu.id}>
                            {String(cu.value?.name ?? cu.id)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={c.share}
                        onBlur={(ev) =>
                          set(h.index, {
                            cultures: (e.cultures ?? []).map((x, j) =>
                              j === k ? { ...x, share: Math.max(0, Number(ev.target.value) || 0) } : x
                            )
                          })
                        }
                        aria-label="Share"
                      />
                    </td>
                    <td className="muted small">{sig((h.cultures.find((x) => x.culture === c.culture)?.share ?? 0) * 100, 2)}%</td>
                    <td>
                      <button className="link" onClick={() => set(h.index, { cultures: (e.cultures ?? []).filter((_, j) => j !== k) })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inspector-actions">
              {snapshot.cultures.length > 0 && (
                <button
                  className="link"
                  onClick={() => set(h.index, { cultures: [...(e.cultures ?? []), { culture: snapshot.cultures[0].id, share: 1 }] })}
                >
                  Add a culture
                </button>
              )}
              <button className="link danger" onClick={() => save(entries.filter((_, k) => k !== h.index))}>
                Remove this entry
              </button>
            </div>
            {h.errors.map((m) => (
              <p key={m} className="error small">
                {m}
              </p>
            ))}
          </div>
        )
      })}
      <button onClick={add} id="addHistory">
        Add a history entry at the current date
      </button>
    </div>
  )
}

function clean(e: Entry): Entry {
  const out: Entry = { from: e.from }
  if (e.polity) out.polity = e.polity
  if (e.cultures?.length) out.cultures = e.cultures
  if (e.note) out.note = e.note
  return out
}
