import { useCallback, useEffect, useState } from 'react'
import type { CheckIssue, CheckReport } from '../../../../shared/types'
import type { ToolDefinition, ToolProps } from '../registry'

const LABEL: Record<CheckIssue['severity'], string> = { error: 'Error', warning: 'Warning', info: 'Note' }

function ChecksView({ world }: ToolProps): React.JSX.Element {
  const [report, setReport] = useState<CheckReport | null>(null)
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [fixed, setFixed] = useState<string[] | null>(null)
  const [added, setAdded] = useState<string[] | null>(null)

  const runChecks = useCallback(async () => {
    setRunning(true)
    setReport(await window.malevo.world.check())
    setRunning(false)
  }, [])

  useEffect(() => {
    setFixed(null)
    setAdded(null)
    void runChecks()
  }, [world.root, runChecks])

  const addTemplate = async (): Promise<void> => {
    setAdded(await window.malevo.world.addTemplate())
    await runChecks()
  }

  const fix = async (): Promise<void> => {
    if (!report) return
    setConfirming(false)
    setFixed(await window.malevo.world.fix(report.fixable))
    await runChecks()
  }

  const counts = (s: CheckIssue['severity']): number => report?.issues.filter((i) => i.severity === s).length ?? 0

  return (
    <div className="tool-page">
      <h1>Checks</h1>
      <p className="muted">
        Reads every file in the world and reports what does not add up. Nothing here is a blocker: a half-finished world is normal. The same
        checks run from the command line as <code>malevo check</code>.
      </p>
      <div className="checks-bar">
        <button onClick={() => void runChecks()} disabled={running}>
          {running ? 'Checking…' : 'Check again'}
        </button>
        {report && (
          <span className="checks-summary">
            {report.issues.length === 0
              ? 'No problems found.'
              : `${counts('error')} errors, ${counts('warning')} warnings, ${counts('info')} notes`}
          </span>
        )}
      </div>

      {fixed && fixed.length > 0 && (
        <p className="ok">Rewrote {fixed.length === 1 ? '1 file' : `${fixed.length} files`} in canonical form.</p>
      )}

      {added && added.length > 0 && <p className="ok">Added {added.join(', ')}.</p>}

      {report?.issues.some((i) => i.code === 'no-physics') && (
        <div className="checks-fix">
          <p>This world was made before worlds came with physics settings. Add the starting copy from the new-world template?</p>
          <button className="primary" onClick={() => void addTemplate()}>
            Add missing template files
          </button>
        </div>
      )}

      {report && report.fixable.length > 0 && (
        <div className="checks-fix">
          {confirming ? (
            <>
              <p>
                These files will be rewritten in canonical form. Their values do not change; only key order, number precision and layout do:
              </p>
              <ul>
                {report.fixable.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
              <div className="modal-actions">
                <button onClick={() => setConfirming(false)}>Cancel</button>
                <button className="primary" onClick={() => void fix()}>
                  Rewrite {report.fixable.length === 1 ? '1 file' : `${report.fixable.length} files`}
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}>
              Put {report.fixable.length === 1 ? '1 file' : `${report.fixable.length} files`} in canonical form…
            </button>
          )}
        </div>
      )}

      {report && report.issues.length > 0 && (
        <ul className="issue-list">
          {report.issues.map((i, k) => (
            <li key={k} className={`issue issue-${i.severity}`}>
              <span className="issue-severity">{LABEL[i.severity]}</span>
              <span className="issue-where">
                {i.path ? <code>{i.path}</code> : 'World'}
                {i.field && <span className="muted"> › {i.field}</span>}
              </span>
              <span className="issue-message">{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const checksTool: ToolDefinition = {
  id: 'checks',
  title: 'Checks',
  description: 'What does not add up in this world, and canonical formatting',
  View: ChecksView
}
