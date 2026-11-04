/**
 * Reading and writing world folders on disk. This is the only code that
 * touches a world folder.
 *
 * Writing discipline (docs/PLAN.md §3.7):
 * - opening, inspecting, loading and checking never write;
 * - a write happens only on an explicit request, and only for the files that
 *   request names, and a file whose text would not change is not rewritten;
 * - nothing derived (caches, timestamps, machine names) is ever written here.
 * Nothing here knows about git.
 */
import { compareStrings } from '@malevo/core'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { KINDS, entityPath, type KindDef } from './kinds'
import type { WorldEnv } from './events'
import { readWorld, serializeEntity, type WorldData, type WorldFile } from './load'
import { sandboxedCalendar } from './sandbox'
import { templateFiles } from './template'
import { WORLD_FILE, WorldError, newWorldManifest, parseWorldManifest, serializeWorldManifest, type WorldManifest } from './world'

export interface OpenWorld {
  /** Absolute path of the world folder. */
  root: string
  manifest: WorldManifest
}

export type FolderKind =
  | { kind: 'world'; manifest: WorldManifest }
  | { kind: 'empty' }
  | { kind: 'missing' }
  | { kind: 'not-a-world' }
  | { kind: 'invalid'; error: WorldError }

/** What is at this path? Read-only. */
export async function inspectFolder(dir: string): Promise<FolderKind> {
  let entries: string[]
  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return { kind: 'not-a-world' }
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'invalid', error: new WorldError('io', `Cannot read ${dir}: ${(err as Error).message}`) }
  }
  if (entries.includes(WORLD_FILE)) {
    try {
      return { kind: 'world', manifest: await readManifest(dir) }
    } catch (err) {
      return { kind: 'invalid', error: asWorldError(err) }
    }
  }
  return entries.length === 0 ? { kind: 'empty' } : { kind: 'not-a-world' }
}

/** Open an existing world folder. Throws WorldError. Never writes. */
export async function openWorld(dir: string): Promise<OpenWorld> {
  const root = path.resolve(dir)
  let manifest: WorldManifest
  try {
    manifest = await readManifest(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorldError('not-a-world', `${root} is not a world folder (it has no ${WORLD_FILE}).`)
    }
    throw asWorldError(err)
  }
  return { root, manifest }
}

/**
 * Create a new world in `dir`, which must be missing or empty: a world never
 * shares its folder with unrelated files. Writes world.json and the new-world
 * template (packages/model/template), and nothing else.
 */
export async function createWorld(dir: string, name: string, seed: number): Promise<OpenWorld> {
  const root = path.resolve(dir)
  const manifest = newWorldManifest(name, seed)
  const found = await inspectFolder(root)
  if (found.kind === 'world' || found.kind === 'invalid') {
    throw new WorldError('not-empty', `${root} already holds a world.`)
  }
  if (found.kind === 'not-a-world') {
    throw new WorldError('not-empty', `${root} is not empty. Choose an empty folder for a new world.`)
  }
  try {
    await fs.mkdir(root, { recursive: true })
    for (const f of templateFiles()) await writeWorldFile(root, f.path, f.text)
    await writeFileAtomic(path.join(root, WORLD_FILE), serializeWorldManifest(manifest))
  } catch (err) {
    throw asWorldError(err)
  }
  return { root, manifest }
}

async function readManifest(root: string): Promise<WorldManifest> {
  const text = await fs.readFile(path.join(root, WORLD_FILE), 'utf8')
  return parseWorldManifest(text)
}

/** Write via a temporary file and rename, so a crash never leaves half a file. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`)
  await fs.writeFile(tmp, text, 'utf8')
  try {
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

function asWorldError(err: unknown): WorldError {
  if (err instanceof WorldError) return err
  return new WorldError('io', (err as Error).message ?? String(err))
}

// ---- whole worlds ----

/** Folders never read as part of a world: version control, editor and OS clutter. */
const SKIP = (name: string): boolean => name.startsWith('.') || name === 'node_modules' || name === 'Thumbs.db' || name === 'desktop.ini'
const TEXT_EXT = /\.(json|md|js)$/

/** Every file in a world folder, with the text of the ones the format reads. Read-only. */
export async function readWorldFiles(root: string): Promise<WorldFile[]> {
  const out: WorldFile[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries.sort((a, b) => compareStrings(a.name, b.name))) {
      if (SKIP(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, relPath)
      else if (e.isFile()) out.push({ path: relPath, text: TEXT_EXT.test(e.name) ? await fs.readFile(full, 'utf8') : null })
    }
  }
  await walk(path.resolve(root), '')
  return out
}

/** Load and parse a whole world. Read-only; bad content becomes issues, not exceptions. */
export async function loadWorld(root: string, kinds: readonly KindDef[] = KINDS): Promise<WorldData> {
  return readWorld(await readWorldFiles(root), kinds)
}

/** Write one file of a world, creating its folder. Returns false (and writes nothing) if the text is already there. */
export async function writeWorldFile(root: string, relPath: string, text: string): Promise<boolean> {
  if (relPath.split('/').some((p) => p === '..' || p === '' || p.startsWith('.')))
    throw new WorldError('io', `Refusing to write outside the world: ${relPath}`)
  const file = path.join(path.resolve(root), ...relPath.split('/'))
  try {
    if ((await fs.readFile(file, 'utf8')) === text) return false
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, text)
  return true
}

/** Save one entity in canonical form. Returns whether the file changed. */
export async function saveEntity<T>(root: string, kind: KindDef<T>, id: string, value: T): Promise<boolean> {
  return writeWorldFile(root, entityPath(kind as KindDef, id), serializeEntity(kind, value))
}

/** Rewrite the given files (from canonicalFixes). Returns the paths that changed. */
export async function applyFixes(root: string, fixes: readonly { path: string; text: string }[]): Promise<string[]> {
  const changed: string[] = []
  for (const f of fixes) if (await writeWorldFile(root, f.path, f.text)) changed.push(f.path)
  return changed
}

/** Copy any template files the world is missing. Never touches a file that exists. Returns the paths added. */
export async function addMissingTemplateFiles(root: string): Promise<string[]> {
  await openWorld(root)
  const added: string[] = []
  for (const f of templateFiles()) {
    const file = path.join(path.resolve(root), ...f.path.split('/'))
    try {
      await fs.access(file)
    } catch {
      await writeWorldFile(root, f.path, f.text)
      added.push(f.path)
    }
  }
  return added
}

// ---- running world code ----

export { WorldEditor, assertWorldPath, entityText, type FileChange } from './editor'
export { ScriptError, sandboxedCalendar } from './sandbox'

/** The environment for checks and calendars in Node: script calendars run in the vm sandbox. */
export const nodeEnv: WorldEnv = { loadScript: (code, file) => sandboxedCalendar(code, file) }
