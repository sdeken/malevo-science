/**
 * The world's encyclopedia: Markdown pages the author writes.
 *
 * Two kinds of page:
 * - an entity's article, beside its file: `bodies/altaris.md` for `bodies/altaris.json`
 *   (an entity without one has a page waiting to be written);
 * - a free page under `wiki/`, in whatever folders the author likes: `wiki/people/kativa.md`.
 *
 * The pages are the canon; the JSON files are a convenience built on them, and
 * nothing cross-checks the two. The app never changes what a page says. It
 * only keeps links working: when a page moves (renamed, moved, or its entity's
 * id changes), every relative Markdown link to it is rewritten, and so are the
 * moved page's own relative links; when a page's title changes, link text that
 * was exactly the old title follows it.
 *
 * Pure: safe to import from the renderer.
 */
import type { FileChange } from './editor'
import type { KindDef } from './kinds'
import { isId } from './schema'

export const WIKI_DIR = 'wiki'

/** Kinds whose entities have articles (the rest are settings, or parts of another entity). */
const NO_ARTICLE = new Set(['relation', 'viewpoint', 'terrain', 'cityPlan'])

export function articleKinds(kinds: readonly KindDef[]): KindDef[] {
  return kinds.filter((k) => k.folder && !NO_ARTICLE.has(k.kind))
}

/** A free page: `wiki/…/name.md`, with no empty, dot or hidden segments. */
export function isWikiPath(p: string): boolean {
  if (!p.startsWith(`${WIKI_DIR}/`) || !p.endsWith('.md')) return false
  return p.split('/').every((s) => s.length > 0 && !s.startsWith('.') && !/[\\:*?"<>|]/.test(s))
}

/** Where an entity's article goes. */
export function articlePath(kind: KindDef, id: string): string {
  return `${kind.folder}/${id}.md`
}

/** A page the app may write: a free page, or an article beside an entity file. */
export function isPagePath(p: string, kinds: readonly KindDef[]): boolean {
  if (isWikiPath(p)) return true
  const m = /^([^/]+)\/([^/]+)\.md$/.exec(p)
  return Boolean(m && isId(m[2]) && kinds.some((k) => k.folder === m[1]))
}

/** Front matter (a leading `---` block) kept apart, verbatim, from the body. */
export function splitFrontMatter(text: string): { front: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)
  return m ? { front: m[0], body: text.slice(m[0].length) } : { front: '', body: text }
}

/** The page's own title: its first line, if that is a `# Heading`. */
export function headingTitle(text: string): string | null {
  const m = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(
    splitFrontMatter(text)
      .body.split('\n')
      .find((l) => l.trim() !== '') ?? ''
  )
  return m ? m[1] : null
}

/** A title from a file name: "hotel-meridian.md" → "Hotel meridian". */
export function titleFromPath(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const words = base.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : base
}

// ---- paths ----

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** Join and normalize, or null if it climbs out of the world. */
function normalize(parts: string[]): string | null {
  const out: string[] = []
  for (const s of parts) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(s)
  }
  return out.join('/')
}

/**
 * Where a link in the page at `from` points, as a path in the world; null for anything that is not a
 * relative link to a file (a web address, an anchor in the page, an absolute path, outside the world).
 */
