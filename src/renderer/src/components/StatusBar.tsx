import type { UpdateStatus, WorldInfo } from '../../../shared/types'

interface Props {
  world: WorldInfo | null
  update: UpdateStatus | null
}

export function StatusBar({ world, update }: Props): React.JSX.Element {
  return (
    <footer className="statusbar">
      <span className="status-world" title={world?.root}>
        {world ? world.name : 'No world open'}
      </span>
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
