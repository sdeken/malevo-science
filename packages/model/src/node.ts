/**
 * Reading and writing world folders on disk.
 *
 * Writing discipline (docs/PLAN.md §3.7): opening or inspecting a world never
 * writes anything, and the only file Phase 0 ever writes is world.json, once,
 * when a world is created. Nothing here knows about git.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
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
 * shares its folder with unrelated files. Writes world.json and nothing else.
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
