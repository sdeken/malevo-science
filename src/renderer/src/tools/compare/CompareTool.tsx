import { useState } from 'react'
import type { CompareEntry, CompareReport } from '../../../../shared/types'
import { useFormatted } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * Forks and comparisons (docs/PLAN.md §3.6): try a what-if in a copy, then
 * see exactly what differs, including what moves on the timeline because of
 * it, and take back the pieces you want. Taking is an unsaved edit like any other.
 */
function CompareView({ world, snapshot, displayCal }: ToolProps): React.JSX.Element {
  const [report, setReport] = useState<CompareReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forked, setForked] = useState<string | null>(null)

  const run = async (dir: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setReport(await window.malevo.world.compare(dir))
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }

  const choose = async (): Promise<void> => {
    const dir = await window.malevo.world.chooseFolder('compare')
    if (dir) await run(dir)
  }

  const take = async (keys: string[]): Promise<void> => {
    if (!report) return
    await window.malevo.world.take(report.otherRoot, keys)
    await run(report.otherRoot)
  }

  const fork = async (): Promise<void> => {
    if (
      snapshot.dirty.length &&
      !window.confirm('The fork copies the saved world. Your unsaved changes stay here and are not copied. Fork anyway?')
    )
      return
    const dir = await window.malevo.world.chooseFolder('fork')
    if (!dir) return
    const result = await window.malevo.world.fork(dir)
    if (!result.ok) setError(result.message)
    else setForked(result.world.root)
  }

  return (
    <div className="tool-page wide">
      <h1>Fork and compare</h1>
      <p className="muted">
        Fork this world to try something out in a copy, then compare the two. Comparing shows every file that differs, field by field, and
        which events land at a different time because of it. You can take any piece back into this world as an unsaved change.
      </p>
      <div className="toolbar">
        <button onClick={() => void fork()} id="forkWorld">
          Fork this world…
        </button>
        <button className="primary" onClick={() => void choose()} disabled={busy} id="compareWorld">
          Compare with another world…
        </button>
        {report && (
          <button onClick={() => void run(report.otherRoot)} disabled={busy}>
            Compare again
          </button>
        )}
      </div>
      {forked && (
        <p className="ok">
          Forked to <code>{forked}</code>.{' '}
          <button className="link" onClick={() => void window.malevo.world.open(forked)}>
            Open the fork
          </button>{' '}
          or{' '}
          <button className="link" onClick={() => void run(forked)}>
            compare with it
          </button>
          .
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {report && <Report report={report} here={world.name} displayCal={displayCal} version={snapshot.version} take={take} />}
    </div>
  )
}

function Report({
  report,
  here,
  displayCal,
  version,
  take
}: {
  report: CompareReport
  here: string
  displayCal: string | null
  version: number
  take(keys: string[]): Promise<void>
}): React.JSX.Element {
  const same = !report.added.length && !report.removed.length && !report.changed.length && !report.unreadable.length
  const times = report.timeChanges
    .flatMap((c) => [c.startHere, c.startThere, c.endHere, c.endThere])
    .map((t) => ({ t: t ?? 0, precision: 'day' }))
  const formatted = useFormatted(displayCal, times, version)
  const fmt = (i: number, t: number | null): string => (t === null ? '—' : (formatted[i] ?? '…'))
  const all = [...report.added, ...report.removed, ...report.changed].map((e) => e.key)

  return (
    <div className="compare-report" data-compared={report.otherRoot}>
      <h2>
        “{here}” (this world) compared with “{report.otherName}”
      </h2>
      <p className="muted small">
        <code>{report.otherRoot}</code>
      </p>
      {same ? (
        <p className="ok">The two worlds hold the same entities with the same values.</p>
      ) : (
        <button onClick={() => void take(all)}>Take everything from “{report.otherName}”</button>
      )}
      <Section title={`Only in “${report.otherName}”`} entries={report.added} action="Add here" take={take} />
      <Section title="Only in this world" entries={report.removed} action="Remove here" take={take} />
      <Section title="Changed" entries={report.changed} action="Take theirs" take={take} />
      {report.unreadable.length > 0 && (
        <p className="warning">
          These differ but one side has file errors, so they cannot be compared field by field: {report.unreadable.join(', ')}
        </p>
      )}
      {report.timeChanges.length > 0 && (
        <>
          <h3>Events at a different time</h3>
          <table className="diff-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Here</th>
                <th>There</th>
              </tr>
            </thead>
            <tbody>
              {report.timeChanges.map((c, i) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    {fmt(i * 4, c.startHere)}
                    {c.endHere !== null || c.endThere !== null ? ` → ${fmt(i * 4 + 2, c.endHere)}` : ''}
                  </td>
                  <td>
                    {fmt(i * 4 + 1, c.startThere)}
                    {c.endHere !== null || c.endThere !== null ? ` → ${fmt(i * 4 + 3, c.endThere)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  entries,
  action,
  take
}: {
  title: string
  entries: CompareEntry[]
  action: string
  take(keys: string[]): Promise<void>
}): React.JSX.Element | null {
  if (!entries.length) return null
  return (
    <>
      <h3>{title}</h3>
      <ul className="diff-list">
        {entries.map((e) => (
          <li key={e.key} data-diff={e.key}>
            <div className="diff-head">
              <span>
                <span className="muted">{e.label}</span> {e.name} <code className="muted small">{e.path}</code>
              </span>
              <button className="link" onClick={() => void take([e.key])}>
                {action}
              </button>
            </div>
            {e.fields && (
              <table className="diff-table">
                <tbody>
                  {e.fields.map((f) => (
                    <tr key={f.field}>
                      <td>
                        <code>{f.field}</code>
                      </td>
                      <td className="diff-before">{show(f.before)}</td>
                      <td className="diff-after">{show(f.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

const show = (v: unknown): string => (v === undefined ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v))

export const compareTool: ToolDefinition = {
  id: 'compare',
  title: 'Fork & compare',
  description: 'Try a what-if in a copy, see what differs, and take pieces back',
  View: CompareView
}
