import { useState } from 'react'
import type { FolderInfo } from '../../../shared/types'

interface Props {
  onCancel: () => void
  onCreate: (dir: string, name: string) => Promise<string | null>
}

/** Name a new world and pick an empty folder for it. */
export function NewWorldDialog({ onCancel, onCreate }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [dir, setDir] = useState<string | null>(null)
  const [folder, setFolder] = useState<FolderInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const choose = async (): Promise<void> => {
    const picked = await window.malevo.world.chooseFolder('create')
    if (!picked) return
    setDir(picked)
    setFolder(await window.malevo.world.inspect(picked))
    setError(null)
  }

  const folderOk = folder?.kind === 'empty' || folder?.kind === 'missing'
  const canCreate = name.trim().length > 0 && dir !== null && folderOk && !working

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canCreate || !dir) return
    setWorking(true)
    const failure = await onCreate(dir, name)
    setWorking(false)
    if (failure) setError(failure)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>New world</h2>
        <label>
          Name
          <input id="worldName" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Scratch" maxLength={200} />
        </label>
        <div className="field">
          <span>Folder</span>
          <div className="folder-pick">
            <code className="folder-path">{dir ?? 'No folder chosen'}</code>
            <button type="button" onClick={() => void choose()}>
              Choose…
            </button>
          </div>
          {folder && !folderOk && <p className="error">{folderProblem(folder)}</p>}
          <p className="muted small">The folder must be empty. The new world gets one file, world.json, with a random seed.</p>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!canCreate}>
            Create world
          </button>
        </div>
      </form>
    </div>
  )
}

function folderProblem(info: FolderInfo): string {
  switch (info.kind) {
    case 'world':
      return `That folder already holds a world ("${info.name}"). Use Open world instead.`
    case 'invalid':
      return `That folder already holds a world.json: ${info.message}`
    default:
      return 'That folder is not empty. Choose or create an empty folder.'
  }
}
