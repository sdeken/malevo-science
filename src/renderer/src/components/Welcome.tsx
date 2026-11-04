import { useEffect, useState } from 'react'
import type { FolderInfo } from '../../../shared/types'

interface Props {
  recent: string[]
  onNew: () => void
  onOpen: () => void
  onOpenPath: (dir: string) => void
  onForget: (dir: string) => void
}

/** Shown when no world is open. */
export function Welcome({ recent, onNew, onOpen, onOpenPath, onForget }: Props): React.JSX.Element {
  const [status, setStatus] = useState<Record<string, FolderInfo>>({})

  useEffect(() => {
    let live = true
    void Promise.all(recent.map(async (dir) => [dir, await window.malevo.world.inspect(dir)] as const)).then((pairs) => {
      if (live) setStatus(Object.fromEntries(pairs))
    })
    return () => {
      live = false
    }
  }, [recent])

  return (
    <div className="welcome">
      <h1>Malevo Science</h1>
      <p className="muted">A world is a folder of plain JSON files. The app never commits them anywhere; that part is yours.</p>
      <div className="welcome-actions">
        <button className="primary" onClick={onNew}>
          New world…
        </button>
        <button onClick={onOpen}>Open world…</button>
      </div>
      {recent.length > 0 && (
        <section className="recent">
          <h2>Recent worlds</h2>
          <ul>
            {recent.map((dir) => {
              const info = status[dir]
              const usable = info?.kind === 'world'
              return (
                <li key={dir}>
                  <button className="recent-open" disabled={info !== undefined && !usable} onClick={() => onOpenPath(dir)} title={dir}>
                    <span className="recent-name">{info?.kind === 'world' ? info.name : basename(dir)}</span>
                    <span className="recent-path">{dir}</span>
                    {info && !usable && <span className="recent-problem">{problem(info)}</span>}
                  </button>
                  <button className="link" title="Remove from this list (the folder is not touched)" onClick={() => onForget(dir)}>
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function problem(info: FolderInfo): string {
  switch (info.kind) {
    case 'missing':
      return 'Folder not found'
    case 'invalid':
      return info.message
    default:
      return 'Not a world folder'
  }
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}
