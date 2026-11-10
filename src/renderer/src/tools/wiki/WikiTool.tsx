import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { WIKI_DIR, isWikiPath, newPagePath, resolveLink, splitFrontMatter, titleFromPath } from '@malevo/model'
import type { EditableKind, PageDto, WorldSnapshot } from '../../../../shared/types'
import { sig } from '../../components/fields'
import { holdPendingWrite, useFormattedOne, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'
import { PageLinks } from './extensions'

/** How long typing rests before it is written to the world (unsaved, like any edit). */
const WRITE_DELAY = 700

/** Where each kind of entity is edited. */
const TOOL_OF: Partial<Record<EditableKind, string>> = {
  system: 'systems',
  body: 'systems',
  city: 'population',
  culture: 'cultures',
  polity: 'cultures',
  station: 'routes',
  nebula: 'routes',
  route: 'routes',
  event: 'timeline',
  calendar: 'calendars',
  ship: 'shipyard',
  traveller: 'whereabouts',
  drifter: 'whereabouts',
  landing: 'landings'
}

const FOLDERS = ['people', 'organizations', 'places', 'things', 'topics']

function WikiView({ world, snapshot, now, displayCal, navigate, focus }: ToolProps): React.JSX.Element {
  const pages = snapshot.pages
  const [open, setOpen] = useWorldPref<string | null>(world.root, 'wikiPage', null)
  const [history, setHistory] = useState<string[]>([])
  useEffect(() => {
    if (focus) setOpen(focus)
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (p: string): void => {
    if (open && open !== p) setHistory((h) => [...h.slice(-30), open])
    setOpen(p)
  }
  const back = (): void => {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    setOpen(last)
  }
  const page: PageDto | null = open ? (pages.find((p) => p.path === open) ?? missingPage(open)) : null

  return (
    <div className="split-tool wiki">
      <nav className="split-list wiki-nav">
        <PageList pages={pages} open={open} onOpen={go} />
      </nav>
      <div className="wiki-main">
        {page ? (
          <Article
            key={page.path}
            page={page}
            snapshot={snapshot}
            now={now}
            displayCal={displayCal}
            onOpen={go}
            onBack={history.length ? back : null}
            navigate={navigate}
          />
        ) : (
          <div className="wiki-page">
            <h1 className="wiki-title">Encyclopedia</h1>
            <p>
              Everything the world tracks has an article waiting to be written, and you can add pages of your own: people, organizations,
              places, anything you would give a Wikipedia page. Pick one on the left, or start a new page.
            </p>
            <p className="muted small">
              An entity&apos;s article is the Markdown file beside its JSON (<code>bodies/altaris.md</code>); other pages live under{' '}
              <code>{WIKI_DIR}/</code>, in whatever folders you like. The app never changes what a page says: it writes only what you type,
              and when a page moves (or an entity&apos;s file name changes) it rewrites the links to it so they keep working. Type{' '}
              <kbd>@</kbd> in a page to link to anything.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

const PLURALS: Record<string, string> = { body: 'Bodies', city: 'Cities', polity: 'Polities', nebula: 'Nebulae' }

/** "body" → "Bodies", "system" → "Systems". */
function plural(label: string): string {
  return PLURALS[label] ?? `${label[0].toUpperCase()}${label.slice(1)}s`
}

function missingPage(path: string): PageDto {
  return { path, title: titleFromPath(path), category: '', exists: false, kind: null, id: null }
}

// ---- the list of pages ----

function PageList({ pages, open, onOpen }: { pages: PageDto[]; open: string | null; onOpen(p: string): void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [writtenOnly, setWrittenOnly] = useState(false)
  const [making, setMaking] = useState(false)
  const q = query.trim().toLowerCase()
  const shown = pages.filter((p) => (!q || p.title.toLowerCase().includes(q)) && (!writtenOnly || p.exists))
  const groups = useMemo(() => {
    const free = new Map<string, PageDto[]>()
    const ents = new Map<string, PageDto[]>()
    for (const p of shown) {
      const m = p.kind || !isWikiPath(p.path) ? ents : free
      const key = p.kind || !isWikiPath(p.path) ? p.category : p.category || 'pages'
      m.set(key, [...(m.get(key) ?? []), p])
    }
    return { free: [...free].sort((a, b) => a[0].localeCompare(b[0])), ents: [...ents].sort((a, b) => a[0].localeCompare(b[0])) }
  }, [shown])
  const item = (p: PageDto): React.JSX.Element => (
    <li key={p.path}>
      <button
        className={`${p.path === open ? 'list-item is-current' : 'list-item'}${p.exists ? '' : ' unwritten'}`}
        onClick={() => onOpen(p.path)}
        data-page={p.path}
        title={p.path}
      >
        {p.title}
      </button>
    </li>
  )
  return (
    <>
      <h2>Encyclopedia</h2>
      <input
        type="search"
        placeholder="Find a page…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        id="pageSearch"
        aria-label="Find a page"
      />
      <div className="wiki-tools">
        <label className="check small">
          <input type="checkbox" checked={writtenOnly} onChange={(e) => setWrittenOnly(e.target.checked)} id="writtenOnly" />
          Only written pages
        </label>
        <span className="spacer" />
        <button className="small" onClick={() => setMaking(!making)} id="newPage">
          New page
        </button>
      </div>
      {making && <NewPage pages={pages} onMade={(p) => (setMaking(false), onOpen(p))} />}
      {groups.free.map(([folder, list]) => (
        <details key={`f-${folder}`} open className="page-group">
          <summary>
            {folder} <span className="muted small">{list.length}</span>
          </summary>
          <ul>{list.map(item)}</ul>
        </details>
      ))}
      {groups.ents.map(([cat, list]) => (
        <details key={`e-${cat}`} open={Boolean(q) || list.some((p) => p.path === open)} className="page-group">
          <summary>
            {plural(cat)}{' '}
            <span className="muted small">
              {list.some((p) => p.exists) ? `${list.filter((p) => p.exists).length} of ` : ''}
              {list.length}
            </span>
          </summary>
          <ul>{list.map(item)}</ul>
        </details>
      ))}
      {!shown.length && <p className="muted small">No page matches.</p>}
    </>
  )
}

function NewPage({ pages, onMade }: { pages: PageDto[]; onMade(path: string): void }): React.JSX.Element {
  const existing = [
    ...new Set(
      pages
        .filter((p) => isWikiPath(p.path))
        .map((p) => p.category)
        .filter(Boolean)
    )
  ]
  const folders = [...new Set([...FOLDERS, ...existing])].sort()
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState('people')
  const make = async (): Promise<void> => {
    const t = title.trim()
    if (!t) return
    const path = newPagePath(folder.trim(), t, new Set(pages.map((p) => p.path)))
    // The one thing the app writes for you: the title you just gave, as the page's heading.
    await window.malevo.pages.write(path, `# ${t}\n`)
    onMade(path)
  }
  return (
    <form
      className="new-page"
      onSubmit={(e) => {
        e.preventDefault()
        void make()
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" id="newPageTitle" autoFocus />
      <input list="wikiFolders" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder" id="newPageFolder" />
      <datalist id="wikiFolders">
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <button type="submit" disabled={!title.trim()} id="makePage">
        Make
      </button>
    </form>
  )
}

// ---- a page ----

function Article({
  page,
  snapshot,
  now,
  displayCal,
  onOpen,
  onBack,
  navigate
}: {
  page: PageDto
  snapshot: WorldSnapshot
  now: number
  displayCal: string | null
  onOpen(p: string): void
  onBack: (() => void) | null
  navigate: ToolProps['navigate']
}): React.JSX.Element {
  const [backlinks, setBacklinks] = useState<string[]>([])
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    void window.malevo.pages.backlinks(page.path).then(setBacklinks)
  }, [page.path, snapshot.version])
  const title = (p: string): string => snapshot.pages.find((x) => x.path === p)?.title ?? titleFromPath(p)
  const tool = page.kind ? TOOL_OF[page.kind] : undefined
  const free = isWikiPath(page.path)
  return (
    <div className="wiki-page" data-wiki-page={page.path}>
      <div className="wiki-bar small muted">
        {onBack && (
          <button className="link" onClick={onBack} id="pageBack">
            ← Back
          </button>
        )}
        <code>{page.path}</code>
        {!page.exists && <span> · not written yet: start typing</span>}
        <span className="spacer" />
        {tool && page.id && (
          <button className="link" onClick={() => navigate(tool, page.kind === 'body' ? bodySystem(snapshot, page.id!) : page.id!)}>
            Open in {tool[0].toUpperCase() + tool.slice(1)}
          </button>
        )}
        {free && page.exists && (
          <button className="link" onClick={() => setMoving(!moving)} id="movePage">
            Rename or move…
          </button>
        )}
        {page.exists && (
          <button
            className="link"
            onClick={() =>
              window.confirm(`Delete ${page.path}? Links to it stay, and show red.`) && void window.malevo.pages.write(page.path, '')
            }
          >
            Delete page
          </button>
        )}
      </div>
      {moving && <MovePage page={page} pages={snapshot.pages} onMoved={(p) => (setMoving(false), onOpen(p))} />}
      {page.kind && <Infobox page={page} snapshot={snapshot} now={now} displayCal={displayCal} />}
      <PageEditor path={page.path} title={page.title} pages={snapshot.pages} version={snapshot.version} onOpen={onOpen} />
      <footer className="wiki-backlinks" id="backlinks">
        <h3>What links here</h3>
        {backlinks.length ? (
          <ul>
            {backlinks.map((b) => (
              <li key={b}>
                <button className="link" onClick={() => onOpen(b)}>
                  {title(b)}
                </button>{' '}
                <span className="muted small">{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing yet.</p>
        )}
      </footer>
    </div>
  )
}

function bodySystem(snapshot: WorldSnapshot, id: string): string {
  return snapshot.systems.find((s) => s.bodies.some((b) => b.id === id))?.id ?? id
}

function MovePage({ page, pages, onMoved }: { page: PageDto; pages: PageDto[]; onMoved(p: string): void }): React.JSX.Element {
  const folderOf = page.path.slice(WIKI_DIR.length + 1, Math.max(WIKI_DIR.length + 1, page.path.lastIndexOf('/')))
  const [title, setTitle] = useState(page.title)
  const [folder, setFolder] = useState(folderOf)
  const [error, setError] = useState<string | null>(null)
  const move = async (): Promise<void> => {
    const t = title.trim()
    if (!t) return
    const to = newPagePath(folder.trim(), t, new Set(pages.map((p) => p.path).filter((p) => p !== page.path)))
    const r = await window.malevo.pages.move(page.path, to, { from: page.title, to: t })
    if (r) setError(r.error)
    else onMoved(to)
  }
  return (
    <form
      className="new-page"
      onSubmit={(e) => {
        e.preventDefault()
        void move()
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New title" id="moveTitle" />
      <input value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder" id="moveFolder" />
      <button type="submit" id="moveGo">
        Move
      </button>
      <span className="muted small">
        Links to it follow, and link text that was “{page.title}” becomes the new title, as does its heading.
      </span>
      {error && <span className="error">{error}</span>}
    </form>
  )
}

/** Facts the world's files hold about the entity, beside the article (they may disagree with it: the article is canon). */
function Infobox({
  page,
  snapshot,
  now,
  displayCal
}: {
  page: PageDto
  snapshot: WorldSnapshot
  now: number
  displayCal: string | null
}): React.JSX.Element | null {
  const rows: [string, React.ReactNode][] = []
  let color: string | null = null
  const id = page.id!
  const ent = (list: { id: string; value: Record<string, unknown> | null }[]): Record<string, unknown> | null =>
    list.find((x) => x.id === id)?.value ?? null
  const eventStart = snapshot.events.find((e) => e.id === id)?.start?.t ?? null
  const when = useFormattedOne(displayCal, eventStart, 'day', snapshot.version)
  switch (page.kind) {
    case 'system': {
      const s = snapshot.systems.find((x) => x.id === id)
      if (s) {
        rows.push(['Star', s.star?.name ?? s.starId], ['Bodies', String(s.bodies.length)])
        if (s.star) rows.push(['Spectral type', s.star.spect || '—'])
      }
      break
    }
    case 'body': {
      const sys = snapshot.systems.find((x) => x.bodies.some((b) => b.id === id))
      const b = sys?.bodies.find((x) => x.id === id)
      if (sys && b) {
        rows.push(['System', sys.name], ['Class', b.cls])
        if (b.parent) rows.push(['Orbits', sys.bodies.find((x) => x.id === b.parent)?.name ?? b.parent])
        const v = b.value as { mass_mearth?: number; radius_km?: number }
        if (v.mass_mearth !== undefined) rows.push(['Mass', `${sig(v.mass_mearth, 3)} Earth masses`])
        if (v.radius_km !== undefined) rows.push(['Radius', `${sig(v.radius_km, 4)} km`])
      }
      break
    }
    case 'city': {
      const c = snapshot.cities.find((x) => x.id === id)
      if (c) {
        const body = String(c.value.body ?? '')
        rows.push(['On', snapshot.systems.flatMap((s) => s.bodies).find((b) => b.id === body)?.name ?? body])
        const pop = [...c.population].reverse().find((p) => p.t <= now)
        if (pop) rows.push(['People (now)', pop.people.toLocaleString()])
      }
      break
    }
    case 'culture':
    case 'polity': {
      const v = ent(page.kind === 'culture' ? snapshot.cultures : snapshot.polities)
      if (v) {
        color = typeof v.color === 'string' ? v.color : null
        if (typeof v.capital === 'string') rows.push(['Capital', snapshot.systems.find((s) => s.id === v.capital)?.name ?? v.capital])
        if (Array.isArray(v.tags) && v.tags.length) rows.push(['Tags', v.tags.join(', ')])
      }
      break
    }
    case 'event':
      if (when) rows.push(['When', when])
      break
    default:
      break
  }
  return (
    <aside className="infobox" id="infobox">
      <div className="infobox-title" style={color ? { borderTopColor: color } : undefined}>
        {page.title}
      </div>
      <table>
        <tbody>
          <tr>
            <th>Kind</th>
            <td>{page.category[0]?.toUpperCase() + page.category.slice(1)}</td>
          </tr>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">From the world&apos;s files; the article is canon where they differ.</p>
    </aside>
  )
}

// ---- the editor ----

/**
 * The page, always editable. Only what you type is written (after a pause, unsaved like any edit); opening a page
 * writes nothing. A click on a link follows it; a click anywhere else puts the cursor there.
 */
function PageEditor({
  path,
  title,
  pages,
  version,
  onOpen
}: {
  path: string
  title: string
  pages: PageDto[]
  version: number
  onOpen(p: string): void
}): React.JSX.Element {
  const front = useRef('')
  /** The text last read or written; undefined until the page has loaded. */
  const last = useRef<string | null | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Counts writes started and finished: a read that overlaps one may be stale, and is ignored. */
  const writes = useRef(0)
  /** Nothing is written until the page has loaded and you have changed it. */
  const ready = useRef(false)
  const [reformat, setReformat] = useState<{ lines: number; before: string; after: string } | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [hasHeading, setHasHeading] = useState(true)
  const openRef = useRef(onOpen)
  openRef.current = onOpen

  const flush = async (): Promise<void> => {
    if (!timer.current || !editor || !ready.current) return
    clearTimeout(timer.current)
    timer.current = null
    const body = editor.getMarkdown().replace(/\s+$/, '')
    const text = body ? `${front.current}${body}\n` : ''
    last.current = text || null
    writes.current++
    try {
      await window.malevo.pages.write(path, text)
    } finally {
      writes.current++
    }
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  // Save waits for typing not yet written; leaving the page or the window writes it too.
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
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          // Relative links to pages are what this editor is for; anything with a scheme must be a safe one.
          isAllowedUri: (url, ctx) => !/^[a-z][a-z0-9+.-]*:/i.test(url) || ctx.defaultValidate(url)
        }
      }),
      Markdown,
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false }),
      PageLinks,
      Placeholder.configure({ placeholder: 'Start writing. Type @ to link to anything.' })
    ],
    contentType: 'markdown',
    content: '',
    editorProps: {
      attributes: { class: 'wiki-body', spellcheck: 'true' },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a')
        const href = a?.getAttribute('href')
        if (!href) return false
        event.preventDefault()
        const target = resolveLink(path, href)
        if (target) openRef.current(target)
        else if (/^https?:\/\//i.test(href)) window.open(href)
        return true
      }
    },
    onUpdate: ({ transaction, editor: e }) => {
      setHasHeading(firstIsHeading(e))
      if (!ready.current || !transaction.docChanged) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flushRef.current(), WRITE_DELAY)
    }
  })

  useEffect(() => {
    editor?.commands.setPages(path, pages)
  }, [editor, path, pages])

  useEffect(() => {
    editor?.setEditable(!reformat || accepted)
  }, [editor, reformat, accepted])

  // Load the page; reload it if it changed elsewhere (undo, a move, the disk) while you were not typing.
  useEffect(() => {
    if (!editor) return
    let live = true
    const seq = writes.current
    void window.malevo.pages.read(path).then((text) => {
      if (!live || timer.current || seq % 2 === 1 || seq !== writes.current || (text ?? null) === last.current) return
      ready.current = false
      const parts = splitFrontMatter(text ?? '')
      front.current = parts.front
      last.current = text ?? null
      editor.commands.setContent(parts.body, { contentType: 'markdown', emitUpdate: false })
      // Opening a page never changes it; say so if editing it would reformat lines you did not touch.
      const again = editor.getMarkdown().replace(/\s+$/, '')
      const was = parts.body.replace(/\s+$/, '')
      if (again !== was && was) {
        const a = was.split('\n')
        const b = again.split('\n')
        let first = 0
        while (first < a.length && a[first] === b[first]) first++
        const differ = a.filter((l, k) => l !== b[k]).length + Math.max(0, b.length - a.length)
        setReformat({ lines: differ, before: a[first] ?? '', after: b[first] ?? '' })
      } else setReformat(null)
      setHasHeading(firstIsHeading(editor))
      ready.current = true
    })
    return () => {
      live = false
    }
  }, [editor, path, version])

  return (
    <div className="wiki-editor">
      {!hasHeading && <h1 className="wiki-title">{title}</h1>}
      {reformat && !accepted && (
        <div className="notice" id="reformatNotice">
          <p>
            The editor writes Markdown a little differently from this page, so your first change here would also reformat{' '}
            {reformat.lines === 1 ? '1 line' : `${reformat.lines} lines`} you did not touch, for example:
          </p>
          <pre className="small">{`− ${reformat.before}\n+ ${reformat.after}`}</pre>
          <button onClick={() => setAccepted(true)} id="editAnyway">
            Edit anyway
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}

function firstIsHeading(e: Editor): boolean {
  const first = e.state.doc.firstChild
  return Boolean(first && first.type.name === 'heading' && first.attrs.level === 1 && first.textContent.trim())
}

export const wikiTool: ToolDefinition = {
  id: 'wiki',
  title: 'Encyclopedia',
  description: 'Articles about everything in the world, and pages of your own: written by you, linked with @',
  View: WikiView
}