export function resolveLink(from: string, url: string): string | null {
  let u = url.trim()
  if (u.startsWith('<') && u.endsWith('>')) u = u.slice(1, -1)
  if (!u || u.startsWith('#') || u.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(u)) return null
  u = u.replace(/[?#].*$/, '')
  try {
    u = decodeURI(u)
  } catch {
    // Keep it as written.
  }
  return normalize([...dirOf(from).split('/'), ...u.split('/')])
}

/** The relative link from the page at `from` to the file at `to`. */
export function relativeLink(from: string, to: string): string {
  const a = dirOf(from).split('/').filter(Boolean)
  const b = to.split('/')
  let k = 0
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++
  const up = a.slice(k).map(() => '..')
  const rel = [...up, ...b.slice(k)].join('/')
  return encodeURI(rel)
}

// ---- links in Markdown ----

export interface LinkAt {
  /** The link's text (null for a reference definition). */
  text: string | null
  textStart: number
  url: string
  urlStart: number
  urlEnd: number
}

/** Stretches of code (fenced blocks and inline code spans), where nothing is a link. */
function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = []
  const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[`~]*[ \t]*$|(?![\s\S]))/gm
  for (const m of text.matchAll(fence)) out.push([m.index!, m.index! + m[0].length])
  const inside = (i: number): boolean => out.some(([a, b]) => i >= a && i < b)
  for (const m of text.matchAll(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g)) if (!inside(m.index!)) out.push([m.index!, m.index! + m[0].length])
  return out
}

/** Every inline link `[text](url "title")`, image, and reference definition `[ref]: url`, outside code. */
export function findLinks(text: string): LinkAt[] {
  const code = codeRanges(text)
  const inCode = (i: number): boolean => code.some(([a, b]) => i >= a && i < b)
  const out: LinkAt[] = []
  const inline =
    /!?\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  for (const m of text.matchAll(inline)) {
    if (inCode(m.index!)) continue
    const open = (m[0].startsWith('!') ? 2 : 1) + m[1].length + 2
    const urlStart = m.index! + open + (/^\s*/.exec(m[0].slice(open))?.[0].length ?? 0)
    out.push({ text: m[1], textStart: m.index! + (m[0].startsWith('!') ? 2 : 1), url: m[2], urlStart, urlEnd: urlStart + m[2].length })
  }
  const defs = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm
  for (const m of text.matchAll(defs)) {
    if (inCode(m.index!)) continue
    const urlStart = m.index! + m[0].length - m[1].length
    out.push({ text: null, textStart: -1, url: m[1], urlStart, urlEnd: urlStart + m[1].length })
  }
  return out.sort((a, b) => a.urlStart - b.urlStart)
}

/** The pages a page links to (resolved paths, each once). */
export function linksFrom(path: string, text: string): string[] {
  const out = new Set<string>()
  for (const l of findLinks(text)) {
    const t = resolveLink(path, l.url)
    if (t) out.add(t)
  }
  return [...out]
}

/**
 * Keep links working after pages move.
 *
 * `files` is the world as it will be, with every moved page already at its new path; `moves` maps old paths
 * to new ones (a page that moves without a file yet, like an entity's unwritten article, still counts: links
 * to it follow). `retitle` maps a page's (new) path to its old and new titles: link text that was exactly the
 * old title becomes the new one. Returns the pages whose text changes.
 */
export function relink(
  files: ReadonlyMap<string, string | null>,
  moves: ReadonlyMap<string, string>,
  retitle: ReadonlyMap<string, { from: string; to: string }> = new Map()
): FileChange[] {
  const back = new Map([...moves].map(([a, b]) => [b, a]))
  const out: FileChange[] = []
  for (const [path, text] of files) {
    if (text === null || !path.endsWith('.md')) continue
    const was = back.get(path) ?? path
    const moved = was !== path
    let edits: { start: number; end: number; with: string }[] = []
    for (const l of findLinks(text)) {
      const target = resolveLink(was, l.url)
      if (target === null) continue
      const now = moves.get(target) ?? target
      if (moved || now !== target) {
        const suffix = /[?#].*$/.exec(l.url.replace(/^<|>$/g, ''))?.[0] ?? ''
        const url = relativeLink(path, now) + suffix
        if (url !== l.url) edits.push({ start: l.urlStart, end: l.urlEnd, with: url })
      }
      const t = retitle.get(now)
      if (t && l.text !== null && l.text.trim() === t.from && t.from !== t.to)
        edits.push({ start: l.textStart, end: l.textStart + l.text.length, with: t.to })
    }
    if (!edits.length) continue
    edits = edits.sort((a, b) => b.start - a.start)
    let next = text
    for (const e of edits) next = next.slice(0, e.start) + e.with + next.slice(e.end)
    if (next !== text) out.push({ path, text: next })
  }
  return out
}

/** Apply changes to a file map (a copy). */
export function applyChanges(files: ReadonlyMap<string, string | null>, changes: readonly FileChange[]): Map<string, string | null> {
  const m = new Map(files)
  for (const c of changes) {
    if (c.text === null) m.delete(c.path)
    else m.set(c.path, c.text)
  }
  return m
}

/** Changes plus the relinking they call for, as one list (later changes to a path replace earlier ones). */
export function withRelinks(
  files: ReadonlyMap<string, string | null>,
  changes: readonly FileChange[],
  moves: ReadonlyMap<string, string>,
  retitle?: ReadonlyMap<string, { from: string; to: string }>
): FileChange[] {
  const after = applyChanges(files, changes)
  const fixes = relink(after, moves, retitle)
  if (!fixes.length) return [...changes]
  const fixed = new Map(fixes.map((f) => [f.path, f]))
  return [...changes.map((c) => fixed.get(c.path) ?? c), ...fixes.filter((f) => !changes.some((c) => c.path === f.path))]
}

/** The pages that link to `target`. */
export function backlinksTo(files: ReadonlyMap<string, string | null>, target: string): string[] {
  const out: string[] = []
  for (const [path, text] of files) {
    if (text === null || !path.endsWith('.md') || path === target) continue
    if (linksFrom(path, text).includes(target)) out.push(path)
  }
  return out.sort()
}

/** A path for a new free page: `wiki/<folder>/<slug>.md`, not one taken. */
export function newPagePath(folder: string, title: string, taken: ReadonlySet<string>): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'page'
  const dir = [WIKI_DIR, ...folder.split('/').filter(Boolean)].join('/')
  let p = `${dir}/${slug}.md`
  for (let n = 2; taken.has(p); n++) p = `${dir}/${slug}-${n}.md`
  return p
}

/**
 * The changes that move (or rename) a free page, keeping links working. With a new title, the page's own
 * heading follows if it was the old title, and so does link text that was the old title.
 */
export function movePageChanges(
  files: ReadonlyMap<string, string | null>,
  from: string,
  to: string,
  title?: { from: string; to: string }
): FileChange[] | { error: string } {
  const text = files.get(from)
  if (typeof text !== 'string') return { error: `There is no page ${from}.` }
  if (from !== to && files.has(to)) return { error: `There is already a page at ${to}.` }
  let next = text
  if (title && title.from !== title.to && headingTitle(text) === title.from) {
    const { front, body } = splitFrontMatter(text)
    next = front + body.replace(/^(\s*#\s+).+?(\s*#*\s*)$/m, (_m, a: string, b: string) => `${a}${title.to}${b}`)
  }
  const changes: FileChange[] =
    from === to
      ? [{ path: to, text: next }]
      : [
          { path: to, text: next },
          { path: from, text: null }
        ]
  return withRelinks(files, changes, from === to ? new Map() : new Map([[from, to]]), title ? new Map([[to, title]]) : undefined)
}
