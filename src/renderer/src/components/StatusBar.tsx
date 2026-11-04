import type { UpdateStatus, WorldInfo, WorldSnapshot } from '../../../shared/types'

interface Props {
  world: WorldInfo | null
  snapshot: WorldSnapshot | null
  update: UpdateStatus | null
  onSave(): void
  onDiscard(): void
  onShowChecks(): void
}

export function StatusBar({ world, snapshot, update, onSave, onDiscard, onShowChecks }: Props): React.JSX.Element {
  const dirty = snapshot?.dirty.length ?? 0
  const issues = snapshot?.issueCounts
  return (
    <footer className="statusbar">
      <span className="status-world" title={world?.root}>
        {world ? world.name : 'No world open'}
      </span>
      {snapshot &&
        (dirty > 0 ? (
          <span className="status-dirty">
            <span title={snapshot.dirty.join('\n')}>
              {dirty} unsaved {dirty === 1 ? 'change' : 'changes'}
            </span>
            <button className="status-save" onClick={onSave} title="Save (Ctrl+S)">
              Save
            </button>
            <button className="link" onClick={onDiscard}>
              Discard
            </button>
          </span>
        ) : (
          <span className="status-saved">All changes saved</span>
        ))}
      {issues && (issues.error > 0 || issues.warning > 0) && (
        <button className="link status-issues" onClick={onShowChecks}>
          {issues.error > 0 && `${issues.error} ${issues.error === 1 ? 'error' : 'errors'}`}
          {issues.error > 0 && issues.warning > 0 && ', '}
          {issues.warning > 0 && `${issues.warning} ${issues.warning === 1 ? 'warning' : 'warnings'}`}
        </button>
      )}
      <span className="spacer" />
      <UpdateIndicator update={update} />
      <span className="status-version">v{update?.currentVersion ?? ''}</span>
    </footer>
  )
}

function UpdateIndicator({ update }: { update: UpdateStatus | null }): React.JSX.Element | null {
  if (!update) return null
  const install = (): void => void window.malevo.updates.install()
  switch (update.state) {
    case 'downloading':
      return (
        <button className="status-update" onClick={install} title="Restart into the new version as soon as it has downloaded">
          {update.installRequested
            ? `Downloading ${update.availableVersion}… ${update.progress ?? 0}%, restarts when done`
            : `Downloading ${update.availableVersion}… ${update.progress ?? 0}%`}
        </button>
      )
    case 'downloaded':
      return (
        <button className="status-update ready" onClick={install}>
          Update now to {update.availableVersion}
        </button>
      )
    case 'installing':
      return <span className="status-update">Restarting into {update.availableVersion}…</span>
    case 'error':
      return (
        <span className="status-update error" title={update.error ?? ''}>
          Update check failed
        </span>
      )
    default:
      return null
  }
}
