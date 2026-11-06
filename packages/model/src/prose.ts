/**
 * Prose: the manuscript and the characters, kept as plain Markdown in the
 * world folder, written by hand and readable without the app.
 *
 * - Any `.md` file outside the folders the world format owns is prose: a
 *   chapter, a scene, notes. The app reads and edits it, nothing more.
 * - `characters/<id>.md` is a character: a short header of the names they go
 *   by and who uses which, then free notes.
 *
 *     ---
 *     name: Div
 *     names:
 *       - T (Kasinov)
 *       - Divvy (Mara; only when she's annoyed)
 *     ---
 *     Notes, in your own words.
 *
 * The prose never holds ids or hidden marks: a name in the text is just the
 * name. Which character it means is worked out by reading, from the names in
 * the character files.
 */
import { compareStrings } from '@malevo/core'
import type { KindDef } from './kinds'

export const CHARACTERS_DIR = 'characters'

/** Whether a world path is prose the app may edit: a `.md` file outside the format's own folders, or a character file. */
export function isProsePath(p: string, kinds: readonly KindDef[]): boolean {
  if (!p.endsWith('.md')) return false
  const parts = p.split('/')
  if (parts.some((s) => s === '' || s === '..' || s.startsWith('.'))) return false
  if (parts[0] === CHARACTERS_DIR) return parts.length === 2 && parts[1].length > 3
  const owned = new Set<string>()
  for (const k of kinds) {
    if (k.folder) owned.add(k.folder.split('/')[0])
    if (k.file && k.file.includes('/')) owned.add(k.file.split('/')[0])
  }
  return !owned.has(parts[0])
}

// ---- front matter ----

/** Split off a leading `---` … `---` header, kept byte for byte. */
export function splitFrontMatter(text: string): { front: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text)
  return m ? { front: m[0], body: text.slice(m[0].length) } : { front: '', body: text }
}

// ---- characters ----

export interface CharacterName {
  name: string
  /** Who calls them this: character ids or names, as written. Empty: anyone. */
  usedBy: string[]
  note?: string
}

export interface Character {
  id: string
  path: string
  /** The name they are known by. */
  name: string
  /** Every other name they go by. */
  names: CharacterName[]
  /** The free notes after the header. */
  notes: string
  /** Header lines the app does not use, kept as written. */
  extra: string[]
  problems: string[]
}

/** Read a character file. Never throws: what cannot be read is reported in `problems`. */
export function parseCharacter(id: string, path: string, text: string): Character {
  const { front, body } = splitFrontMatter(text)
  const c: Character = { id, path, name: id, names: [], notes: body.replace(/^\r?\n/, ''), extra: [], problems: [] }
  if (!front) {
    c.problems.push('There is no header (--- name: … ---) at the top.')
    return c
  }
  const lines = front.replace(/\r\n/g, '\n').split('\n').slice(1, -1)
  // Drop the closing --- (and anything after it on the split).
  const end = lines.findIndex((l) => /^---\s*$/.test(l))
  const head = end >= 0 ? lines.slice(0, end) : lines
  let inNames = false
  let sawName = false
  for (const line of head) {
    const key = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (key) {
      inNames = false
      if (key[1] === 'name') {
        c.name = unquote(key[2])
        sawName = true
      } else if (key[1] === 'names') {
        inNames = true
        if (key[2].trim()) c.problems.push('List each name on its own line under "names:", starting with "- ".')
      } else c.extra.push(line)
      continue
    }
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && inNames) {
      const n = parseNameItem(item[1])
      if (n) c.names.push(n)
      else c.problems.push(`"${item[1]}" is not a name.`)
      continue
    }
    if (line.trim() === '') continue
    if (inNames) c.problems.push(`"${line.trim()}" is not a name line (they start with "- ").`)
    else c.extra.push(line)
  }
  if (!sawName) c.problems.push('The header has no "name:".')
  return c
}

function unquote(s: string): string {
  const t = s.trim()
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t
}

/** `T (Kasinov, Mara; a note)` → the name, who uses it, and the note. */
function parseNameItem(s: string): CharacterName | null {
  const m = /^(.*?)\s*(?:\(([^()]*)\))?\s*$/.exec(s.trim())
  if (!m || !m[1]) return null
  const name = unquote(m[1])
  if (!name) return null
  const out: CharacterName = { name, usedBy: [] }
  if (m[2] !== undefined) {
    const [who, ...note] = m[2].split(';')
    out.usedBy = who
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean)
    const n = note.join(';').trim()
    if (n) out.note = n
  }
  return out
}

