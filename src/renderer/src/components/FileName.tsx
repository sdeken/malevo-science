import { useState } from 'react'
import type { EditableKind } from '../../../shared/types'
import { slugId } from '../state'

/**
 * Which file an entity lives in, and a way to rename it. Ids name the files, so a placeholder id
 * ("sol-8") outlives a placeholder name unless it's changed here; references to it are rewritten.
 */
export function FileName({
  kind,
  folder,
  id,
  name,
  taken,
  origin,
  onRenamed
}: {
  kind: EditableKind
  folder: string
  id: string
  name: string
  /** Ids already used by this kind. */
  taken: readonly string[]
  /** Built into the app (no file until changed), or a file standing in for a built-in. */
  origin?: 'builtin' | 'override'
  onRenamed(newId: string): void
}): React.JSX.Element {
  const others = taken.filter((t) => t !== id)
  const suggested = slugId(name, others)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(id)
  const [error, setError] = useState<string | null>(null)
  const rename = async (to: string): Promise<void> => {
    setError(null)
    const r = await window.malevo.world.renameEntity(kind, id, to)
    if ('error' in r) return setError(r.error)
    setEditing(false)
    onRenamed(to)
  }
  return (
    <div className="file-name muted small" data-file-name={id}>
      <span>
        {origin === 'builtin' ? (
          <span title="Real astronomy, built into the app. A file is written only when you change it.">
            Built in: no file until it is changed (<code>{`${folder}/${id}.json`}</code>)
          </span>
        ) : (
          <>
            File: <code>{`${folder}/${id}.json`}</code>
            {origin === 'override' && ' (changes a built-in)'}
          </>
        )}
      </span>
      {origin === 'override' && !editing && (
        <button
          className="link"
          id={`resetBuiltin-${id}`}
          onClick={() => void window.malevo.world.resetBuiltin(kind, id)}
          title="Delete the file, so the built-in shows through again"
        >
          Reset to built-in
        </button>
      )}
      {!editing && suggested !== id && (
        <button
          className="link"
          onClick={() => void rename(suggested)}
          id={`renameTo-${id}`}
          title="Rename the file (and its note) and update every reference"
        >
          Rename to <code>{suggested}</code>
        </button>
      )}
      {!editing ? (
        <button
          className="link"
          onClick={() => {
            setDraft(id)
            setEditing(true)
          }}
        >
          Change…
        </button>
      ) : (
        <form
          className="file-name-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim() && draft.trim() !== id) void rename(draft.trim())
            else setEditing(false)
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New file name (id)" autoFocus />
          <button type="submit">Rename</button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  )
}
