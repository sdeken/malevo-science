/**
 * Reading a world from its files, without touching the disk: the caller
 * supplies the files (the node entry reads them from a folder; tests and the
 * renderer can supply them directly). Nothing here writes.
 */
import { compareStrings } from '@malevo/core'
import { canonicalJson } from './canonical'
import { contentHash } from './hash'
import { KINDS, entityKey, type KindDef } from './kinds'
import { isId, parseWith, type Ref, type Severity } from './schema'
import { WORLD_FILE, WorldError, parseWorldManifest, type WorldManifest } from './world'

export interface WorldFile {
  /** Relative to the world folder, with forward slashes. */
  path: string
  /** Text of JSON, Markdown and JavaScript files; null for anything else. */
  text: string | null
}

export interface Entity {
  key: string
  kind: KindDef
  id: string
  path: string
  /** Undefined when the file could not be parsed or failed its schema. */
  value: unknown
  text: string
  /** The file's canonical text, when it parsed. */
  canonical: string | null
  /** Hash of the canonical text (or of the raw text if it did not parse). */
  hash: string
  refs: Ref[]
  /**
   * "builtin": built into the app, with no file (its path is where a file would go).
   * "override": a file standing in for a built-in.
   */
  origin?: 'builtin' | 'override'
}

export interface Issue {
  severity: Severity
  /** Which check produced it. */
  check: string
  code: string
  message: string
  /** File, relative to the world folder. */
  path?: string
  /** JSON path within the file. */
  field?: string
}

export interface WorldData {
  manifest: WorldManifest | null
  entities: Map<string, Entity>
  /** Issues found while reading: unparseable files, schema errors, stray files. */
  issues: Issue[]
  /** Files outside the world format, left alone. */
  ignored: string[]
  /** JavaScript files beside entities of kinds that allow them, by path ("calendars/x.js"). */
  scripts: Map<string, string>
  kinds: readonly KindDef[]
  /** The built-ins this world has (by key, canonical text), whether or not a file overrides them. Set by addBuiltins. */
  builtins?: Map<string, string>
}

/** Read every entity from a world's files. Never throws for bad content; problems become issues. */
export function readWorld(files: readonly WorldFile[], kinds: readonly KindDef[] = KINDS): WorldData {
  const data: WorldData = { manifest: null, entities: new Map(), issues: [], ignored: [], scripts: new Map(), kinds }
  const add = (severity: Severity, code: string, message: string, path?: string, field?: string): void => {
    data.issues.push({ severity, check: 'files', code, message, path, field })
  }
  const byPath = new Map(files.map((f) => [f.path, f]))

  const manifestFile = byPath.get(WORLD_FILE)
  if (!manifestFile || manifestFile.text === null) add('error', 'no-manifest', `There is no ${WORLD_FILE}; this is not a world folder.`)
  else {
    try {
      data.manifest = parseWorldManifest(manifestFile.text)
    } catch (err) {
      add('error', (err as WorldError).code ?? 'invalid-manifest', (err as Error).message, WORLD_FILE)
    }
  }

  const folders = new Map(kinds.filter((k) => k.folder).map((k) => [k.folder!, k]))
  const singles = new Map(kinds.filter((k) => k.file).map((k) => [k.file!, k]))
  const reservedDirs = new Set([...folders.keys(), ...[...singles.keys()].map((p) => p.split('/').slice(0, -1).join('/')).filter(Boolean)])

  for (const file of [...files].sort((a, b) => compareStrings(a.path, b.path))) {
    if (file.path === WORLD_FILE) continue
    const single = singles.get(file.path)
    if (single) {
      readEntity(data, single, single.kind, file)
      continue
    }
    const slash = file.path.lastIndexOf('/')
    const dir = slash < 0 ? '' : file.path.slice(0, slash)
    const base = file.path.slice(slash + 1)
    const kind = folders.get(dir)
    if (kind) {
      const m = /^(.*)\.(json|md|js)$/.exec(base)
      if (!m) {
        add(
          'warning',
          'unexpected-file',
          `"${base}" is not a ${kind.label} file (expected <id>.json, with an optional <id>.md note).`,
          file.path
        )
        continue
      }
      const [, id, ext] = m
      if (!isId(id)) {
        add('error', 'bad-id', `"${id}" is not a valid id: use lowercase letters, digits, ".", "_" and "-".`, file.path)
        continue
      }
      if (ext === 'json') readEntity(data, kind, id, file)
      else if (ext === 'md' && !byPath.has(`${dir}/${id}.json`))
        add('info', 'orphan-note', `This note has no ${kind.label} "${id}" to belong to.`, file.path)
      else if (ext === 'js') {
        if (kind.scripts) data.scripts.set(file.path, file.text ?? '')
        else add('warning', 'unexpected-file', `${kind.label} files do not take scripts; this one is ignored.`, file.path)
      }
      continue
    }
    if (reservedDirs.has(dir) || [...reservedDirs].some((d) => dir.startsWith(`${d}/`))) {
      add('warning', 'unexpected-file', `This file is not part of the world format and is ignored.`, file.path)
      continue
    }
    data.ignored.push(file.path)
  }
  return data
}

function readEntity(data: WorldData, kind: KindDef, id: string, file: WorldFile): void {
  const key = entityKey(kind, id)
  const text = file.text ?? ''
  const entity: Entity = { key, kind, id, path: file.path, value: undefined, text, canonical: null, hash: contentHash(text), refs: [] }
  data.entities.set(key, entity)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    data.issues.push({
      severity: 'error',
      check: 'files',
      code: 'invalid-json',
      message: `Not valid JSON: ${(err as Error).message}`,
      path: file.path
    })
    return
  }
  const parsed = parseWith(kind.schema, raw)
  for (const i of parsed.issues)
    data.issues.push({
      severity: i.severity,
      check: 'files',
      code: i.code,
      message: i.message,
      path: file.path,
      field: i.field || undefined
    })
  entity.refs = parsed.refs
  if (parsed.value === undefined) return
  entity.value = parsed.value
  entity.canonical = canonicalJson(kind.schema.toJson(parsed.value))
  entity.hash = contentHash(entity.canonical)
}

/** Entities of one kind, sorted by id. */
export function entitiesOf<T>(world: WorldData, kind: KindDef<T>): (Entity & { value: T })[] {
  return [...world.entities.values()]
    .filter((e): e is Entity & { value: T } => e.kind.kind === kind.kind && e.value !== undefined)
    .sort((a, b) => compareStrings(a.id, b.id))
}

/** The canonical text of an entity value, for saving. */
export function serializeEntity<T>(kind: KindDef<T>, value: T): string {
  return canonicalJson(kind.schema.toJson(value))
}