/** A character as file text, in the form parseCharacter reads. */
export function characterText(c: Pick<Character, 'name' | 'names' | 'notes'> & { extra?: string[] }): string {
  const lines = ['---', `name: ${c.name}`]
  for (const x of c.extra ?? []) lines.push(x)
  if (c.names.length) {
    lines.push('names:')
    for (const n of c.names) {
      const tail = n.usedBy.length || n.note ? ` (${n.usedBy.join(', ')}${n.note ? `; ${n.note}` : ''})` : ''
      lines.push(`  - ${n.name}${tail}`)
    }
  }
  lines.push('---')
  const notes = c.notes.replace(/\s+$/, '')
  return lines.join('\n') + '\n' + (notes ? `\n${notes}\n` : '')
}

/** Every character in a world's files. */
export function charactersOf(files: readonly { path: string; text: string | null }[]): Character[] {
  return files
    .filter((f) => f.text !== null && f.path.startsWith(`${CHARACTERS_DIR}/`) && f.path.endsWith('.md') && f.path.split('/').length === 2)
    .map((f) => parseCharacter(f.path.slice(CHARACTERS_DIR.length + 1, -3), f.path, f.text!))
    .sort((a, b) => compareStrings(a.name, b.name))
}

/** Prose files (not characters), sorted by path. */
export function proseFiles(files: readonly { path: string; text: string | null }[], kinds: readonly KindDef[]): string[] {
  return files
    .filter((f) => f.text !== null && isProsePath(f.path, kinds) && !f.path.startsWith(`${CHARACTERS_DIR}/`))
    .map((f) => f.path)
    .sort(compareStrings)
}

// ---- names in the text ----

export interface NameForm {
  /** The form as written in the text. */
  form: string
  character: string
  characterName: string
  /** The character's own name, rather than a nickname. */
  primary: boolean
  usedBy: string[]
  note?: string
}

/** Every name form any character goes by, longest first (so "Div Arden" wins over "Div"). */
export function nameForms(chars: readonly Character[]): NameForm[] {
  const out: NameForm[] = []
  for (const c of chars) {
    out.push({ form: c.name, character: c.id, characterName: c.name, primary: true, usedBy: [] })
    for (const n of c.names)
      out.push({ form: n.name, character: c.id, characterName: c.name, primary: false, usedBy: n.usedBy, note: n.note })
  }
  return out.filter((f) => f.form.length > 0).sort((a, b) => b.form.length - a.form.length || compareStrings(a.form, b.form))
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A matcher for name forms as whole words (letters and digits either side end a match). Case matters: "T" is not "t". */
export function nameMatcher(forms: readonly NameForm[]): RegExp | null {
  const words = [...new Set(forms.map((f) => f.form))]
  if (!words.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
}

export interface NameUse {
  path: string
  /** 1-based line in the file. */
  line: number
  form: string
  /** The line around the use, trimmed. */
  snippet: string
}

/** Where each name form appears in the prose, by form. */
export function nameUses(prose: readonly { path: string; text: string }[], forms: readonly NameForm[]): Map<string, NameUse[]> {
  const out = new Map<string, NameUse[]>()
  const re = nameMatcher(forms)
  if (!re) return out
  for (const f of prose) {
    const { front, body } = splitFrontMatter(f.text)
    const offset = front.split('\n').length - 1
    body.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const at = m.index ?? 0
        const snippet = line.slice(Math.max(0, at - 40), at + m[0].length + 40).trim()
        const list = out.get(m[0]) ?? []
        list.push({ path: f.path, line: offset + i + 1, form: m[0], snippet })
        out.set(m[0], list)
      }
    })
  }
  return out
}

/** A file name for a new chapter or character from a title: kept readable, safe on Windows. */
export function proseFileName(title: string): string {
  const t = title
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
  return t || 'Untitled'
}

/**
 * Plain text as Markdown, escaped only where it would otherwise be read back
 * as formatting, so prose saves the way it was typed: `&`, `<`, brackets and
 * lone tildes stay as they are; [[editor's marks]] are never escaped.
 *
 * - `\`, `` ` ``, `*` and `_` always (they open code and emphasis);
 * - `~~` (strikethrough);
 * - `]` just before `(` or `[`, and `[` just before `^` (links and footnotes);
 * - `&` only where it would read as an entity (`&amp;`, `&#38;`);
 * - `<` only where it would read as a tag (`<em>`, `</p>`, `<!--`).
 */
export function escapeProse(text: string): string {
  return text
    .replace(/([\\`*_])/g, '\\$1')
    .replace(/~~/g, '\\~\\~')
    .replace(/\](?=[([])/g, '\\]')
    .replace(/\[(?=\^)/g, '\\[')
    .replace(/&(?=#?\w+;)/g, '\\&')
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
}
