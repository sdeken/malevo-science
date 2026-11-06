import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Typography from '@tiptap/extension-typography'
import {
  CHARACTERS_DIR,
  characterText,
  nameForms,
  nameUses,
  proseFileName,
  splitFrontMatter,
  type Character,
  type NameForm,
  type NameUse
} from '@malevo/model'
import type { CharacterDto, WorldSnapshot } from '../../../../shared/types'
import { TextField } from '../../components/fields'
import { holdPendingWrite, slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { Names } from './names'

function WritingView({ world, snapshot }: ToolProps): React.JSX.Element {
  const [open, setOpen] = useWorldPref<string | null>(world.root, 'writingFile', null)
  const [side, setSide] = useState<{ kind: 'character'; id: string } | { kind: 'names'; id: string } | null>(null)
  const chars = snapshot.characters
  const forms = useMemo(() => nameForms(chars as Character[]), [chars])
  const file = snapshot.prose.find((p) => p.path === open) ?? null
  const character = side ? chars.find((c) => c.id === side.id) : undefined

  return (
    <div className="split-tool writing">
      <nav className="split-list">
        <h2>Writing</h2>
        <NewProse snapshot={snapshot} onMade={setOpen} />
        <ul id="proseList">
          {snapshot.prose.map((p) => (
            <li key={p.path}>
              <button
                className={p.path === open ? 'list-item is-current' : 'list-item'}
                onClick={() => setOpen(p.path)}
                data-prose={p.path}
              >
                <span>
                  {p.path.replace(/\.md$/, '')}
                  {p.dirty && <span className="dirty-dot" title="Unsaved changes" />}
                </span>
                <span className="muted small">{p.words.toLocaleString()} words</span>
              </button>
            </li>
          ))}
        </ul>
        <h3>Characters</h3>
        <NewCharacter snapshot={snapshot} onMade={(id) => setSide({ kind: 'character', id })} />
        <ul id="characterList">
          {chars.map((c) => (
            <li key={c.id}>
              <button
                className={side?.id === c.id ? 'list-item is-current' : 'list-item'}
                onClick={() => setSide({ kind: 'character', id: c.id })}
                data-character={c.id}
              >
                <span>
                  {c.name}
                  {c.problems.length > 0 && <span className="error small"> · {c.problems.length} problem(s)</span>}
                </span>
                <span className="muted small">{c.names.map((n) => n.name).join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="writing-main">
        {file ? (
          <ProseEditor
            key={file.path}
            path={file.path}
            forms={forms}
            version={snapshot.version}
            onName={(id) => setSide({ kind: 'character', id })}
          />
        ) : (
          <div className="tool-page">
            <h1>Writing</h1>
            <p className="muted">
              Chapters, scenes and notes are plain Markdown files in the world folder: any <code>.md</code> outside the folders the world
              format uses. Characters are <code>{CHARACTERS_DIR}/&lt;name&gt;.md</code>, with the names they go by in a short header. Pick a
              file, or start one.
            </p>
          </div>
        )}
      </div>

      {side && character && (
        <aside className="writing-side">
          <div className="seg">
            <button className={side.kind === 'character' ? 'on' : ''} onClick={() => setSide({ kind: 'character', id: side.id })}>
              Character
            </button>
            <button className={side.kind === 'names' ? 'on' : ''} onClick={() => setSide({ kind: 'names', id: side.id })} id="namesTab">
              Where the names appear
            </button>
            <button onClick={() => setSide(null)} title="Close">
              ✕
            </button>
          </div>
          {side.kind === 'character' ? (
            <CharacterEditor key={character.id + snapshot.version} character={character} all={chars} />
          ) : (
            <NamesReport character={character} forms={forms} snapshot={snapshot} onOpen={setOpen} />
          )}
        </aside>
      )}
    </div>
  )
}

// ---- the page ----

/** Write a file's text after this long without typing: one undo step in the world per pause. */
const WRITE_DELAY = 800

function ProseEditor({
  path,
  forms,
  version,
  onName
}: {
  path: string
  forms: NameForm[]
  version: number
  onName(id: string): void
}): React.JSX.Element {
  const parts = useRef<{ front: string; lead: string }>({ front: '', lead: '' })
  const last = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Nothing is ever written until the file has loaded and you have changed it. */
  const ready = useRef(false)
  const [rewrite, setRewrite] = useState<{ lines: number; before: string; after: string } | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const flush = async (): Promise<void> => {
    if (!timer.current || !editor || !ready.current) return
    clearTimeout(timer.current)
    timer.current = null
    const text = parts.current.front + parts.current.lead + editor.getMarkdown().replace(/\s+$/, '') + '\n'
    last.current = text
    await window.malevo.prose.write(path, text)
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  // Save waits for typing not yet written; leaving the window writes it too.
  useEffect(() => {
    const run = (): Promise<void> => flushRef.current()
    const off = holdPendingWrite(run)
    const onBlur = (): void => void run()
    window.addEventListener('blur', onBlur)
    return () => {
      off()
      window.removeEventListener('blur', onBlur)
      void run()
    }
  }, [])

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), Markdown, Typography, Names.configure({ forms })],
    contentType: 'markdown',
    content: '',
    editorProps: { attributes: { class: 'prose-page', spellcheck: 'true' } },
    onUpdate: ({ transaction }) => {
      if (!ready.current || !transaction.docChanged) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flushRef.current(), WRITE_DELAY)
    }
  })

  // Load the file; reload it if it changed elsewhere (undo, another tool, the disk) while we were not typing.
  useEffect(() => {
    if (!editor) return
    let live = true
    void window.malevo.prose.read(path).then((text) => {
      // Typing in progress wins over a reload; what is typed is written in a moment anyway.
      if (!live || text === null || text === last.current || timer.current) return
      ready.current = false
      const { front, body } = splitFrontMatter(text)
      const lead = /^\n*/.exec(body)![0]
      parts.current = { front, lead }
      last.current = text
      editor.commands.setContent(body.slice(lead.length), { contentType: 'markdown', emitUpdate: false })
      // Opening and saving an untouched file must leave it as it was: say so if the editor would rewrite it.
      const again = editor.getMarkdown().replace(/\s+$/, '')
      const was = body.slice(lead.length).replace(/\s+$/, '')
      if (again !== was) {
        const a = was.split('\n')
        const b = again.split('\n')
        let first = 0
        while (first < a.length && a[first] === b[first]) first++
        const differ = a.filter((l, k) => l !== b[k]).length + Math.max(0, b.length - a.length)
        setRewrite({ lines: differ, before: a[first] ?? '', after: b[first] ?? '' })
      } else setRewrite(null)
      ready.current = true
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [editor, path, version])

  useEffect(() => {
    editor?.setEditable(!rewrite || accepted)
  }, [editor, rewrite, accepted])

  useEffect(() => {
    editor?.commands.setNameForms(forms)
  }, [editor, forms])

  const words = editor ? (editor.getText().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length : 0
  return (
    <div className="prose-shell">
      <div className="prose-bar small muted">
        <code>{path}</code> · {words.toLocaleString()} words
        {parts.current.front && <span> · keeps its header as written</span>}
      </div>
      {rewrite && !accepted && (
        <div className="notice" id="rewriteNotice">
          <p>
            This file is not written quite the way the editor writes Markdown, so editing it would change{' '}
            {rewrite.lines === 1 ? '1 line' : `${rewrite.lines} lines`} you did not touch, for example:
          </p>
          <pre className="small">{`− ${rewrite.before}\n+ ${rewrite.after}`}</pre>
          <button onClick={() => setAccepted(true)}>Edit anyway</button>
        </div>
      )}
      <div
        className="prose-scroll"
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest('.name-mark') as HTMLElement | null
          if (el?.dataset.character) onName(el.dataset.character)
        }}
      >
        {loaded || <p className="muted">Opening…</p>}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

// ---- making files ----

function NewProse({ snapshot, onMade }: { snapshot: WorldSnapshot; onMade(path: string): void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const make = async (): Promise<void> => {
    const t = proseFileName(title)
    let path = `${t}.md`
    for (let k = 2; snapshot.prose.some((p) => p.path === path); k++) path = `${t} ${k}.md`
    await window.malevo.prose.write(path, `# ${title.trim() || t}\n`)
    setTitle('')
    onMade(path)
  }
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        void make()
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New chapter or note…" id="newProseTitle" />
      <button type="submit" disabled={!title.trim()} id="newProse">
        New
      </button>
    </form>
  )
}

function NewCharacter({ snapshot, onMade }: { snapshot: WorldSnapshot; onMade(id: string): void }): React.JSX.Element {
  const [name, setName] = useState('')
  const make = async (): Promise<void> => {
    const id = slugId(
      name,
      snapshot.characters.map((c) => c.id)
    )
    await window.malevo.prose.write(`${CHARACTERS_DIR}/${id}.md`, characterText({ name: name.trim(), names: [], notes: '' }))
    setName('')
    onMade(id)
  }
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        void make()
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New character…" id="newCharacterName" />
      <button type="submit" disabled={!name.trim()} id="newCharacter">
        Add
      </button>
    </form>
  )
}

// ---- characters ----

function CharacterEditor({ character, all }: { character: CharacterDto; all: CharacterDto[] }): React.JSX.Element {
  const [c, setC] = useState(character)
  const save = (next: CharacterDto): void => {
    setC(next)
    void window.malevo.prose.write(next.path, characterText(next))
  }
  const whoName = (w: string): string =>
    all.find((x) => x.id === w || x.name.toLowerCase() === w.toLowerCase())?.name ?? `${w} (no such character)`
  return (
    <div className="character-editor" id="characterEditor">
      <TextField label="Name" value={c.name} onCommit={(v) => v.trim() && save({ ...c, name: v.trim() })} id="characterName" />
      <h3>Other names</h3>
      <table className="data small">
        <thead>
          <tr>
            <th>Name</th>
            <th>Who calls them this</th>
            <th>Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {c.names.map((n, k) => (
            <tr key={k}>
              <td>
                <input
                  defaultValue={n.name}
                  onBlur={(e) =>
                    e.target.value.trim() !== n.name &&
                    save({ ...c, names: c.names.map((x, j) => (j === k ? { ...x, name: e.target.value.trim() } : x)) })
                  }
                  className="nick-name"
                />
              </td>
              <td>
                <input
                  defaultValue={n.usedBy.join(', ')}
                  placeholder="anyone"
                  title={n.usedBy.map(whoName).join(', ')}
                  onBlur={(e) =>
                    save({
                      ...c,
                      names: c.names.map((x, j) =>
                        j === k
                          ? {
                              ...x,
                              usedBy: e.target.value
                                .split(',')
                                .map((w) => w.trim())
                                .filter(Boolean)
                            }
                          : x
                      )
                    })
                  }
                />
              </td>
              <td>
                <input
                  defaultValue={n.note ?? ''}
                  onBlur={(e) =>
                    save({ ...c, names: c.names.map((x, j) => (j === k ? { ...x, note: e.target.value.trim() || undefined } : x)) })
                  }
                />
              </td>
              <td>
                <button className="link" title="Remove" onClick={() => save({ ...c, names: c.names.filter((_, j) => j !== k) })}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddName onAdd={(name) => save({ ...c, names: [...c.names, { name, usedBy: [] }] })} />
      <h3>Notes</h3>
      <textarea
        className="character-notes"
        defaultValue={c.notes}
        rows={10}
        onBlur={(e) => e.target.value !== c.notes && save({ ...c, notes: e.target.value })}
      />
      {c.problems.length > 0 && (
        <ul className="error small">
          {c.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Saved as <code>{c.path}</code>: a header with the names, then your notes. The prose never changes when a name does; “Where the names
        appear” lists every use to change by hand.
      </p>
    </div>
  )
}

function AddName({ onAdd }: { onAdd(name: string): void }): React.JSX.Element {
  const [v, setV] = useState('')
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        if (v.trim()) onAdd(v.trim())
        setV('')
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a name (nickname, title, surname)…" id="addNickname" />
      <button type="submit" disabled={!v.trim()}>
        Add
      </button>
    </form>
  )
}

// ---- where the names appear ----

function NamesReport({
  character,
  forms,
  snapshot,
  onOpen
}: {
  character: CharacterDto
  forms: NameForm[]
  snapshot: WorldSnapshot
  onOpen(path: string): void
}): React.JSX.Element {
  const [uses, setUses] = useState<Map<string, NameUse[]> | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all(snapshot.prose.map(async (p) => ({ path: p.path, text: (await window.malevo.prose.read(p.path)) ?? '' }))).then(
      (texts) => {
        if (live) setUses(nameUses(texts, forms))
      }
    )
    return () => {
      live = false
    }
  }, [snapshot.version, forms]) // eslint-disable-line react-hooks/exhaustive-deps
  const mine = forms.filter((f) => f.character === character.id)
  return (
    <div className="names-report" id="namesReport">
      {!uses && <p className="muted">Reading…</p>}
      {uses &&
        mine.map((f) => {
          const list = uses.get(f.form) ?? []
          const shared = forms.filter((g) => g.form === f.form && g.character !== character.id)
          return (
            <div key={f.form} className="names-form">
              <h3>
                {f.form} <span className="muted small">{list.length === 1 ? '1 use' : `${list.length} uses`}</span>
              </h3>
              <p className="muted small">
                {f.primary ? 'Their own name' : f.usedBy.length ? `${f.usedBy.join(' and ')}’s name` : 'Another name, anyone’s'}
                {f.note ? ` (${f.note})` : ''}
                {shared.length > 0 && <span className="warning"> · also a name of {shared.map((g) => g.characterName).join(', ')}</span>}
              </p>
              <ul className="small">
                {list.slice(0, 50).map((u, k) => (
                  <li key={k}>
                    <button className="link" onClick={() => onOpen(u.path)}>
                      {u.path.replace(/\.md$/, '')}:{u.line}
                    </button>{' '}
                    <span className="muted">{u.snippet}</span>
                  </li>
                ))}
                {list.length > 50 && <li className="muted">and {list.length - 50} more</li>}
              </ul>
            </div>
          )
        })}
    </div>
  )
}

export const writingTool: ToolDefinition = {
  id: 'writing',
  title: 'Writing',
  description: 'Chapters and notes as Markdown on a novel page, with characters and the names they go by',
  View: WritingView
}
