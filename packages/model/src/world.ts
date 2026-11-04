/**
 * world.json: the one file every world folder has.
 *
 *   {
 *     "format": 1,
 *     "name": "Scratch",
 *     "seed": 2718281828
 *   }
 *
 * - `format` is the world-folder format version. A loader refuses any format
 *   it does not know, older or newer: older ones need a migration (none exist
 *   yet), and newer ones were written by a newer app, so reading them could
 *   lose data.
 * - `name` is display only; nothing references a world by name.
 * - `seed` is the root of all procedural generation in the world (an unsigned
 *   32-bit integer). Every random stream is keyed from it (docs/PLAN.md §3.2),
 *   so it never changes after creation.
 *
 * Keys the app does not know are kept, in their original order after the
 * known ones, so a hand edit or a newer minor addition is not silently lost
 * when the app rewrites the file.
 */
import { canonicalJson } from './canonical'

export const WORLD_FILE = 'world.json'
export const WORLD_FORMAT = 1

export interface WorldManifest {
  format: number
  name: string
  seed: number
  /** Keys this version of the app does not know, preserved as-is. */
  extra: Record<string, unknown>
}

export type WorldErrorCode = 'not-a-world' | 'invalid-json' | 'invalid-manifest' | 'format-too-old' | 'format-too-new' | 'not-empty' | 'io'

export class WorldError extends Error {
  constructor(
    readonly code: WorldErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorldError'
  }
}

const KNOWN_KEYS = ['format', 'name', 'seed'] as const
const MAX_NAME = 200

export function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
}

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

/** A manifest for a brand-new world. The caller supplies the seed, so this module never draws randomness. */
export function newWorldManifest(name: string, seed: number): WorldManifest {
  const clean = normalizeName(name)
  if (!clean) throw new WorldError('invalid-manifest', 'A world needs a name.')
  if (!isSeed(seed)) throw new WorldError('invalid-manifest', 'A world seed must be an integer from 0 to 4294967295.')
  return { format: WORLD_FORMAT, name: clean, seed, extra: {} }
}

/** Parse and validate the text of a world.json. Throws WorldError. */
export function parseWorldManifest(text: string): WorldManifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new WorldError('invalid-json', `world.json is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WorldError('invalid-manifest', 'world.json must contain a JSON object.')
  }
  const obj = raw as Record<string, unknown>
  const format = obj.format
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    throw new WorldError('invalid-manifest', 'world.json has no valid "format" number.')
  }
  if (format > WORLD_FORMAT) {
    throw new WorldError(
      'format-too-new',
      `This world uses format ${format}, but this version of Malevo Science only understands format ${WORLD_FORMAT}. Update the app to open it.`
    )
  }
  if (format < WORLD_FORMAT) {
    throw new WorldError('format-too-old', `This world uses format ${format}, which this version of Malevo Science can no longer read.`)
  }
  if (typeof obj.name !== 'string' || !normalizeName(obj.name)) {
    throw new WorldError('invalid-manifest', 'world.json has no "name".')
  }
  if (!isSeed(obj.seed)) {
    throw new WorldError('invalid-manifest', 'world.json "seed" must be an integer from 0 to 4294967295.')
  }
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) extra[key] = value
  }
  return { format, name: obj.name, seed: obj.seed, extra }
}

/** The canonical text of a world.json: known keys in schema order, then preserved extras. */
export function serializeWorldManifest(manifest: WorldManifest): string {
  return canonicalJson({ format: manifest.format, name: manifest.name, seed: manifest.seed, ...manifest.extra })
}
